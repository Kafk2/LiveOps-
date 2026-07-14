/**
 * schema/params-schema.ts — params schema resolve + 自校验
 *
 * per-type 默认 + per-key 覆盖（add/remove/replace）+ 嵌套预留。
 * resolve(activityKey, activityType) 返回最终字段定义数组，form-renderer 据此渲染 params 区。
 *
 * migrate（schema 变更后对存量数据迁移）留阶段 3，随 schema-tab 编辑器一起落地。
 */

import {
  ParamsSchemaRoot,
  ParamsFieldDef,
  ValidationResult,
  ValidationError,
} from '@/core/types';

/** 解析某 activityKey 的最终 params schema：per-key 覆盖优先，否则用所属 type 默认 */
export function resolveParamsSchema(
  root: ParamsSchemaRoot,
  activityKey: string,
  activityType: string,
): ParamsFieldDef[] {
  return root.overrides[activityKey] ?? root.byType[activityType] ?? [];
}

/** schema-schema 自校验：字段 key 唯一性（byType 与 overrides 均检查） */
export function validateParamsSchema(root: ParamsSchemaRoot): ValidationResult {
  const errors: ValidationError[] = [];
  for (const [type, fields] of Object.entries(root.byType)) {
    const seen = new Set<string>();
    for (const f of fields) {
      if (seen.has(f.key)) {
        errors.push({
          field: f.key,
          message: `类型「${type}」默认 schema 内字段 key 重复：${f.key}`,
          severity: 'error',
        });
      }
      seen.add(f.key);
    }
  }
  for (const [key, fields] of Object.entries(root.overrides)) {
    const seen = new Set<string>();
    for (const f of fields) {
      if (seen.has(f.key)) {
        errors.push({
          field: f.key,
          message: `activityKey「${key}」覆盖 schema 内字段 key 重复：${f.key}`,
          severity: 'error',
        });
      }
      seen.add(f.key);
    }
  }
  return { valid: !errors.some((e) => e.severity === 'error'), errors };
}
