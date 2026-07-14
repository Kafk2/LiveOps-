/**
 * core/types.ts — 全局共享类型
 *
 * 设计原则：
 * 1. Config 字段保持 string 与 v1 CSV 互通（脏 JSON 原样透传，见 plan 数据模型修订）
 * 2. AppState 用 normalized by-id state（configs: Record<id,Config> + ids 保序），
 *    配合 structural sharing 让选择器 memo 在 2000 配置规模下有效
 * 3. activityType/activityName/activityDescription 不在 Config 里，靠 activityMeta join
 */

// ============================================================================
// Config —— 一条活动配置（对应 CSV 一行 13 列）
// ============================================================================

/**
 * 活动配置。所有字段保持 string 以与 v1 CSV 透传互通。
 * enabled 严格判定：'1' 启用，其他停用（修复 v1 双标准 bug）。
 */
export interface Config {
  id: string; // Date.now().toString()，跨表关联键，不可改 UUID
  activityKey: string;
  enabled: string; // '1' | '0'（CSV 互通）
  scheduleStartDate: string; // YYYY-MM-DD | ''（空=无开始）
  scheduleEndDate: string; // YYYY-MM-DD | ''（空=无限循环）
  startTime: string; // HH:mm
  duration: string; // 秒数字符串（如 '604800'）
  recurrenceValue: string; // JSON array string '[1,0,...]'
  skin: string; // JSON string，脏 JSON 原样透传
  segments: string; // JSON string
  params: string; // JSON string，脏 JSON 原样透传（csv 层 string identity）
  dependency: string; // 派生字段，从 settings.dependencies 反查填充
  mutex: string; // 派生字段，从 settings.mutexGroups 反查填充
  /** 未知列原值透传：CSV 有但 csv-schema 未定义的列，round-trip 不丢失 */
  unknownCells?: Record<string, string>;
}

/** CSV 列顺序（v1 互通，13 列） */
export const CONFIG_CSV_COLUMNS = [
  'id',
  'activityKey',
  'enabled',
  'scheduleStartDate',
  'scheduleEndDate',
  'startTime',
  'duration',
  'recurrenceValue',
  'skin',
  'segments',
  'params',
  'dependency',
  'mutex',
] as const;

export type ConfigFieldKey = (typeof CONFIG_CSV_COLUMNS)[number];

/** 严格判定启用（修复 v1 enabled 双标准 bug：内部统一 string '1'/'0'） */
export function isEnabled(c: Config): boolean {
  return c.enabled === '1';
}

// ============================================================================
// Settings —— settings.json 完整结构（承接 v1 9 类状态 + paramsSchemas 新增）
// ============================================================================

export interface ActivityMeta {
  activityKey: string;
  activityName: string;
  activityType: string;
  activityDescription: string;
}

export interface Dependency {
  parent: string;
  child: string;
}

export interface MutexGroup {
  id: string; // 'group' + Date.now()
  name: string;
  activities: string[];
}

export interface MergeGroup {
  id: string; // 'mg_' + Date.now()
  name: string;
  color: string;
  configIds: string[];
  collapsed: boolean;
}

export interface HeatmapRule {
  min: number;
  color: string;
  label: string;
}

/** UI 设置：全部寄居在 settings.json，随 GitHub 同步（部分本地覆盖，见 plan） */
export interface UISettings {
  configOrder: Record<string, string[]>; // activityType → configId[]
  activityTypeOrder: string[];
  typeGroupCollapsed: Record<string, boolean>;
  mergeGroups: MergeGroup[];
  heatmapRules: HeatmapRule[];
  barColors: Record<string, string>; // configId → color
}

/** params schema 定义：per-type 默认 + per-key 覆盖 */
export interface ParamsFieldDef {
  key: string;
  fieldType: string; // 字段类型 key（注册表内）
  label?: string;
  required?: boolean;
  default?: unknown;
  help?: string;
  /** 嵌套支持：fieldType 为 'group' 时使用 */
  children?: ParamsFieldDef[];
  /** 标记废弃（隐藏但保留序列化） */
  deprecated?: boolean;
}

export interface ParamsSchemaRoot {
  /** activityType → 默认 params 字段定义 */
  byType: Record<string, ParamsFieldDef[]>;
  /** activityKey → 完整覆盖（若有，替代所属 type 默认；无则用 type 默认） */
  overrides: Record<string, ParamsFieldDef[]>;
  version: number; // schema 版本号，用于数据迁移
}

export interface Settings {
  activityMeta: ActivityMeta[];
  dependencies: Dependency[];
  mutexGroups: MutexGroup[];
  uiSettings: UISettings;
  paramsSchemas: ParamsSchemaRoot; // v2 新增
}

// ============================================================================
// AppState —— normalized by-id state
// ============================================================================

export type TabKey = 'config' | 'dependency' | 'mutex' | 'timeline' | 'compare' | 'schema' | 'version';

export interface UIState {
  activeTab: TabKey;
  selectedConfigId: string | null;
  listSearch: string;
  listSort: 'duration' | 'name' | 'date' | 'custom';
  /** 时间轴 UI 临时态（仅本地，不同步） */
  timeline: TimelineUIState;
}

export interface TimelineUIState {
  sliderPos: number; // 0..1 缩放位置
  scrollLeft: number;
  showStopped: boolean;
  rowHeight: number;
}

/** 编辑器草稿：未应用的字段覆盖（已知列字符串），用于时间轴未保存预览（虚线/半透明） */
export interface EditorState {
  draft: Partial<Record<string, string>> | null;
}

export interface AppState {
  configs: Record<string, Config>;
  configIds: string[]; // 保序
  settings: Settings;
  ui: UIState;
  editor: EditorState;
}

// ============================================================================
// Action / Dispatch / Meta
// ============================================================================

export type ActionType =
  // config 增删改（这些是 history commit 点）
  | 'CONFIG_SAVE'
  | 'CONFIG_DELETE'
  | 'CONFIG_COPY'
  | 'CONFIGS_REPLACE' // 批量导入 / GitHub pull（skipHistory）
  // 草稿编辑：不写 committed configs，只更新 editor.draft（不入栈）
  | 'DRAFT_EDIT'
  | 'DRAFT_RESET'
  | 'DRAFT_COMMIT' // 草稿→committed（内部转 CONFIG_SAVE，commit 点）
  // settings（dependency/mutex/uiSettings 编辑）
  | 'SETTINGS_PATCH'
  | 'SETTINGS_REPLACE' // GitHub pull（skipHistory）
  // params schema 编辑（独立 history 栈）
  | 'SCHEMA_PATCH'
  // ui 临时态（不入栈）
  | 'UI_PATCH'
  // history 回放（内部）
  | 'HISTORY_RESTORE';

export interface ActionMeta {
  /** 跳过 history 入栈（GitHub sync / 初始化 / 批量导入 / 字段编辑） */
  skipHistory?: boolean;
  /** history 作用域：config 编辑 vs schema 编辑（独立栈） */
  historyScope?: 'config' | 'schema';
}

export interface Action<T = unknown> {
  type: ActionType;
  payload?: T;
  meta?: ActionMeta;
}

// ============================================================================
// Schedule —— calculateActualSchedules 输出（循环展开后的具体期次）
// ============================================================================

export interface Period {
  period: number; // 第几期
  openTime: number; // ms timestamp
  closeTime: number; // ms timestamp
  durationHours: number;
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  field: string;
  message: string;
  /** severity: error 阻断保存，warning 仅提示 */
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ============================================================================
// Store 订阅
// ============================================================================

export type Selector<T> = (state: AppState) => T;
export type Listener<T> = (value: T, prev: AppState, next: AppState) => void;
