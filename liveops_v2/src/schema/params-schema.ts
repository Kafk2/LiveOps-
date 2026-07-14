/**
 * schema/params-schema.ts — params schema resolve + 自校验
 *
 * 仅按 activityKey 绑定（无类型默认）：每个 activityKey 独立配置其 params 字段结构。
 * resolve(activityKey) 返回该 key 的字段定义数组，form-renderer 据此渲染 params 区。
 */

import { ParamsSchemas, ParamsFieldDef, ValidationResult, ValidationError } from '@/core/types';

/** 解析某 activityKey 的 params schema（仅按 key，无 type 默认回退） */
export function resolveParamsSchema(
  schemas: ParamsSchemas,
  activityKey: string,
): ParamsFieldDef[] {
  return schemas[activityKey] ?? [];
}

/** schema 自校验：每个 activityKey 内字段 key 唯一 */
export function validateParamsSchema(schemas: ParamsSchemas): ValidationResult {
  const errors: ValidationError[] = [];
  for (const [key, fields] of Object.entries(schemas)) {
    const seen = new Set<string>();
    for (const f of fields) {
      if (seen.has(f.key)) {
        errors.push({
          field: f.key,
          message: `activityKey「${key}」schema 内字段 key 重复：${f.key}`,
          severity: 'error',
        });
      }
      seen.add(f.key);
    }
  }
  return { valid: !errors.some((e) => e.severity === 'error'), errors };
}
