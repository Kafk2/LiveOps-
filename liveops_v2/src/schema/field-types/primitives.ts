/**
 * schema/field-types/primitives.ts — 7 种基础字段类型实现
 *
 * 职责：注册 text / number / boolean / date / time / json / enum 七种内置 FieldType，
 * 供 params-schema 与 csv-schema 共用。每个类型实现完整 FieldType 接口：
 *   - parse/serialize：CSV/存储字符串 ↔ 值 的双向转换
 *   - defaultValue：类型级默认值
 *   - validate：单字段必填校验（跨字段校验由 ConfigValidator 负责）
 *   - create：构造 DOM 控件 + FieldController（getValue/setValue/subscribe/validate/getElement/destroy）
 *
 * 关键设计：
 * 1. parse 严格容错——任何异常/非法输入一律回退 defaultValue，绝不抛出
 *    （满足 plan critical：CSV 导入逐行容错，单坏行不阻断整批导入）。
 * 2. json 类型为 string identity，脏 JSON 原样透传，绝不 JSON.parse
 *    （满足 plan critical 13：保留用户原始输入，避免数据损失）。
 * 3. FieldController 用闭包 + Set<listener> 实现订阅；setValue 写 DOM 且去重通知，
 *    避免 store 回写（onChange → setValue）造成的重复触发。
 * 4. 阶段 1 控件极简（单个原生 input/select/textarea），接口稳定，阶段 3 再升级复合 wizard。
 *
 * 注：defaultValue() 接口无 fieldDef 入参，故 enum 无法在此读取 options[0]，
 *     返回 ''；实际默认值应由 fieldDef.default 提供（schema 侧设定 options[0].value）。
 */

import type { FieldController, FieldDef, FieldRenderProps, FieldType } from '@/schema/field-types/registry';
import type { ValidationError } from '@/core/types';
import { registerFieldType } from '@/schema/field-types/registry';

// ----------------------------------------------------------------------------
// 通用工具
// ----------------------------------------------------------------------------

/** required 字段的空值错误对象；非 required 或无 fieldDef 时返回 null */
function requiredError(fieldDef: FieldDef | undefined): ValidationError | null {
  if (!fieldDef?.required) return null;
  const field = fieldDef.key;
  const label = fieldDef.label ?? fieldDef.key;
  return { field, message: `${label}不能为空`, severity: 'error' };
}

/** string 类型通用校验：仅做 required 空值检查（trim 后为空即报错） */
function validateRequiredString(value: string, fieldDef?: FieldDef): ValidationError[] {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    const e = requiredError(fieldDef);
    if (e) return [e];
  }
  return [];
}

/** 防御性 identity parse：raw 非空时返回 String(raw)，异常/null 回退 def（绝不抛出） */
function identityParse(raw: string, def: string): string {
  try {
    if (raw == null) return def;
    return String(raw);
  } catch {
    return def;
  }
}

/**
 * 通用 FieldController 装配。
 * 闭包维护 current + Set<listener>；DOM 事件 → readDom → 通知订阅者 + props.onChange 上抛 store。
 * setValue 写 DOM 后仅在值变化时通知，避免 store 回写造成的重复触发。
 */
function attachController<T>(
  props: FieldRenderProps<T>,
  el: HTMLElement,
  validate: (v: T) => ValidationError[],
  readDom: () => T,
  writeDom: (v: T) => void,
  eventName: string,
): FieldController<T> {
  let current: T = props.value;
  const listeners = new Set<(v: T) => void>();

  // 初始 DOM 同步（确保控件显示初始 value）
  writeDom(current);

  function notify(): void {
    for (const fn of listeners) fn(current);
  }

  function onDom(): void {
    const next = readDom();
    if (next === current) return; // 去重，避免无变化时的冗余通知
    current = next;
    notify();
    props.onChange(current);
  }

  el.addEventListener(eventName, onDom);

  return {
    getValue: () => current,
    setValue(v: T): void {
      const changed = v !== current;
      current = v;
      writeDom(v); // 始终同步 DOM，保证控件与 current 一致
      if (changed) notify();
    },
    subscribe(fn: (v: T) => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    validate: () => validate(current),
    getElement: () => el,
    destroy(): void {
      el.removeEventListener(eventName, onDom);
      listeners.clear();
    },
  };
}

// ----------------------------------------------------------------------------
// text —— 单行文本，string identity
// ----------------------------------------------------------------------------

function parseText(raw: string): string {
  return identityParse(raw, '');
}
function serializeText(value: string): string {
  return value == null ? '' : String(value);
}

export const textType: FieldType<string> = {
  key: 'text',
  name: '文本',
  parse: parseText,
  serialize: serializeText,
  defaultValue: () => '',
  validate: validateRequiredString,
  create(props: FieldRenderProps<string>): FieldController<string> {
    const el = document.createElement('input');
    el.type = 'text';
    if (props.disabled) el.disabled = true;
    return attachController<string>(
      props,
      el,
      (v) => validateRequiredString(v, props.fieldDef),
      () => el.value,
      (v) => {
        el.value = v;
      },
      'input',
    );
  },
};

// ----------------------------------------------------------------------------
// number —— 数字，parse 用 Number(raw)，NaN 回退 0
// ----------------------------------------------------------------------------

function parseNumber(raw: string): number {
  try {
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}
function serializeNumber(value: number): string {
  return value == null ? '' : String(value);
}
function validateNumber(value: number, fieldDef?: FieldDef): ValidationError[] {
  // parse 容错保证恒为有限数；此处仅理论 NaN 时报 required
  if (Number.isNaN(value)) {
    const e = requiredError(fieldDef);
    if (e) return [e];
  }
  return [];
}

export const numberType: FieldType<number> = {
  key: 'number',
  name: '数字',
  parse: parseNumber,
  serialize: serializeNumber,
  defaultValue: () => 0,
  validate: validateNumber,
  create(props: FieldRenderProps<number>): FieldController<number> {
    const el = document.createElement('input');
    el.type = 'number';
    if (props.disabled) el.disabled = true;
    return attachController<number>(
      props,
      el,
      (v) => validateNumber(v, props.fieldDef),
      () => {
        const n = el.valueAsNumber;
        return Number.isNaN(n) ? 0 : n;
      },
      (v) => {
        el.value = String(v);
      },
      'input',
    );
  },
};

// ----------------------------------------------------------------------------
// boolean —— CSV '1'/'0' 互通；parse '1'/'true'/true → true，其他 → false
// ----------------------------------------------------------------------------

function parseBoolean(raw: string): boolean {
  try {
    if ((raw as unknown) === true) return true; // 防御：runtime 可能直接传入布尔
    const r = raw == null ? '' : String(raw).toLowerCase();
    return r === '1' || r === 'true';
  } catch {
    return false;
  }
}
function serializeBoolean(value: boolean): string {
  return value ? '1' : '0';
}

export const booleanType: FieldType<boolean> = {
  key: 'boolean',
  name: '布尔',
  parse: parseBoolean,
  serialize: serializeBoolean,
  defaultValue: () => false,
  validate: () => [], // boolean 无 required 空值语义
  create(props: FieldRenderProps<boolean>): FieldController<boolean> {
    const el = document.createElement('input');
    el.type = 'checkbox';
    if (props.disabled) el.disabled = true;
    return attachController<boolean>(
      props,
      el,
      () => [],
      () => el.checked,
      (v) => {
        el.checked = v;
      },
      'change',
    );
  },
};

// ----------------------------------------------------------------------------
// date —— YYYY-MM-DD，string identity，default ''
// ----------------------------------------------------------------------------

export const dateType: FieldType<string> = {
  key: 'date',
  name: '日期',
  parse: (raw: string) => identityParse(raw, ''),
  serialize: (value: string) => (value == null ? '' : String(value)),
  defaultValue: () => '',
  validate: validateRequiredString,
  create(props: FieldRenderProps<string>): FieldController<string> {
    const el = document.createElement('input');
    el.type = 'date';
    if (props.disabled) el.disabled = true;
    return attachController<string>(
      props,
      el,
      (v) => validateRequiredString(v, props.fieldDef),
      () => el.value,
      (v) => {
        el.value = v;
      },
      'change',
    );
  },
};

// ----------------------------------------------------------------------------
// time —— HH:mm，string identity，default '10:00'
// ----------------------------------------------------------------------------

export const timeType: FieldType<string> = {
  key: 'time',
  name: '时间',
  parse: (raw: string) => identityParse(raw, '10:00'),
  serialize: (value: string) => (value == null ? '' : String(value)),
  defaultValue: () => '10:00',
  validate: validateRequiredString,
  create(props: FieldRenderProps<string>): FieldController<string> {
    const el = document.createElement('input');
    el.type = 'time';
    if (props.disabled) el.disabled = true;
    return attachController<string>(
      props,
      el,
      (v) => validateRequiredString(v, props.fieldDef),
      () => el.value,
      (v) => {
        el.value = v;
      },
      'change',
    );
  },
};

// ----------------------------------------------------------------------------
// json —— 脏 JSON 原样透传，string identity，绝不 JSON.parse，default '{}'
// ----------------------------------------------------------------------------

export const jsonType: FieldType<string> = {
  key: 'json',
  name: 'JSON',
  parse: (raw: string) => identityParse(raw, '{}'),
  serialize: (value: string) => (value == null ? '' : String(value)),
  defaultValue: () => '{}',
  validate: validateRequiredString,
  create(props: FieldRenderProps<string>): FieldController<string> {
    const el = document.createElement('textarea');
    el.rows = 4;
    if (props.disabled) el.disabled = true;
    return attachController<string>(
      props,
      el,
      (v) => validateRequiredString(v, props.fieldDef),
      () => el.value,
      (v) => {
        el.value = v;
      },
      'input',
    );
  },
};

// ----------------------------------------------------------------------------
// enum —— select 下拉，options 来自 fieldDef.options，default ''
// ----------------------------------------------------------------------------

export const enumType: FieldType<string> = {
  key: 'enum',
  name: '枚举',
  parse: (raw: string) => identityParse(raw, ''),
  serialize: (value: string) => (value == null ? '' : String(value)),
  // defaultValue() 无 fieldDef 入参，无法读取 options[0]；返回 ''。
  // 实际默认值由 fieldDef.default 提供（schema 侧设定 options[0].value）。
  defaultValue: () => '',
  validate: validateRequiredString,
  create(props: FieldRenderProps<string>): FieldController<string> {
    const el = document.createElement('select');
    const opts = props.fieldDef.options ?? [];
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      el.appendChild(opt);
    }
    if (props.disabled) el.disabled = true;
    return attachController<string>(
      props,
      el,
      (v) => validateRequiredString(v, props.fieldDef),
      () => el.value,
      (v) => {
        el.value = v;
      },
      'change',
    );
  },
};

// ----------------------------------------------------------------------------
// 注册入口
// ----------------------------------------------------------------------------

/**
 * 注册全部 7 种基础字段类型到全局注册表（应用启动时调用一次）。
 *
 * 注意：registry.ts 的 registerFieldType 形参是 FieldType<unknown>，
 * 而本文件具体类型用 FieldType<string>/FieldType<number>/FieldType<boolean>
 * （保内部强类型）。因 serialize/validate/create 的 props 在 T 上逆变，
 * FieldType<string> 等不能直接赋给 FieldType<unknown>，故在注册边界用
 * `as unknown as FieldType` 转换。registry 接口不可改（见任务硬规则），
 * 此转换是兼容 registry 弱类型的必要桥接（与 advanced.ts 一致）。
 */
export function registerPrimitives(): void {
  registerFieldType(textType as unknown as FieldType);
  registerFieldType(numberType as unknown as FieldType);
  registerFieldType(booleanType as unknown as FieldType);
  registerFieldType(dateType as unknown as FieldType);
  registerFieldType(timeType as unknown as FieldType);
  registerFieldType(jsonType as unknown as FieldType);
  registerFieldType(enumType as unknown as FieldType);
}
