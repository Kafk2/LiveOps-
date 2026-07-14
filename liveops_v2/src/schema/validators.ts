/**
 * schema/validators.ts — 三层校验 + normalizer 框架
 *
 * 破 critical 17：承重语义在注册表无家可归（跨字段/跨配置校验、字段联动）。
 * 分三层：
 *   1. FieldType.validate(value) —— 单字段（在 field-types 内）
 *   2. ConfigValidator(config, ctx) —— 跨字段（注册到本模块），如 duration ≤ 周期
 *   3. DatasetValidator(configs, settings) —— 跨配置/跨表，如互斥组重叠、dependency∈settings
 *
 * 另设 Normalizer：自动改值 + 提示（非阻断），如 enforceMondayStartDate。
 * 区分 normalizer（改值）vs validator（报错不改值），覆盖度审计 critical 26。
 *
 * 内置规则（duration≤周期、互斥重叠、周一校正）在阶段 3 注册；阶段 1 提供框架。
 */

import { Config, Settings, ValidationError, ValidationResult } from '@/core/types';
import { FieldDef } from '@/schema/field-types/registry';

export interface ConfigValidatorContext {
  fieldDefs: FieldDef[];
}

export type ConfigValidator = (
  config: Config,
  ctx: ConfigValidatorContext,
) => ValidationError[];

export type DatasetValidator = (
  configs: Config[],
  settings: Settings,
) => ValidationError[];

export interface Normalizer {
  key: string;
  normalize(config: Config): { config: Config; message?: string };
}

const configValidators: ConfigValidator[] = [];
const datasetValidators: DatasetValidator[] = [];
const normalizers: Normalizer[] = [];

export function registerConfigValidator(v: ConfigValidator): void {
  configValidators.push(v);
}

export function registerDatasetValidator(v: DatasetValidator): void {
  datasetValidators.push(v);
}

export function registerNormalizer(n: Normalizer): void {
  normalizers.push(n);
}

export function runConfigValidators(
  config: Config,
  fieldDefs: FieldDef[],
): ValidationResult {
  const ctx: ConfigValidatorContext = { fieldDefs };
  const errors: ValidationError[] = [];
  for (const v of configValidators) {
    errors.push(...v(config, ctx));
  }
  return { valid: !errors.some((e) => e.severity === 'error'), errors };
}

export function runDatasetValidators(
  configs: Config[],
  settings: Settings,
): ValidationResult {
  const errors: ValidationError[] = [];
  for (const v of datasetValidators) {
    errors.push(...v(configs, settings));
  }
  return { valid: !errors.some((e) => e.severity === 'error'), errors };
}

/** 运行所有 normalizer，叠加改值，收集提示信息 */
export function runNormalizers(config: Config): { config: Config; messages: string[] } {
  let result = config;
  const messages: string[] = [];
  for (const n of normalizers) {
    const { config: next, message } = n.normalize(result);
    result = next;
    if (message) messages.push(message);
  }
  return { config: result, messages };
}
