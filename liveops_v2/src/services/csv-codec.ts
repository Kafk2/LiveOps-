/**
 * services/csv-codec.ts —— CSV 编解码（schedule.csv 与 Config[] 互转）
 *
 * 职责：
 * 1. parseCSV / serializeCSV：纯文本 CSV 与 string[][] 互转（RFC 4180 引号转义）。
 * 2. decodeConfigs / encodeConfigs：string[][] 与 Config[] 互转，字段映射交给
 *    schema/csv-schema（getCsvFieldsOrdered），值解析/序列化交给 field-types 注册表
 *    （getFieldType().parse/serialize）。本文件不硬编码列名/列序，schema 变更无需改这里。
 *
 * 关键设计 / 相对 v1 的修复：
 * - BOM：parseCSV 剥除行首 U+FEFF（v1 不剥除，导致表头首列名多一个不可见字符，
 *   列名匹配失败）；serializeCSV 不加 BOM，与 parseCSV 剥 BOM 配对。
 * - 引号：实现状态机 parseCSVLine，正确处理引号内的逗号与换行（RFC 4180 双引号转义）。
 *   v1 的 parseCSVLine 按物理行 split 后无法处理引号内换行；v2 改为按物理行喂入状态机，
 *   引号未闭合时跨行累积并在行间补 \n 还原引号内换行。
 * - 字段空格：parseCSV 不再 trim 字段（v1 trim 会丢首尾空格），与 serializeCSV
 *   “含首尾空格即加引号”规则配对，保证 round-trip。
 * - 行匹配：decodeConfigs 对“字段数与表头不匹配”的行静默跳过（保留 v1 语义）。
 * - id 必填：缺失 id 的行跳过。
 */

import { Config } from '@/core/types';
import { getFieldType } from '@/schema/field-types/registry';
import { CsvFieldDef, getCsvFieldsOrdered } from '@/schema/csv-schema';

// ----------------------------------------------------------------------------
// 解析状态机
// ----------------------------------------------------------------------------

/**
 * CSV 单记录解析状态机。parseCSV 按物理行逐行喂入；当引号未闭合时跨行累积，
 * 行间由调用方补一个 \n（还原引号内的换行）。
 */
interface CsvParseState {
  fields: string[]; // 已完成的字段
  field: string; // 当前正在累积的字段
  inQuotes: boolean; // 是否处于引号内
}

/**
 * 把一个物理行的字符喂入状态机。
 * 引号内：逗号与换行（已由调用方在行间补 \n）作为普通字符累积进 field；
 * 引号外：逗号分隔字段，双引号开启引号段。双引号转义为 ""（RFC 4180）。
 */
function parseCSVLine(line: string, state: CsvParseState): void {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (state.inQuotes) {
      if (ch === '"') {
        // 引号内遇到双引号：若下一字符也是双引号 → 转义为一个字面双引号；否则闭合引号
        if (line[i + 1] === '"') {
          state.field += '"';
          i++;
        } else {
          state.inQuotes = false;
        }
      } else {
        state.field += ch;
      }
    } else {
      if (ch === '"') {
        state.inQuotes = true;
      } else if (ch === ',') {
        state.fields.push(state.field);
        state.field = '';
      } else {
        state.field += ch;
      }
    }
  }
}

// ----------------------------------------------------------------------------
// parseCSV
// ----------------------------------------------------------------------------

/**
 * 解析 CSV 文本为 string[][]。
 *
 * 步骤：
 * 1. 剥除行首 BOM（U+FEFF）—— 修复 v1 不剥除 bug。
 * 2. 按换行 split 物理行（兼容 \r\n / \r / \n）；空行跳过。
 * 3. 用状态机 parseCSVLine 处理每行；引号未闭合时跨行累积（行间补 \n）。
 * 4. 返回 string[][]（每行字段数组）。
 *
 * 不 trim 字段，以与 serializeCSV 的首尾空格加引号规则 round-trip。
 */
export function parseCSV(text: string): string[][] {
  // 1. 剥除行首 BOM
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows: string[][] = [];
  let state: CsvParseState | null = null; // 非空 = 正在跨行累积一条记录
  const physicalLines = text.split(/\r\n|\r|\n/);

  for (const line of physicalLines) {
    if (state === null) {
      // 不在引号累积中：空行跳过
      if (line === '') continue;
      state = { fields: [], field: '', inQuotes: false };
      parseCSVLine(line, state);
      if (!state.inQuotes) {
        // 记录在本物理行内闭合
        state.fields.push(state.field);
        rows.push(state.fields);
        state = null;
      }
      // else: 引号未闭合，保留 state 继续累积下一物理行
    } else {
      // 累积中：行间补一个 \n（还原引号内的换行）
      state.field += '\n';
      parseCSVLine(line, state);
      if (!state.inQuotes) {
        state.fields.push(state.field);
        rows.push(state.fields);
        state = null;
      }
    }
  }

  // 文件末尾仍有未闭合引号（畸形输入）：宽容收尾，按闭合处理
  if (state !== null) {
    state.fields.push(state.field);
    rows.push(state.fields);
  }

  return rows;
}

// ----------------------------------------------------------------------------
// serializeCSV
// ----------------------------------------------------------------------------

/**
 * 单字段 CSV 转义：含逗号 / 双引号 / 换行(\n \r) / 首尾空格 → 用双引号包裹，
 * 内部双引号重复为 ""（RFC 4180）。否则原样输出。
 */
function csvCell(val: unknown): string {
  const s = val == null ? '' : String(val);
  const needsQuote =
    s.indexOf(',') >= 0 ||
    s.indexOf('"') >= 0 ||
    s.indexOf('\n') >= 0 ||
    s.indexOf('\r') >= 0 ||
    s !== s.trim(); // 首尾有空格
  if (!needsQuote) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/**
 * 序列化 string[][] 为 CSV 文本。
 * 字段用 csvCell 转义，行内用逗号连接，行间用 \n 连接。
 * 导出整串不加 BOM（与 parseCSV 剥 BOM 配对）。
 */
export function serializeCSV(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

// ----------------------------------------------------------------------------
// decodeConfigs
// ----------------------------------------------------------------------------

/** 未知值 → string（null/undefined → ''），用于把 FieldType.parse 的 unknown 结果收敛为 Config 的 string 字段。 */
function toStr(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * 把 CSV 行数组解码为 Config[]。
 *
 * 步骤：
 * 1. 第 0 行为表头，建立 列名 → 列索引 映射。
 * 2. 其余每行：字段数与表头不匹配 → 静默跳过（v1 语义）。
 * 3. 按 getCsvFieldsOrdered() 映射：每个 field 用 getFieldType(fieldType).parse(raw ?? '') 得值；
 *    缺失列用 fieldType.defaultValue() 填充。
 * 4. id 列必填，缺失则跳过该行。
 * 5. 返回 Config[]。
 */
export function decodeConfigs(rows: string[][]): Config[] {
  if (rows.length === 0) return [];

  const header = rows[0] ?? [];
  const colIndex: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) {
    const name = header[i] ?? '';
    colIndex[name] = i;
  }

  const fieldDefs: CsvFieldDef[] = getCsvFieldsOrdered();
  const configs: Config[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    // 字段数与表头不匹配，静默跳过（v1 语义）
    if (row.length !== header.length) continue;

    const values: Record<string, string> = {};
    for (const fd of fieldDefs) {
      const ft = getFieldType(fd.fieldType);
      if (!ft) {
        // 未注册类型：回退到 schema default 或空串
        values[fd.key] = fd.default != null ? String(fd.default) : '';
        continue;
      }
      const idx = colIndex[fd.key];
      if (idx === undefined) {
        // 缺失列：用 fieldType.defaultValue() 填充
        values[fd.key] = toStr(ft.defaultValue());
      } else {
        const raw = row[idx] ?? '';
        values[fd.key] = toStr(ft.parse(raw));
      }
    }

    // id 必填，缺失则跳过该行
    if (!values['id']) continue;

    const config: Config = {
      id: values['id'] ?? '',
      activityKey: values['activityKey'] ?? '',
      enabled: values['enabled'] ?? '',
      scheduleStartDate: values['scheduleStartDate'] ?? '',
      scheduleEndDate: values['scheduleEndDate'] ?? '',
      startTime: values['startTime'] ?? '',
      duration: values['duration'] ?? '',
      recurrenceValue: values['recurrenceValue'] ?? '',
      skin: values['skin'] ?? '',
      segments: values['segments'] ?? '',
      params: values['params'] ?? '',
      dependency: values['dependency'] ?? '',
      mutex: values['mutex'] ?? '',
    };
    configs.push(config);
  }

  return configs;
}

// ----------------------------------------------------------------------------
// encodeConfigs
// ----------------------------------------------------------------------------

/**
 * 把 Config[] 编码为 CSV 文本。
 *
 * 按 getCsvFieldsOrdered() 的 csvColumn 顺序输出：
 * - 表头行用 field.key；
 * - 每个数据单元格用 getFieldType(fieldType).serialize(value)（derived 字段也照常 serialize）。
 * 用 serializeCSV 拼装（不加 BOM）。
 */
export function encodeConfigs(configs: Config[]): string {
  const fieldDefs: CsvFieldDef[] = getCsvFieldsOrdered();
  const header: string[] = fieldDefs.map((fd) => fd.key);
  const dataRows: string[][] = configs.map((c) =>
    fieldDefs.map((fd) => {
      const ft = getFieldType(fd.fieldType);
      const key = fd.key as keyof Config;
      const v = c[key];
      return ft ? ft.serialize(v) : toStr(v);
    }),
  );
  return serializeCSV([header, ...dataRows]);
}
