/**
 * tests/normalizers.test.ts — 周一校验 normalizer 边界
 *
 * 验证 enforceMondayStartDate 在 weekly/biweekly 模式下校正非周一开始日期，
 * 其余模式不动；与 v1 (index.html enforceMondayStartDate) 行为一致。
 */

import { describe, it, expect } from 'vitest';
import {
  enforceMondayStartDate,
  adjustToMonday,
} from '@/model/normalizers/builtin';
import type { Config } from '@/core/types';

function mkConfig(start: string, recurrence: string): Config {
  return {
    id: '1',
    activityKey: 'k',
    enabled: '1',
    scheduleStartDate: start,
    scheduleEndDate: '',
    startTime: '10:00',
    duration: '86400',
    recurrenceValue: recurrence,
    skin: '',
    segments: '',
    params: '{}',
    dependency: '',
    mutex: '[]',
  };
}

describe('adjustToMonday', () => {
  it('weekly 模式：周二开始 → 校正到本周一', () => {
    // 2024-01-02 是周二 → 2024-01-01 周一
    expect(adjustToMonday('2024-01-02', 'weekly')).toBe('2024-01-01');
  });

  it('weekly 模式：周日开始 → 校正到下周一（diff -6 → 上周一）', () => {
    // v1 语义：周日 diff = -6 → 回退到上一个周一
    // 2024-01-07 周日 → 2024-01-01 周一
    expect(adjustToMonday('2024-01-07', 'weekly')).toBe('2024-01-01');
  });

  it('weekly 模式：周六开始 → 校正到本周一（diff 1-6=-5）', () => {
    // 2024-01-06 周六 → 2024-01-01 周一
    expect(adjustToMonday('2024-01-06', 'weekly')).toBe('2024-01-01');
  });

  it('weekly 模式：已是周一 → 返回 null（不改）', () => {
    expect(adjustToMonday('2024-01-01', 'weekly')).toBeNull();
  });

  it('biweekly 模式：与 weekly 同样触发校正', () => {
    expect(adjustToMonday('2024-01-02', 'biweekly')).toBe('2024-01-01');
    expect(adjustToMonday('2024-01-01', 'biweekly')).toBeNull();
  });

  it('single/interval/custom 模式：不校正返回 null', () => {
    expect(adjustToMonday('2024-01-02', 'single')).toBeNull();
    expect(adjustToMonday('2024-01-02', 'interval')).toBeNull();
    expect(adjustToMonday('2024-01-02', 'custom')).toBeNull();
  });

  it('空开始日期 → null', () => {
    expect(adjustToMonday('', 'weekly')).toBeNull();
  });

  it('非法日期格式 → null（不动）', () => {
    expect(adjustToMonday('2024/01/02', 'weekly')).toBeNull();
    expect(adjustToMonday('garbage', 'weekly')).toBeNull();
  });
});

describe('enforceMondayStartDate normalizer', () => {
  it('weekly 周二 → 校正 + 提示', () => {
    const r = enforceMondayStartDate.normalize(mkConfig('2024-01-02', '[1,0,1,0,0,0,0]'));
    expect(r.config.scheduleStartDate).toBe('2024-01-01');
    expect(r.message).toContain('2024-01-01');
  });

  it('weekly 已周一 → 不改无提示', () => {
    const r = enforceMondayStartDate.normalize(mkConfig('2024-01-01', '[1,0,1,0,0,0,0]'));
    expect(r.config.scheduleStartDate).toBe('2024-01-01');
    expect(r.message).toBeUndefined();
  });

  it('single 模式不改值', () => {
    const r = enforceMondayStartDate.normalize(mkConfig('2024-01-02', '[1]'));
    expect(r.config.scheduleStartDate).toBe('2024-01-02');
    expect(r.message).toBeUndefined();
  });

  it('空开始日期不改值', () => {
    const r = enforceMondayStartDate.normalize(mkConfig('', '[1,0,1,0,0,0,0]'));
    expect(r.config.scheduleStartDate).toBe('');
    expect(r.message).toBeUndefined();
  });
});
