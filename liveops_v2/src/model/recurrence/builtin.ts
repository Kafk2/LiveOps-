/**
 * model/recurrence/builtin.ts — 5 种内置循环模式（数据逻辑 + UI 扩展）
 *
 * parseRecurrenceValue 判定顺序是 v1 的隐式不变量（critical）：
 *   JSON.parse 失败/非数组 → single
 *   [1] → single
 *   onesCount===1 → interval    （★ 先于长度判断！）
 *   length===7 → weekly
 *   length===14 → biweekly
 *   否则 → custom
 *
 * 每个模式自包含：build/parse/preview（数据）+ createEditor（UI）。
 * 新增模式只需实现 RecurrenceMode 接口并 registerRecurrenceMode，wizard 自动获得入口与面板。
 */

import { RecurrenceMode, WizardState } from './registry';
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
// DOM helper（模式 UI 用）
// ----------------------------------------------------------------------------

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const k in attrs) e.setAttribute(k, attrs[k] ?? '');
  for (const c of children) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function btnStyle(active: boolean): string {
  return (
    'padding:4px 8px;border:1px solid ' +
    (active ? 'var(--color-primary)' : 'var(--color-border)') +
    ';background:' +
    (active ? 'var(--color-primary)' : 'white') +
    ';color:' +
    (active ? 'white' : 'inherit') +
    ';border-radius:3px;cursor:pointer;font-size:12px;'
  );
}

function toggleRow(
  labels: string[],
  selected: number[],
  onToggle: (day: number) => void,
): HTMLElement {
  const row = h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap;' });
  labels.forEach((label, i) => {
    const day = i + 1;
    const active = selected.includes(day);
    const btn = h('button', { type: 'button', 'data-active': active ? '1' : '0', style: btnStyle(active) }, [label]);
    btn.addEventListener('click', () => {
      const na = btn.dataset.active !== '1';
      btn.dataset.active = na ? '1' : '0';
      btn.style.cssText = btnStyle(na);
      onToggle(day);
    });
    row.appendChild(btn);
  });
  return row;
}

const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

// ----------------------------------------------------------------------------
// 5 种模式
// ----------------------------------------------------------------------------

const singleMode: RecurrenceMode = {
  key: 'single',
  name: '单次开启',
  build(_state, ctx): number[] {
    const days = Math.max(1, Math.ceil((ctx?.durationSeconds ?? 86400) / 86400));
    const arr = new Array(days).fill(0);
    arr[0] = 1;
    return arr;
  },
  parse(): Partial<WizardState> {
    return { mode: 'single' };
  },
  preview(): string {
    return '单次开启';
  },
  createEditor(_state, _onChange): HTMLElement {
    return h('div', { class: 'hint', style: 'font-size:12px;color:var(--color-text-secondary);' }, [
      '单次开启：活动按开始时间 + 持续时间执行一次。',
    ]);
  },
};

const intervalMode: RecurrenceMode = {
  key: 'interval',
  name: '间隔N天',
  build(state): number[] {
    const n = Math.max(1, state.intervalDays || 7);
    const arr = new Array(n).fill(0);
    arr[0] = 1;
    return arr;
  },
  parse(arr): Partial<WizardState> {
    return { mode: 'interval', intervalDays: arr.length };
  },
  preview(arr): string {
    return `每${arr.length}天开启一次`;
  },
  createEditor(state, onChange): HTMLElement {
    const wrap = h('div', { style: 'display:flex;align-items:center;gap:8px;' });
    wrap.appendChild(h('label', { style: 'font-size:13px;' }, ['间隔天数']));
    const input = h('input', {
      type: 'number',
      min: '1',
      max: '365',
      value: String(state.intervalDays || 7),
      style: 'width:80px;padding:4px;border:1px solid var(--color-border);border-radius:3px;',
    });
    input.addEventListener('input', () => {
      const n = Math.max(1, parseInt((input as HTMLInputElement).value) || 7);
      onChange({ ...state, intervalDays: n });
    });
    wrap.appendChild(input);
    wrap.appendChild(h('span', { style: 'font-size:12px;color:var(--color-text-secondary);' }, ['天']));
    return wrap;
  },
};

const weeklyMode: RecurrenceMode = {
  key: 'weekly',
  name: '每周循环',
  build(state): number[] {
    const arr = new Array(7).fill(0);
    for (const d of state.weekdays) if (d >= 1 && d <= 7) arr[d - 1] = 1;
    return arr;
  },
  parse(arr): Partial<WizardState> {
    const weekdays: number[] = [];
    for (let i = 0; i < arr.length && i < 7; i++) if (arr[i] === 1) weekdays.push(i + 1);
    return { mode: 'weekly', weekdays };
  },
  preview(arr): string {
    const days: string[] = [];
    for (let i = 0; i < arr.length && i < 7; i++) if (arr[i] === 1) days.push(WEEKDAY_NAMES[i] ?? String(i + 1));
    return days.length ? `每周${days.join('、')}开启` : '每周循环（未选择）';
  },
  createEditor(state, onChange): HTMLElement {
    let cur = { ...state };
    const wrap = h('div');
    wrap.appendChild(h('div', { style: 'font-size:12px;color:var(--color-text-secondary);margin-bottom:6px;' }, ['选择每周开启的星期']));
    wrap.appendChild(
      toggleRow(WEEKDAY_NAMES, cur.weekdays, (day) => {
        const set = new Set(cur.weekdays);
        if (set.has(day)) set.delete(day);
        else set.add(day);
        cur = { ...cur, weekdays: Array.from(set).sort((a, b) => a - b) };
        onChange(cur);
      }),
    );
    return wrap;
  },
};

const biweeklyMode: RecurrenceMode = {
  key: 'biweekly',
  name: '双周循环',
  build(state): number[] {
    const arr = new Array(14).fill(0);
    for (const d of state.biweeklyDays) if (d >= 1 && d <= 14) arr[d - 1] = 1;
    return arr;
  },
  parse(arr): Partial<WizardState> {
    const days: number[] = [];
    for (let i = 0; i < arr.length && i < 14; i++) if (arr[i] === 1) days.push(i + 1);
    return { mode: 'biweekly', biweeklyDays: days };
  },
  preview(arr): string {
    const days: string[] = [];
    for (let i = 0; i < arr.length && i < 14; i++) if (arr[i] === 1) days.push(String(i + 1));
    return days.length ? `双周第${days.join('、')}天开启` : '双周循环（未选择）';
  },
  createEditor(state, onChange): HTMLElement {
    let cur = { ...state };
    const wrap = h('div');
    wrap.appendChild(h('div', { style: 'font-size:12px;color:var(--color-text-secondary);margin-bottom:6px;' }, ['选择双周循环开启的天数']));
    wrap.appendChild(
      toggleRow(
        Array.from({ length: 14 }, (_, i) => String(i + 1)),
        cur.biweeklyDays,
        (day) => {
          const set = new Set(cur.biweeklyDays);
          if (set.has(day)) set.delete(day);
          else set.add(day);
          cur = { ...cur, biweeklyDays: Array.from(set).sort((a, b) => a - b) };
          onChange(cur);
        },
      ),
    );
    return wrap;
  },
};

const customMode: RecurrenceMode = {
  key: 'custom',
  name: '自定义周期',
  build(state): number[] {
    const n = Math.max(2, state.customPeriod || 5);
    const arr = new Array(n).fill(0);
    for (const d of state.customDays) if (d >= 1 && d <= n) arr[d - 1] = 1;
    return arr;
  },
  parse(arr): Partial<WizardState> {
    const days: number[] = [];
    for (let i = 0; i < arr.length; i++) if (arr[i] === 1) days.push(i + 1);
    return { mode: 'custom', customPeriod: arr.length, customDays: days };
  },
  preview(arr): string {
    const days: string[] = [];
    for (let i = 0; i < arr.length; i++) if (arr[i] === 1) days.push(String(i + 1));
    return days.length ? `周期${arr.length}天，第${days.join('、')}天开启` : '自定义（未选择）';
  },
  createEditor(state, onChange): HTMLElement {
    let cur = { ...state };
    const wrap = h('div');
    const periodRow = h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
    periodRow.appendChild(h('label', { style: 'font-size:13px;' }, ['周期长度（天）']));
    const periodInput = h('input', {
      type: 'number',
      min: '2',
      max: '365',
      value: String(state.customPeriod || 5),
      style: 'width:80px;padding:4px;border:1px solid var(--color-border);border-radius:3px;',
    });
    periodInput.addEventListener('input', () => {
      const n = Math.max(2, parseInt((periodInput as HTMLInputElement).value) || 5);
      cur = { ...cur, customPeriod: n, customDays: cur.customDays.filter((d) => d <= n) };
      onChange(cur);
    });
    periodRow.appendChild(periodInput);
    wrap.appendChild(periodRow);
    wrap.appendChild(h('div', { style: 'font-size:12px;color:var(--color-text-secondary);margin-bottom:6px;' }, ['选择周期内开启的天']));
    const period = Math.max(2, state.customPeriod || 5);
    wrap.appendChild(
      toggleRow(
        Array.from({ length: period }, (_, i) => String(i + 1)),
        cur.customDays,
        (day) => {
          const set = new Set(cur.customDays);
          if (set.has(day)) set.delete(day);
          else set.add(day);
          cur = { ...cur, customDays: Array.from(set).sort((a, b) => a - b) };
          onChange(cur);
        },
      ),
    );
    return wrap;
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
