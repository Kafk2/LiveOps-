/**
 * model/params.ts — params 变体解析/序列化（纯函数，无 DOM）
 *
 * params 存储为字符串，可能含多个 JSON 对象变体（一个活动在多种配置间循环复用）：
 *   单：{"pass":"Pass202606"}
 *   多：{"pass":"Pass202606"},{"pass":"Pass202607"}   （逗号裸拼接，无外层 []）
 *
 * CSV 层是 json identity 字节级透传（csv-schema/field-types），本模块仅服务 UI 层的解析/重建。
 * 容错：脏片段忽略，不抛错；兼容旧单对象与带外层 [...] 的数组写法。
 */

/** 变体 = 一个 JSON 对象（activityKey 对应 params schema 的一组值） */
export type ParamVariant = Record<string, unknown>;

/**
 * 按顶层大括号切片：扫描 {...} 深度，顶层闭合即切出一个对象字符串。
 * - 字符串内的括号不计（处理值含 { } " 的极端情况，转义 \" 正确处理）
 * - 顶层外的字符（[ ] , 空白 换行）忽略 → 天然兼容外层 [...] 与裸拼接
 */
export function splitTopLevelObjects(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(raw.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

/** 解析 params 字符串为变体数组。空/非法 → []；每个片段 try JSON.parse 失败忽略，非对象跳过。 */
export function parseParamsVariants(raw: string): ParamVariant[] {
  if (!raw || !raw.trim()) return [];
  const out: ParamVariant[] = [];
  for (const part of splitTopLevelObjects(raw)) {
    try {
      const v = JSON.parse(part);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out.push(v as ParamVariant);
      }
    } catch {
      // 非法片段忽略
    }
  }
  return out;
}

/** 序列化变体数组为 params 字符串：空 → ''；否则各对象 JSON.stringify 后逗号裸拼接（无外层 []）。 */
export function serializeParamsVariants(variants: ParamVariant[]): string {
  if (!variants || variants.length === 0) return '';
  return variants.map((v) => JSON.stringify(v)).join(',');
}
