/**
 * model/recurrence/builtin.ts — 5 种内置循环模式 + parseRecurrenceValue
 *
 * parseRecurrenceValue 判定顺序是 v1 的隐式不变量（critical，覆盖度审计 critical 11）：
 *   JSON.parse 失败/非数组 → single
 *   [1] → single
 *   onesCount===1 → interval    （★ 先于长度判断！）
 *   length===7 → weekly
 *   length===14 → biweekly
 *   否则 → custom
 * 顺序错了会导致 [1,0,0,0,0,0,0]（长度7但只有一个1）被反推成 weekly 而非 interval。
 */

import { RecurrenceBuildCtx, RecurrenceMode, WizardState } from './registry';
import { registerRecurrenceMode } from './registry';

// ----------------------------------------------------------------------------
// parseRecurrenceValue（v1 判定顺序，critical）
// ----------------------------------------------------------------------------

export function parseRecurrenceValue(value: string): string {
  let arr: unknown;
  try {
    arr = JSON.parse(value);
  } catch {
    return 'single';
  }
  if (!Array.isArray(arr)) return 'single';
  if (arr.length === 1 && arr[0] === 1) return 'single';
  const onesCount = arr.filter((v) => v === 1).length;
  if (onesCount === 1) return 'interval'; // ★ 先于长度
  if (arr.length === 7) return 'weekly';
  if (arr.length === 14) return 'biweekly';
  return 'custom';
}

// ----------------------------------------------------------------------------
// 5 种模式
// ----------------------------------------------------------------------------

const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

const singleMode: RecurrenceMode = {
  key: 'single',
  name: '单次开启',
  build(_state: WizardState, ctx?: RecurrenceBuildCtx): number[] {
    // v1: durationDays = Math.ceil(durationSeconds/86400)，长度=durationDays，第1天开
    const days = Math.max(
      1,
      Math.ceil((ctx?.durationSeconds ?? 86400) / 86400),
    );
    const arr = new Array(days).fill(0);
    arr[0] = 1;
    return arr;
  },
  parse(_arr: number[]): Partial<WizardState> {
    return { mode: 'single' };
  },
  preview(_arr: number[]): string {
    return '[1] 单次开启';
  },
};

const intervalMode: RecurrenceMode = {
  key: 'interval',
  name: '间隔N天',
  build(state: WizardState): number[] {
    const n = Math.max(1, state.intervalDays || 7);
    const arr = new Array(n).fill(0);
    arr[0] = 1;
    return arr;
  },
  parse(arr: number[]): Partial<WizardState> {
    return { mode: 'interval', intervalDays: arr.length };
  },
  preview(arr: number[]): string {
    return `每${arr.length}天开启一次`;
  },
};

const weeklyMode: RecurrenceMode = {
  key: 'weekly',
  name: '每周循环',
  build(state: WizardState): number[] {
    const arr = new Array(7).fill(0);
    for (const d of state.weekdays) if (d >= 1 && d <= 7) arr[d - 1] = 1;
    return arr;
  },
  parse(arr: number[]): Partial<WizardState> {
    const weekdays: number[] = [];
    for (let i = 0; i < arr.length && i < 7; i++) {
      if (arr[i] === 1) weekdays.push(i + 1);
    }
    return { mode: 'weekly', weekdays };
  },
  preview(arr: number[]): string {
    const days: string[] = [];
    for (let i = 0; i < arr.length && i < 7; i++) {
      if (arr[i] === 1) days.push(WEEKDAY_NAMES[i] ?? String(i + 1));
    }
    return days.length ? `每周${days.join('、')}开启` : '每周循环';
  },
};

const biweeklyMode: RecurrenceMode = {
  key: 'biweekly',
  name: '双周循环',
  build(state: WizardState): number[] {
    const arr = new Array(14).fill(0);
    for (const d of state.biweeklyDays) if (d >= 1 && d <= 14) arr[d - 1] = 1;
    return arr;
  },
  parse(arr: number[]): Partial<WizardState> {
    const days: number[] = [];
    for (let i = 0; i < arr.length && i < 14; i++) {
      if (arr[i] === 1) days.push(i + 1);
    }
    return { mode: 'biweekly', biweeklyDays: days };
  },
  preview(arr: number[]): string {
    const days: string[] = [];
    for (let i = 0; i < arr.length && i < 14; i++) {
      if (arr[i] === 1) days.push(String(i + 1));
    }
    return days.length ? `双周第${days.join('、')}天开启` : '双周循环';
  },
};

const customMode: RecurrenceMode = {
  key: 'custom',
  name: '自定义周期',
  build(state: WizardState): number[] {
    const n = Math.max(2, state.customPeriod || 5);
    const arr = new Array(n).fill(0);
    for (const d of state.customDays) if (d >= 1 && d <= n) arr[d - 1] = 1;
    return arr;
  },
  parse(arr: number[]): Partial<WizardState> {
    const days: number[] = [];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === 1) days.push(i + 1);
    }
    return { mode: 'custom', customPeriod: arr.length, customDays: days };
  },
  preview(arr: number[]): string {
    const days: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === 1) days.push(String(i + 1));
    }
    return `周期${arr.length}天，第${days.join('、')}天开启`;
  },
};

/** 注册全部内置模式 */
export function registerBuiltinRecurrenceModes(): void {
  registerRecurrenceMode(singleMode);
  registerRecurrenceMode(intervalMode);
  registerRecurrenceMode(weeklyMode);
  registerRecurrenceMode(biweeklyMode);
  registerRecurrenceMode(customMode);
}
