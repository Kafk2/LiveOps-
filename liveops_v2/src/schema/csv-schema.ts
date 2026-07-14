/**
 * schema/csv-schema.ts — 全局 CSV 字段定义（13 列 + derived）
 *
 * 驱动 csv-codec 的编解码 + 配置表单渲染。新增 CSV 字段 = 在此数组加一项
 * （如 reissuePopKeepTime），表单/校验/导入导出全自动适配——这是"可拓展"的核心落地。
 *
 * 字段类型映射（见 field-types/registry + primitives/advanced）：
 * - text/date/time/duration/recurrence/json/derived 大多 CSV 层 string 透传（v1 互通）
 * - json/derived/duration/recurrence 的 parse/serialize 是 string identity（脏 JSON 原样透传）
 * - dependency/mutex 是 derived 字段（值从 settings 反查，critical 17）
 */

import { FieldDef } from '@/schema/field-types/registry';

export interface CsvFieldDef extends FieldDef {
  csvColumn: number; // CSV 列顺序（v1 互通）
}

export const CSV_SCHEMA: CsvFieldDef[] = [
  { key: 'id', fieldType: 'text', csvColumn: 0, required: true },
  { key: 'activityKey', fieldType: 'text', csvColumn: 1, required: true },
  { key: 'enabled', fieldType: 'text', csvColumn: 2, default: '1' },
  { key: 'scheduleStartDate', fieldType: 'date', csvColumn: 3 },
  { key: 'scheduleEndDate', fieldType: 'date', csvColumn: 4 },
  { key: 'startTime', fieldType: 'time', csvColumn: 5, default: '10:00' },
  { key: 'duration', fieldType: 'duration', csvColumn: 6, default: '86400' },
  { key: 'recurrenceValue', fieldType: 'recurrence', csvColumn: 7, default: '[1]' },
  { key: 'skin', fieldType: 'json', csvColumn: 8 },
  { key: 'segments', fieldType: 'json', csvColumn: 9 },
  { key: 'params', fieldType: 'json', csvColumn: 10, default: '{}' },
  { key: 'dependency', fieldType: 'derived', csvColumn: 11, derived: true, default: '' },
  { key: 'mutex', fieldType: 'derived', csvColumn: 12, derived: true, default: '[]' },
];

/** 按 csvColumn 升序返回（csv-codec 编解码用） */
export function getCsvFieldsOrdered(): CsvFieldDef[] {
  return [...CSV_SCHEMA].sort((a, b) => a.csvColumn - b.csvColumn);
}

export function getCsvFieldByKey(key: string): CsvFieldDef | undefined {
  return CSV_SCHEMA.find((f) => f.key === key);
}
