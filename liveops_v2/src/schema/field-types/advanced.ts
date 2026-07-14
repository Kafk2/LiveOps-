/**
 * schema/field-types/advanced.ts — 4 种高级字段类型：duration / recurrence / derived / group
 *
 * 关键设计：
 * 1. 全部 T = string，parse/serialize 走 string identity（与 v1 CSV 透传互通，脏 JSON 原样保留）。
 *    复杂结构（duration 的天时分、recurrence 的数组）只在 create() 内部拆分/重组，
 *    不污染存储层——这是 plan 数据模型 critical（string 互通）的硬约束。
 * 2. create() 返回完整 FieldController（getValue/setValue/subscribe/validate/getElement/destroy）。
 *    - 内部用户输入 → 更新 current → 调 props.onChange（通知父）→ notify listeners（额外订阅者）
 *    - 外部 setValue → 更新 current → 同步 DOM → notify listeners（不回调 onChange，避免回环）
 *    - subscribe 用 Set<listener>，返回 unsubscribe
 * 3. duration 的天/时/分只是 UI 拆分视图，秒数永远是真值；任一输入变化重新合并为秒数。
 * 4. recurrence 阶段 1 是单 <input type="text">（CSV 原样），阶段 3 会替换为 5 模式 wizard；
 *    derived 是只读占位（值由 dependency/mutex 从 settings 反查填充，不在本字段编辑）；
 *    group 是嵌套容器预埋（阶段 3 按 fieldDef.children 渲染子字段），阶段 1 用 textarea 占位。
 *    —— 接口在阶段 1 定型，实现渐进，不 throwaway（见 registry.ts 头注释）。
 */

import { ValidationError } from '@/core/types';
import {
  FieldController,
  FieldDef,
  FieldRenderProps,
  FieldType,
  registerFieldType,
} from './registry';

// ============================================================================
// 内部工具：listener 集合
// ============================================================================

type StringListener = (value: string) => void;

/** notify 所有 listener（订阅者），订阅期间可能被取消，Set 迭代器自带容错 */
function notifyListeners(listeners: Set<StringListener>, value: string): void {
  for (const l of listeners) l(value);
}

// ============================================================================
// duration —— 持续时间（秒数字符串）
// ============================================================================

const SECS_PER_DAY = 86400;
const SECS_PER_HOUR = 3600;
const SECS_PER_MINUTE = 60;

/** 秒数 → 天/时/分（向下取整，丢弃秒级精度，UI 不展示秒） */
function splitDuration(
  seconds: number,
): { days: number; hours: number; minutes: number } {
  let rest = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const days = Math.floor(rest / SECS_PER_DAY);
  rest %= SECS_PER_DAY;
  const hours = Math.floor(rest / SECS_PER_HOUR);
  rest %= SECS_PER_HOUR;
  const minutes = Math.floor(rest / SECS_PER_MINUTE);
  return { days, hours, minutes };
}

/** 天/时/分 → 秒数（负数/NaN 当 0 处理，确保合并结果始终非负有限） */
function mergeDuration(days: number, hours: number, minutes: number): number {
  const d = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
  const h = Number.isFinite(hours) && hours > 0 ? Math.floor(hours) : 0;
  const m = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
  return d * SECS_PER_DAY + h * SECS_PER_HOUR + m * SECS_PER_MINUTE;
}

function validateDuration(
  value: string,
  fieldDef?: FieldDef,
): ValidationError[] {
  const fieldName = fieldDef?.key ?? 'duration';
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return [
      {
        field: fieldName,
        message: '持续时间必须是有效数字',
        severity: 'error',
      },
    ];
  }
  if (n < 0) {
    return [
      { field: fieldName, message: '持续时间不能为负数', severity: 'error' },
    ];
  }
  return [];
}

const durationType: FieldType<string> = {
  key: 'duration',
  name: '持续时间',
  create(props: FieldRenderProps<string>): FieldController<string> {
    let current = props.value;
    const listeners = new Set<StringListener>();

    const root = document.createElement('div');
    root.className = 'ft-duration';

    const daysInput = document.createElement('input');
    daysInput.type = 'number';
    daysInput.min = '0';
    daysInput.step = '1';
    daysInput.placeholder = '天';
    daysInput.setAttribute('aria-label', '天');

    const hoursInput = document.createElement('input');
    hoursInput.type = 'number';
    hoursInput.min = '0';
    hoursInput.max = '23';
    hoursInput.step = '1';
    hoursInput.placeholder = '时';
    hoursInput.setAttribute('aria-label', '时');

    const minutesInput = document.createElement('input');
    minutesInput.type = 'number';
    minutesInput.min = '0';
    minutesInput.max = '59';
    minutesInput.step = '1';
    minutesInput.placeholder = '分';
    minutesInput.setAttribute('aria-label', '分');

    // 初始回填
    const init = splitDuration(Number(current));
    daysInput.value = String(init.days);
    hoursInput.value = String(init.hours);
    minutesInput.value = String(init.minutes);

    if (props.disabled) {
      daysInput.disabled = true;
      hoursInput.disabled = true;
      minutesInput.disabled = true;
    }

    const handleInput = () => {
      const seconds = mergeDuration(
        Number(daysInput.value),
        Number(hoursInput.value),
        Number(minutesInput.value),
      );
      current = String(seconds);
      props.onChange(current);
      notifyListeners(listeners, current);
    };
    daysInput.addEventListener('input', handleInput);
    hoursInput.addEventListener('input', handleInput);
    minutesInput.addEventListener('input', handleInput);

    root.appendChild(daysInput);
    root.appendChild(hoursInput);
    root.appendChild(minutesInput);

    return {
      getValue() {
        return current;
      },
      setValue(value: string) {
        current = value;
        const s = splitDuration(Number(value));
        daysInput.value = String(s.days);
        hoursInput.value = String(s.hours);
        minutesInput.value = String(s.minutes);
        notifyListeners(listeners, current);
      },
      subscribe(listener: StringListener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      validate() {
        return validateDuration(current, props.fieldDef);
      },
      getElement() {
        return root;
      },
      destroy() {
        daysInput.removeEventListener('input', handleInput);
        hoursInput.removeEventListener('input', handleInput);
        minutesInput.removeEventListener('input', handleInput);
        listeners.clear();
        root.remove();
      },
    };
  },
  parse(raw: string): string {
    return raw;
  },
  serialize(value: string): string {
    return value;
  },
  defaultValue(): string {
    return '86400';
  },
  validate: validateDuration,
};

// ============================================================================
// recurrence —— 循环规则（JSON array string，CSV 透传不 JSON.parse）
// ============================================================================

function validateRecurrence(
  value: string,
  fieldDef?: FieldDef,
): ValidationError[] {
  const fieldName = fieldDef?.key ?? 'recurrence';
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // 不阻断保存，仅 warning（与 plan 数据模型一致：脏 JSON 透传）
    return [
      { field: fieldName, message: '循环规则不是合法的 JSON', severity: 'warning' },
    ];
  }
  if (!Array.isArray(parsed)) {
    return [
      { field: fieldName, message: '循环规则必须是数组', severity: 'warning' },
    ];
  }
  return [];
}

const recurrenceType: FieldType<string> = {
  key: 'recurrence',
  name: '循环规则',
  create(props: FieldRenderProps<string>): FieldController<string> {
    let current = props.value;
    const listeners = new Set<StringListener>();

    // 阶段 1：单文本输入（CSV 原样透传）。阶段 3 会替换为 5 模式 wizard。
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ft-recurrence';
    input.value = current;
    input.placeholder = '[1,0,0,0,0,0,0]';
    if (props.disabled) input.disabled = true;

    const handleInput = () => {
      current = input.value;
      props.onChange(current);
      notifyListeners(listeners, current);
    };
    input.addEventListener('input', handleInput);

    return {
      getValue() {
        return current;
      },
      setValue(value: string) {
        current = value;
        input.value = value;
        notifyListeners(listeners, current);
      },
      subscribe(listener: StringListener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      validate() {
        return validateRecurrence(current, props.fieldDef);
      },
      getElement() {
        return input;
      },
      destroy() {
        input.removeEventListener('input', handleInput);
        listeners.clear();
        input.remove();
      },
    };
  },
  parse(raw: string): string {
    return raw;
  },
  serialize(value: string): string {
    return value;
  },
  defaultValue(): string {
    return '[1]';
  },
  validate: validateRecurrence,
};

// ============================================================================
// derived —— 派生字段（dependency/mutex 用，值从 settings 反查填充）
// ============================================================================

const derivedType: FieldType<string> = {
  key: 'derived',
  name: '派生字段',
  create(props: FieldRenderProps<string>): FieldController<string> {
    let current = props.value;
    const listeners = new Set<StringListener>();

    // 只读：值由调用方根据 settings.dependencies / settings.mutexGroups 反查后 setValue 注入
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ft-derived';
    input.readOnly = true;
    input.value = current;
    if (props.disabled) input.disabled = true;

    return {
      getValue() {
        return current;
      },
      setValue(value: string) {
        current = value;
        input.value = value;
        notifyListeners(listeners, current);
      },
      subscribe(listener: StringListener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      validate() {
        // 派生字段不由用户填写，不做校验
        return [];
      },
      getElement() {
        return input;
      },
      destroy() {
        listeners.clear();
        input.remove();
      },
    };
  },
  parse(raw: string): string {
    return raw;
  },
  serialize(value: string): string {
    return value;
  },
  defaultValue(): string {
    return '';
  },
  validate(): ValidationError[] {
    return [];
  },
};

// ============================================================================
// group —— 嵌套容器（预埋，阶段 3 按 fieldDef.children 渲染子字段）
// ============================================================================

const groupType: FieldType<string> = {
  key: 'group',
  name: '字段组',
  create(props: FieldRenderProps<string>): FieldController<string> {
    let current = props.value;
    const listeners = new Set<StringListener>();

    const container = document.createElement('div');
    container.className = 'ft-group';

    // 阶段 1 简化为 textarea；阶段 3 会按 props.fieldDef.children 渲染子字段
    const textarea = document.createElement('textarea');
    textarea.className = 'ft-group-editor';
    textarea.value = current;
    textarea.placeholder = '{}';
    if (props.disabled) textarea.disabled = true;

    const handleInput = () => {
      current = textarea.value;
      props.onChange(current);
      notifyListeners(listeners, current);
    };
    textarea.addEventListener('input', handleInput);

    container.appendChild(textarea);

    return {
      getValue() {
        return current;
      },
      setValue(value: string) {
        current = value;
        textarea.value = value;
        notifyListeners(listeners, current);
      },
      subscribe(listener: StringListener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      validate() {
        // 嵌套容器的子字段校验由各自子字段类型负责，容器本身不做校验
        return [];
      },
      getElement() {
        return container;
      },
      destroy() {
        textarea.removeEventListener('input', handleInput);
        listeners.clear();
        container.remove();
      },
    };
  },
  parse(raw: string): string {
    return raw;
  },
  serialize(value: string): string {
    return value;
  },
  defaultValue(): string {
    return '{}';
  },
  validate(): ValidationError[] {
    return [];
  },
};

// ============================================================================
// 注册入口
// ============================================================================

/**
 * 注册全部 4 种高级字段类型
 *
 * 注意：registry.ts 的 registerFieldType 形参是 FieldType<unknown>，
 * 而本文件具体类型用 FieldType<string>（保内部强类型）。
 * 因 serialize/validate/create 的 props 在 T 上逆变，FieldType<string>
 * 不能直接赋给 FieldType<unknown>，故在注册边界用 `as unknown as FieldType` 转换。
 * registry 接口不可改（见任务硬规则），此转换是兼容 registry 弱类型的必要桥接。
 */
export function registerAdvanced(): void {
  registerFieldType(durationType as unknown as FieldType);
  registerFieldType(recurrenceType as unknown as FieldType);
  registerFieldType(derivedType as unknown as FieldType);
  registerFieldType(groupType as unknown as FieldType);
}
