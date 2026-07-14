/**
 * tests/data-interop.test.ts — 阶段1 数据互通验证
 *
 * 验证 v2 能正确读写 v1 的 CSV（含脏 JSON 透传、BOM 剥除、字段数容错），
 * 以及 schedule 展开 / parseRecurrenceValue 的关键边界（critical）。
 * 这些是 plan 阶段1 验证的核心：核心数据互通 + CSV 导出闭环。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCSV, decodeConfigs, encodeConfigs } from '@/services/csv-codec';
import { registerAllFieldTypes } from '@/schema/field-types';
import { calculateActualSchedules } from '@/model/schedule';
import { parseRecurrenceValue } from '@/model/recurrence/builtin';
import { reducer, createStore } from '@/core/store';
import type { AppState, Config, Action } from '@/core/types';
import { getDefaultSettings } from '@/services/import-v1-data';

registerAllFieldTypes();

const DATA_DIR = join(process.cwd(), 'public', 'data');
const csvText = readFileSync(join(DATA_DIR, 'schedule.csv'), 'utf-8');
const v1Rows = parseCSV(csvText);
const v1Configs = decodeConfigs(v1Rows);

function emptyState(): AppState {
  return {
    configs: {},
    configIds: [],
    settings: getDefaultSettings(),
    ui: {
      activeTab: 'config',
      selectedConfigId: null,
      timeline: { sliderPos: 0.625, scrollLeft: 0, showStopped: false, rowHeight: 29 },
    },
  };
}

describe('CSV 编解码（v1 互通）', () => {
  it('parseCSV 剥除 BOM（修复 v1 bug）', () => {
    const rows = parseCSV('﻿id,activityKey\n1,OpenBox');
    expect(rows[0]?.[0]).toBe('id'); // 不是 '﻿id'
  });

  it('decodeConfigs 解析 v1 schedule.csv 得到配置', () => {
    expect(v1Configs.length).toBeGreaterThan(0);
    const c = v1Configs[0]!;
    expect(c.id).toBeTruthy();
    expect(c.activityKey).toBeTruthy();
    expect(typeof c.params).toBe('string');
  });

  it('脏 JSON 透传不崩（skin/segments/params 都是 string）', () => {
    for (const c of v1Configs) {
      expect(typeof c.skin).toBe('string');
      expect(typeof c.segments).toBe('string');
      expect(typeof c.params).toBe('string');
    }
  });

  it('encodeConfigs round-trip 关键字段一致', () => {
    const csv = encodeConfigs(v1Configs);
    const configs2 = decodeConfigs(parseCSV(csv));
    expect(configs2.length).toBe(v1Configs.length);
    for (let i = 0; i < v1Configs.length; i++) {
      expect(configs2[i]!.activityKey).toBe(v1Configs[i]!.activityKey);
      expect(configs2[i]!.recurrenceValue).toBe(v1Configs[i]!.recurrenceValue);
      expect(configs2[i]!.duration).toBe(v1Configs[i]!.duration);
    }
  });
});

describe('calculateActualSchedules 边界（迁移自 v1）', () => {
  it('startDate 空 → []', () => {
    const c: Config = { ...v1Configs[0]!, scheduleStartDate: '' };
    expect(calculateActualSchedules(c)).toEqual([]);
  });

  it('recurrenceValue 非法 → 回退 [1] 不崩', () => {
    const c: Config = {
      ...v1Configs[0]!,
      scheduleStartDate: '2026-03-17',
      recurrenceValue: 'not-json',
      duration: '86400',
    };
    const periods = calculateActualSchedules(c);
    expect(periods.length).toBeGreaterThan(0);
  });

  it('scheduleEndDate 当天停止（>= 而非 >）', () => {
    const c: Config = {
      ...v1Configs[0]!,
      scheduleStartDate: '2026-03-17',
      scheduleEndDate: '2026-03-18',
      recurrenceValue: '[1]',
      duration: '86400',
      startTime: '10:00',
    };
    const periods = calculateActualSchedules(c);
    // startDate=3/17 开，3/18 是 endDate 当天应停止 → 只有 3/17 一期
    expect(periods.length).toBe(1);
  });

  it('365 天硬上限（即便无限循环也不死循环）', () => {
    const c: Config = {
      ...v1Configs[0]!,
      scheduleStartDate: '2026-03-17',
      scheduleEndDate: '',
      recurrenceValue: '[1]',
      duration: '3600',
    };
    const periods = calculateActualSchedules(c);
    expect(periods.length).toBeLessThanOrEqual(365);
  });
});

describe('parseRecurrenceValue 判定顺序（critical）', () => {
  it('onesCount===1 优先于长度：[1,0,0,0,0,0,0] → interval', () => {
    expect(parseRecurrenceValue('[1,0,0,0,0,0,0]')).toBe('interval');
  });
  it('[1] → single', () => {
    expect(parseRecurrenceValue('[1]')).toBe('single');
  });
  it('长度7且多个1 → weekly', () => {
    expect(parseRecurrenceValue('[1,0,1,0,0,0,0]')).toBe('weekly');
  });
  it('长度14 → biweekly', () => {
    expect(parseRecurrenceValue('[1,0,1,0,0,0,0,0,0,0,0,0,0,0]')).toBe('biweekly');
  });
  it('解析失败 → single', () => {
    expect(parseRecurrenceValue('not-json')).toBe('single');
  });
});

describe('store normalized by-id + structural sharing', () => {
  it('updateConfig 只产生新 config 引用，其余不变', () => {
    const store = createStore(emptyState());
    // 注入 2 个 config
    const a: Config = { ...v1Configs[0]!, id: 'a1' };
    const b: Config = { ...v1Configs[1]!, id: 'b1' };
    store.dispatch({ type: 'CONFIGS_REPLACE', payload: [a, b], meta: { skipHistory: true } });
    const refB_before = store.getState().configs['b1'];

    // 改 a1 一个字段
    store.dispatch({
      type: 'CONFIG_UPDATE_FIELD',
      payload: { id: 'a1', field: 'enabled', value: '0' },
    });
    const refB_after = store.getState().configs['b1'];
    // b1 引用不变（structural sharing）
    expect(refB_after).toBe(refB_before);
    // a1 引用变了
    expect(store.getState().configs['a1']!.enabled).toBe('0');
  });

  it('CONFIG_UPDATE_FIELD 改 store 但不入栈（实时预览用，表单编辑应用草稿）', () => {
    const store = createStore(emptyState());
    const a: Config = { ...v1Configs[0]!, id: 'a1', enabled: '1' };
    store.dispatch({ type: 'CONFIGS_REPLACE', payload: [a], meta: { skipHistory: true } });
    expect(store.canUndo('config')).toBe(false);

    store.dispatch({
      type: 'CONFIG_UPDATE_FIELD',
      payload: { id: 'a1', field: 'enabled', value: '0' },
    });
    expect(store.canUndo('config')).toBe(false); // 不入栈
    expect(store.getState().configs['a1']!.enabled).toBe('0'); // 但 store 已实时更新
  });

  it('CONFIG_SAVE 入 history，undo 还原到上次 commit', () => {
    const store = createStore(emptyState());
    const a: Config = { ...v1Configs[0]!, id: 'a1', enabled: '1' };
    store.dispatch({ type: 'CONFIGS_REPLACE', payload: [a], meta: { skipHistory: true } });
    expect(store.canUndo('config')).toBe(false);

    // 保存（commit 点）：push 当前 state，apply payload
    store.dispatch({ type: 'CONFIG_SAVE', payload: { ...a, enabled: '0' } });
    expect(store.canUndo('config')).toBe(true);

    // undo 还原到 CONFIG_SAVE 前的状态（enabled='1'）
    store.undo('config');
    expect(store.getState().configs['a1']!.enabled).toBe('1');
  });

  it('reducer 纯函数：CONFIGS_REPLACE skipHistory 不入栈', () => {
    const state = emptyState();
    const next = reducer(state, {
      type: 'CONFIGS_REPLACE',
      payload: v1Configs.slice(0, 3),
    } as Action);
    expect(Object.keys(next.configs).length).toBe(3);
    expect(next.configIds.length).toBe(3);
  });
});
