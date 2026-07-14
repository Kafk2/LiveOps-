/**
 * tests/cycle.test.ts — 循环次数↔结束日期 转换 + duration 工具边界
 *
 * 核心：endDate↔cycleCount round-trip（含 +1 天 trick）、空值、parseDuration/mergeDuration 互逆、
 * validateDurationAgainstPeriod 边界。自 v1 index.html 算法移植的正确性验证。
 */

import { describe, it, expect } from 'vitest';
import {
  parseDuration,
  mergeDuration,
  endDateToCycleCount,
  cycleCountToEndDateString,
  validateDurationAgainstPeriod,
} from '@/model/cycle';

describe('parseDuration / mergeDuration', () => {
  it('秒 → 天/时/分（向下取整）', () => {
    expect(parseDuration(86400)).toEqual({ days: 1, hours: 0, minutes: 0 });
    expect(parseDuration(90000)).toEqual({ days: 1, hours: 1, minutes: 0 }); // 86400+3600
    expect(parseDuration(86460)).toEqual({ days: 1, hours: 0, minutes: 1 });
    expect(parseDuration(0)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });

  it('天/时/分 → 秒', () => {
    expect(mergeDuration(1, 0, 0)).toBe(86400);
    expect(mergeDuration(1, 1, 1)).toBe(86400 + 3600 + 60);
    expect(mergeDuration(0, 0, 0)).toBe(0);
  });

  it('互逆：parse∘merge = identity（秒级精度，丢弃秒以下）', () => {
    const samples = [0, 60, 3600, 86400, 90000, 86460, 7 * 86400 + 3600];
    for (const s of samples) {
      const p = parseDuration(s);
      expect(mergeDuration(p.days, p.hours, p.minutes)).toBe(s);
    }
  });

  it('负数/NaN 当 0', () => {
    expect(parseDuration(-100)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(parseDuration(NaN)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(mergeDuration(-1, -2, -3)).toBe(0);
  });
});

describe('endDateToCycleCount', () => {
  it('空 endDate 返回空串', () => {
    expect(endDateToCycleCount('2024-01-01', '', '[1]')).toBe('');
  });

  it('空 startDate 返回空串', () => {
    expect(endDateToCycleCount('', '2024-02-01', '[1]')).toBe('');
  });

  it('single [1]：endDate 前 N 天 = N 期（结束当天不计）', () => {
    // 每天1期；endDate=2024-01-08，start=2024-01-01 → 1/2/3/4/5/6/7 共7期（第8天 >= end break）
    expect(endDateToCycleCount('2024-01-01', '2024-01-08', '[1]')).toBe('7');
    expect(endDateToCycleCount('2024-01-01', '2024-01-02', '[1]')).toBe('1');
  });

  it('weekly [1,0,0,0,0,0,0]：每周1期', () => {
    // start 周一 2024-01-01，每周一开；endDate=2024-01-22 → 1/8/15 共3期（22>=22 break）
    expect(endDateToCycleCount('2024-01-01', '2024-01-22', '[1,0,0,0,0,0,0]')).toBe('3');
  });

  it('非法日期返回空串', () => {
    expect(endDateToCycleCount('garbage', '2024-01-08', '[1]')).toBe('');
  });
});

describe('cycleCountToEndDateString', () => {
  it('空循环次数/小于1/空 start 返回空串', () => {
    expect(cycleCountToEndDateString('2024-01-01', '', '[1]')).toBe('');
    expect(cycleCountToEndDateString('2024-01-01', '0', '[1]')).toBe('');
    expect(cycleCountToEndDateString('', '3', '[1]')).toBe('');
  });

  it('single [1]：N 期 → start + N 天（+1 天 trick 后 = start + N）', () => {
    // 第 N 期开始日 = start + (N-1)；+1 天 → start + N
    expect(cycleCountToEndDateString('2024-01-01', '1', '[1]')).toBe('2024-01-02');
    expect(cycleCountToEndDateString('2024-01-01', '7', '[1]')).toBe('2024-01-08');
  });

  it('weekly [1,0,0,0,0,0,0]：3 期 → 第3期(第15天)+1 = 第16天', () => {
    // 期: day1(1/1), day8(1/8), day15(1/15); +1 → 2024-01-16
    expect(cycleCountToEndDateString('2024-01-01', '3', '[1,0,0,0,0,0,0]')).toBe('2024-01-16');
  });
});

describe('round-trip: endDate → cycleCount → endDate', () => {
  it('single round-trip 稳定（+1 天 trick 让两函数配对）', () => {
    const start = '2024-01-01';
    const rv = '[1]';
    for (const n of [1, 3, 7, 30]) {
      const endDate = cycleCountToEndDateString(start, String(n), rv);
      const back = endDateToCycleCount(start, endDate, rv);
      expect(back).toBe(String(n));
    }
  });

  it('weekly round-trip 稳定', () => {
    const start = '2024-01-01';
    const rv = '[1,0,0,0,0,0,0]';
    for (const n of [1, 2, 5, 10]) {
      const endDate = cycleCountToEndDateString(start, String(n), rv);
      const back = endDateToCycleCount(start, endDate, rv);
      expect(back).toBe(String(n));
    }
  });
});

describe('validateDurationAgainstPeriod', () => {
  it('duration ≤ 周期长度 → ok', () => {
    expect(validateDurationAgainstPeriod(86400, '[1]').ok).toBe(true); // 1天 = 1天周期
    expect(validateDurationAgainstPeriod(3600, '[1,0,0,0,0,0,0]').ok).toBe(true); // 1小时 < 7天
  });

  it('duration > 周期长度 → !ok', () => {
    const r = validateDurationAgainstPeriod(86400 * 8, '[1,0,0,0,0,0,0]');
    expect(r.ok).toBe(false); // 8天 > 7天周期
    expect(r.maxSeconds).toBe(7 * 86400);
  });

  it('脏 JSON 回退 [1]（1天周期）', () => {
    expect(validateDurationAgainstPeriod(86400, 'garbage').maxSeconds).toBe(86400);
  });
});
