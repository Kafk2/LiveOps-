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
  ParamsOverride,
  ValidationResult,
  ValidationError,
} from '@/core/types';

/** 应用 override 到 base（remove → replace → add 顺序） */
function applyOverride(base: ParamsFieldDef[], override: ParamsOverride): ParamsFieldDef[] {
  let result = base.filter((f) => !(override.remove ?? []).includes(f.key));
  if (override.replace) {
    result = result.map((f) => {
      const rep = override.replace![f.key];
      return rep ? { ...f, ...rep } : f;
    });
  }
  if (override.add) result = [...result, ...override.add];
  return result;
}

/** 解析某 activityKey 的最终 params schema = 所属 type 默认 + 个体覆盖 */
export function resolveParamsSchema(
  root: ParamsSchemaRoot,
  activityKey: string,
  activityType: string,
): ParamsFieldDef[] {
  const base = root.byType[activityType] ?? [];
  const override = root.overrides[activityKey];
  if (!override) return [...base];
  return applyOverride(base, override);
}

/** schema-schema 自校验：字段 key 唯一性（策划编辑器用，critical 25 防护） */
export function validateParamsSchema(root: ParamsSchemaRoot): ValidationResult {
  const errors: ValidationError[] = [];
  for (const [type, fields] of Object.entries(root.byType)) {
    const seen = new Set<string>();
    for (const f of fields) {
      if (seen.has(f.key)) {
        errors.push({
          field: f.key,
          message: `类型「${type}」内字段 key 重复：${f.key}`,
          severity: 'error',
        });
      }
      seen.add(f.key);
    }
  }
  return { valid: !errors.some((e) => e.severity === 'error'), errors };
}
