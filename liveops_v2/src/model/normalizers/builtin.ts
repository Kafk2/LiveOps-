/**
 * model/normalizers/builtin.ts — 内置 normalizer（自动改值 + 提示，非阻断）
 *
 * 与 validator 的区别：normalizer 改值，validator 只报错。
 * 接入点：保存配置前 runNormalizers(next) → 得到校正后的 config + 提示信息。
 *
 * enforceMondayStartDate：
 *   v1 行为保真（index.html enforceMondayStartDate）—— 每周/双周循环的循环起点
 *   必须是周一，否则自动校正到最近的周一（周日 -6，其他 1-dow）。
 *   仅 weekly/biweekly 模式触发；single/interval/custom 不动。
 */

import type { Config } from '@/core/types';
import type { Normalizer } from '@/schema/validators';
import { registerNormalizer } from '@/schema/validators';
import { parseRecurrenceValue } from '@/model/recurrence/builtin';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** v1 周一校正：返回校正后的 YYYY-MM-DD；已是周一或非 weekly/biweekly 时返回 null */
export function adjustToMonday(dateStr: string, recurrenceMode: string): string | null {
  if (recurrenceMode !== 'weekly' && recurrenceMode !== 'biweekly') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const y = parseInt(m[1]!, 10);
  const mo = parseInt(m[2]!, 10);
  const d = parseInt(m[3]!, 10);
  // 本地时区构造（与 v1 一致：new Date(y, mo-1, d)），只关心日期不看时区
  const dt = new Date(y, mo - 1, d);
  const dow = dt.getDay(); // 0=周日 .. 6=周六
  if (dow === 1) return null; // 已是周一
  const diff = dow === 0 ? -6 : 1 - dow; // 周日 → 上周一(-6)；周二..六 → 当周一(1-dow)
  dt.setDate(dt.getDate() + diff);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export const enforceMondayStartDate: Normalizer = {
  key: 'enforceMondayStartDate',
  normalize(config: Config): { config: Config; message?: string } {
    const mode = parseRecurrenceValue(config.recurrenceValue);
    const start = config.scheduleStartDate;
    if (!start) return { config };
    const adjusted = adjustToMonday(start, mode);
    if (!adjusted) return { config };
    return {
      config: { ...config, scheduleStartDate: adjusted },
      message: `每周/双周循环要求开始日期为周一，已自动调整为 ${adjusted}`,
    };
  },
};

/** 注册全部内置 normalizer（main.ts 启动时调用一次） */
export function registerBuiltinNormalizers(): void {
  registerNormalizer(enforceMondayStartDate);
}
