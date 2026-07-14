/**
 * model/schedule.ts — 循环展开（迁移 v1 calculateActualSchedules 全边界）
 *
 * 边界契约（plan critical + 覆盖度审计 critical 6）：
 * - startDate 空 → []
 * - recurrenceValue 解析失败 → [1]
 * - startTime 缺省 '10:00'，duration 缺省 86400
 * - day=1..365 硬上限（即便无限循环也不死循环）
 * - scheduleEndDate 当天停止：currentDate >= scheduleEndDate 用 >=（非 >）
 *
 * 缓存：WeakMap 以 config 对象引用为 key。store 的 structural sharing 保证
 * config 未改则引用不变 → 缓存命中；config 改则新引用 → 重算。
 * 这替代 v1 的 _scheduleCache + invalidateScheduleCache，无需手动失效。
 */

import { Config, Period } from '@/core/types';

const MAX_DAYS = 365;

export function calculateActualSchedules(config: Config): Period[] {
  if (!config.scheduleStartDate) return [];

  let recurrenceValue: number[] = [1];
  try {
    const parsed = JSON.parse(config.recurrenceValue || '[1]');
    if (Array.isArray(parsed)) recurrenceValue = parsed;
  } catch {
    recurrenceValue = [1];
  }

  const startTime = config.startTime || '10:00';
  const durationSeconds = parseInt(config.duration, 10) || 86400;
  const durationHours = durationSeconds / 3600;

  const scheduleStart = new Date(config.scheduleStartDate);
  const scheduleEndDate = config.scheduleEndDate
    ? new Date(config.scheduleEndDate)
    : null;

  const result: Period[] = [];
  for (let day = 1; day <= MAX_DAYS; day++) {
    const index = (day - 1) % recurrenceValue.length;
    if (recurrenceValue[index] !== 1) continue;

    const currentDate = new Date(scheduleStart);
    currentDate.setDate(currentDate.getDate() + (day - 1));

    // 结束日期当天不生成新期（v1 边界：>= 而非 >）
    if (scheduleEndDate && currentDate >= scheduleEndDate) break;

    const parts = startTime.split(':').map(Number);
    const openTime = new Date(currentDate);
    openTime.setHours(parts[0] ?? 0, parts[1] ?? 0, 0, 0);
    const closeTime = new Date(openTime.getTime() + durationSeconds * 1000);

    result.push({
      period: result.length + 1,
      openTime: openTime.getTime(),
      closeTime: closeTime.getTime(),
      durationHours,
    });
  }
  return result;
}

// --- 缓存层（依赖 store structural sharing） ---------------------------------

const cache = new WeakMap<Config, Period[]>();

export function getSchedules(config: Config): Period[] {
  const hit = cache.get(config);
  if (hit) return hit;
  const result = calculateActualSchedules(config);
  cache.set(config, result);
  return result;
}
