/**
 * model/cycle.ts — 循环次数 ↔ 结束日期 转换 + duration 工具（自 v1 index.html 移植）
 *
 * v1 语义保真（critical）：
 * - endDateToCycleCount：endDate 反推循环次数，`cur >= end` 用 >=（结束当天那期不计入）
 * - cycleCountToEndDateString：循环次数 → endDate，**+1 天 trick**（让 calculateActualSchedules
 *   的 `currentDate >= scheduleEndDate` 在最后一期之后才 break，保证 round-trip 不丢期）
 * - parseDuration/mergeDuration：秒 ↔ 天/时/分（向下取整，UI 不展示秒）
 *
 * 这两个转换是"双向不可逆"配对：endDate 比真正最后期开始日期多 1 天。
 * 上限 3650 天（与 v1 一致，长周期容错；calculateActualSchedules 渲染上限 365 天）。
 */

const SECS_PER_DAY = 86400;
const SECS_PER_HOUR = 3600;
const SECS_PER_MINUTE = 60;
const MAX_CYCLE_DAYS = 3650;

/** 秒 → {天,时,分}（向下取整） */
export function parseDuration(seconds: number): { days: number; hours: number; minutes: number } {
  let rest = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const days = Math.floor(rest / SECS_PER_DAY);
  rest %= SECS_PER_DAY;
  const hours = Math.floor(rest / SECS_PER_HOUR);
  rest %= SECS_PER_HOUR;
  const minutes = Math.floor(rest / SECS_PER_MINUTE);
  return { days, hours, minutes };
}

/** 天/时/分 → 秒（负数/NaN 当 0） */
export function mergeDuration(days: number, hours: number, minutes: number): number {
  const d = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
  const h = Number.isFinite(hours) && hours > 0 ? Math.floor(hours) : 0;
  const m = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
  return d * SECS_PER_DAY + h * SECS_PER_HOUR + m * SECS_PER_MINUTE;
}

function parseRecurrenceArray(recurrenceValue: string): number[] {
  try {
    const parsed = JSON.parse(recurrenceValue || '[1]');
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as number[];
  } catch {
    // 回退 [1]
  }
  return [1];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * scheduleEndDate → 循环次数（UI 显示用）。
 * 结束当天那期不计入（cur >= end 即 break）。空 endDate/startDate 返回 ''。
 */
export function endDateToCycleCount(
  startDateStr: string,
  endDateStr: string,
  recurrenceValue: string,
): string {
  if (!endDateStr || !startDateStr) return '';
  const rv = parseRecurrenceArray(recurrenceValue);
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
  let count = 0;
  for (let d = 1; d <= MAX_CYCLE_DAYS; d++) {
    const idx = (d - 1) % rv.length;
    if (rv[idx] === 1) {
      const cur = new Date(start);
      cur.setDate(cur.getDate() + (d - 1));
      if (cur >= end) break;
      count++;
    }
  }
  return count > 0 ? String(count) : '';
}

/**
 * 循环次数 → scheduleEndDate（存储字段）。
 * endDate = 最后期开始日期 + 1 天（+1 天 trick，见文件头注释）。
 */
export function cycleCountToEndDateString(
  startDateStr: string,
  cycleCountStr: string,
  recurrenceValue: string,
): string {
  const count = parseInt(cycleCountStr, 10);
  if (!count || count < 1 || !startDateStr) return '';
  const rv = parseRecurrenceArray(recurrenceValue);
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return '';
  let lastCycleDate: Date | null = null;
  let found = 0;
  for (let d = 1; d <= MAX_CYCLE_DAYS && found < count; d++) {
    const idx = (d - 1) % rv.length;
    if (rv[idx] === 1) {
      found++;
      if (found === count) {
        lastCycleDate = new Date(start);
        lastCycleDate.setDate(lastCycleDate.getDate() + (d - 1));
      }
    }
  }
  if (!lastCycleDate) return '';
  lastCycleDate.setDate(lastCycleDate.getDate() + 1); // +1 天 trick
  return toDateString(lastCycleDate);
}

/**
 * duration 是否超过循环周期长度（每期持续时间 ≤ 一个周期）。
 * maxSeconds = rv.length × 86400。
 */
export function validateDurationAgainstPeriod(
  durationSeconds: number,
  recurrenceValue: string,
): { ok: boolean; maxSeconds: number } {
  const rv = parseRecurrenceArray(recurrenceValue);
  const maxSeconds = rv.length * SECS_PER_DAY;
  const dur = Number.isFinite(durationSeconds) ? durationSeconds : 0;
  return { ok: dur <= maxSeconds, maxSeconds };
}
