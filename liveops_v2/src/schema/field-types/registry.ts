/**
 * schema/field-types/registry.ts — 字段类型注册表 + Controller 接口
 *
 * 破 critical 8：FieldType.render() 单接口装不下 duration/recurrence/dependency 复合控件。
 * 改为 create() → FieldController，显式生命周期（getValue/setValue/subscribe/validate/destroy），
 * 复合字段（duration 天时分、recurrence 5 模式 wizard）定义为 FieldGroup。
 *
 * 接口在阶段 1 定型（预埋 children/resolve），阶段 1 内置类型用简化控件，
 * 阶段 3 完善 wizard 复合控件——接口稳定，实现渐进，不 throwaway。
 */

import { ValidationError } from '@/core/types';

// ----------------------------------------------------------------------------
// FieldDef —— 字段定义（csv-schema 和 params-schema 共用）
// ----------------------------------------------------------------------------

export interface FieldDef {
  key: string;
  fieldType: string; // 注册表内的 type key
  label?: string;
  required?: boolean;
  default?: unknown;
  help?: string;
  options?: { value: string; label: string }[]; // enum 用
  /** 嵌套支持：fieldType 为 'group' 时使用（预埋，阶段 3 完整实现） */
  children?: FieldDef[];
  /** 标记废弃：隐藏但保留序列化（策划删除字段时） */
  deprecated?: boolean;
  /** 派生字段：值不存 CSV 而从 settings 反查（dependency/mutex） */
  derived?: boolean;
}

// ----------------------------------------------------------------------------
// FieldController —— 控件生命周期
// ----------------------------------------------------------------------------

export interface FieldRenderProps<T> {
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  fieldDef: FieldDef;
  /** 兄弟字段值访问器（用于跨字段联动 preview，如 cycleEnd 依赖 startDate+recurrence） */
  getSibling?: (key: string) => unknown;
}

export interface FieldController<T = unknown> {
  getValue(): T;
  setValue(value: T): void;
  subscribe(listener: (value: T) => void): () => void;
  validate(): ValidationError[];
  getElement(): HTMLElement;
  destroy(): void;
}

// ----------------------------------------------------------------------------
// FieldType —— 注册的类型
// ----------------------------------------------------------------------------

export interface FieldType<T = unknown> {
  key: string;
  name: string;
  /** 创建控件实例（阶段 1 简化控件，阶段 3 完善复合控件） */
  create(props: FieldRenderProps<T>): FieldController<T>;
  /** CSV/存储字符串 → 值（容错：非法→default，不抛异常） */
  parse(raw: string): T;
  /** 值 → CSV/存储字符串 */
  serialize(value: T): string;
  /** 默认值 */
  defaultValue(): T;
  /** 单字段校验（跨字段校验在 validators.ts 的 ConfigValidator） */
  validate(value: T, fieldDef?: FieldDef): ValidationError[];
}

// ----------------------------------------------------------------------------
// 注册表
// ----------------------------------------------------------------------------

const registry = new Map<string, FieldType>();

export function registerFieldType(t: FieldType): void {
  registry.set(t.key, t);
}

export function getFieldType(key: string): FieldType | undefined {
  return registry.get(key);
}

export function getAllFieldTypes(): FieldType[] {
  return Array.from(registry.values());
}

export function requireFieldType(key: string): FieldType {
  const t = registry.get(key);
  if (!t) throw new Error(`未注册的字段类型: ${key}`);
  return t;
}
