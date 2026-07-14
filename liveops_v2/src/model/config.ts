/**
 * model/config.ts — Config 领域模型
 *
 * newId 沿用 v1 的 Date.now().toString()，不可改 UUID——
 * configId 是 configOrder/barColors/mergeGroups 的跨表关联键（见 plan 数据模型 critical 15）。
 * copyConfig 修复 v1 浅拷贝 + activityKey 冲突（critical 5 bug）。
 */

import { Config } from '@/core/types';

export function newId(): string {
  // 防同毫秒冲突：尾加随机 3 位（v1 仅 Date.now()，快连点会撞）
  return `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
}

export function createEmptyConfig(activityKey = ''): Config {
  return {
    id: newId(),
    activityKey,
    enabled: '1',
    scheduleStartDate: '',
    scheduleEndDate: '',
    startTime: '10:00',
    duration: '86400',
    recurrenceValue: '[1]',
    skin: '',
    segments: '',
    params: '',
    dependency: '',
    mutex: '[]',
  };
}

/** copyConfig：修复 v1 浅拷贝问题 + 可选改 activityKey 避免冲突 */
export function copyConfig(
  source: Config,
  opts?: { newActivityKey?: string; newId?: string },
): Config {
  return {
    ...source,
    id: opts?.newId ?? newId(),
    activityKey: opts?.newActivityKey ?? source.activityKey,
  };
}
