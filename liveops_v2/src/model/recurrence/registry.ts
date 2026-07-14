/**
 * model/recurrence/registry.ts — 循环模式注册表
 *
 * 阶段 1 提供 registry 框架 + builtin 5 模式的元数据/parse。
 * 完整 wizard（build + 表单控件）在阶段 3 落地，但接口在此定型。
 */

export interface WizardState {
  mode: string;
  intervalDays: number; // interval 模式间隔天数
  weekdays: number[]; // weekly 模式选择的星期 1..7
  biweeklyDays: number[]; // biweekly 模式选择的天数 1..14
  customPeriod: number; // custom 模式周期长度
  customDays: number[]; // custom 模式周期内开启的天序号
}

export interface RecurrenceBuildCtx {
  durationSeconds?: number; // single 模式需要 duration 决定数组长度
}

export interface RecurrenceMode {
  key: string; // 'single' | 'interval' | 'weekly' | 'biweekly' | 'custom'
  name: string; // 显示名
  /** 从 wizard 表单状态生成 recurrenceValue 数组 */
  build(state: WizardState, ctx?: RecurrenceBuildCtx): number[];
  /** 从 recurrenceValue 反推 wizard 状态（用于回填表单） */
  parse(arr: number[]): Partial<WizardState>;
  /** 人类可读预览 */
  preview(arr: number[]): string;
}

const modes = new Map<string, RecurrenceMode>();

export function registerRecurrenceMode(m: RecurrenceMode): void {
  modes.set(m.key, m);
}

export function getRecurrenceMode(key: string): RecurrenceMode | undefined {
  return modes.get(key);
}

export function getAllRecurrenceModes(): RecurrenceMode[] {
  return Array.from(modes.values());
}
