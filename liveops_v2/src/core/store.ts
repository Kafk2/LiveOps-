/**
 * core/store.ts — 状态层 + history 集成
 *
 * 核心设计（针对魔鬼审查 critical 1-6 的修订）：
 *
 * 1. normalized by-id state：configs 用 Record<id,Config> + configIds 保序，
 *    不用数组。这样 updateConfig 只产生新 configs 引用 + 被 patch 的 config 新引用，
 *    其余 config 引用不变 → 选择器 s => s.configs[id] 在别的 config 变更时 memo 命中。
 *
 * 2. history 显式 commit 点：只有 CONFIG_SAVE/DELETE/COPY 入 config 栈，
 *    SCHEMA_PATCH 入 schema 栈（独立栈隔离）。CONFIG_UPDATE_FIELD（oninput 细粒度）、
 *    GitHub sync、批量导入走 meta.skipHistory。杜绝"每次按键全量深拷贝入栈"。
 *
 * 3. barColor 分离管理：v1 把 barColor 混进 config 对象导致"反向映射"副作用，
 *    v2 把 barColor 留在 settings.uiSettings.barColors，通过独立 action 管理，
 *    不入 config history（颜色是 UI 个性化，非数据编辑）。CONFIG_SAVE 不涉及 barColor。
 *
 * 4. 快照仅 configs（不含 settings/ui），与 v1 saveSnapshot 语义一致。
 */

import { AppState, Action, Config, Selector, Listener } from './types';

// ============================================================================
// History 栈
// ============================================================================

const MAX_HISTORY_DEPTH = 20; // v1: _maxUndoDepth = 20

interface HistoryEntry {
  snapshot: unknown; // config scope: {configs, configIds}；schema scope: ParamsSchemaRoot
  label: string; // 操作名（按钮 title）
}

interface HistoryScope {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

// ============================================================================
// Reducer —— 纯函数，手动不可变更新（structural sharing）
// ============================================================================

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'CONFIG_SAVE': {
      const config = action.payload as Config;
      const exists = state.configs[config.id] != null;
      return {
        ...state,
        configs: { ...state.configs, [config.id]: config },
        configIds: exists ? state.configIds : [...state.configIds, config.id],
        editor: { draft: null },
      };
    }
    case 'CONFIG_DELETE': {
      const id = action.payload as string;
      if (state.configs[id] == null) return state;
      const { [id]: _omit, ...rest } = state.configs;
      void _omit;
      return {
        ...state,
        configs: rest,
        configIds: state.configIds.filter((x) => x !== id),
      };
    }
    case 'CONFIG_COPY': {
      const { sourceId, newId, newActivityKey } = action.payload as {
        sourceId: string;
        newId: string;
        newActivityKey?: string;
      };
      const src = state.configs[sourceId];
      if (src == null) return state;
      const copy: Config = {
        ...src,
        id: newId,
        activityKey: newActivityKey ?? src.activityKey,
      };
      return {
        ...state,
        configs: { ...state.configs, [newId]: copy },
        configIds: [...state.configIds, newId],
      };
    }
    case 'CONFIGS_REPLACE': {
      // 批量替换（导入 / GitHub pull），skipHistory
      const configs = action.payload as Config[];
      const nextConfigs: Record<string, Config> = {};
      const nextIds: string[] = [];
      for (const c of configs) {
        nextConfigs[c.id] = c;
        nextIds.push(c.id);
      }
      return { ...state, configs: nextConfigs, configIds: nextIds, editor: { draft: null } };
    }
    case 'DRAFT_EDIT': {
      // 草稿字段编辑：只写 editor.draft，不碰 committed configs，不入栈
      const { field, value } = action.payload as { field: string; value: string };
      const draft = state.editor.draft ? { ...state.editor.draft } : {};
      if (draft[field] === value) return state;
      draft[field] = value;
      return { ...state, editor: { draft } };
    }
    case 'DRAFT_RESET': {
      if (state.editor.draft === null) return state;
      return { ...state, editor: { draft: null } };
    }
    case 'SETTINGS_PATCH': {
      const patch = action.payload as Partial<AppState['settings']>;
      return { ...state, settings: { ...state.settings, ...patch } };
    }
    case 'SETTINGS_REPLACE': {
      const settings = action.payload as AppState['settings'];
      return { ...state, settings };
    }
    case 'SCHEMA_PATCH': {
      const schema = action.payload as AppState['settings']['paramsSchemas'];
      return {
        ...state,
        settings: { ...state.settings, paramsSchemas: schema },
      };
    }
    case 'UI_PATCH': {
      const patch = action.payload as Partial<AppState['ui']>;
      const next: AppState = { ...state, ui: { ...state.ui, ...patch } };
      // 切换选中配置时清空草稿，避免上一个配置的未应用编辑残留
      if (patch.selectedConfigId !== undefined) {
        next.editor = { draft: null };
      }
      return next;
    }
    case 'HISTORY_RESTORE': {
      // history 回放（undo/redo），skipHistory
      const { scope, snapshot } = action.payload as {
        scope: 'config' | 'schema';
        snapshot: unknown;
      };
      if (scope === 'config') {
        const s = snapshot as { configs: Record<string, Config>; configIds: string[] };
        return { ...state, configs: s.configs, configIds: s.configIds, editor: { draft: null } };
      }
      const s = snapshot as AppState['settings']['paramsSchemas'];
      return { ...state, settings: { ...state.settings, paramsSchemas: s } };
    }
    default:
      return state;
  }
}

// ============================================================================
// shallow equal（用于 subscribe 比较 selector 输出）
// ============================================================================

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (
      !Object.is(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    )
      return false;
  }
  return true;
}

// ============================================================================
// Store
// ============================================================================

export type HistoryScopeKey = 'config' | 'schema';

const COMMIT_CONFIG_TYPES = new Set(['CONFIG_SAVE', 'CONFIG_DELETE', 'CONFIG_COPY']);

interface Subscription {
  selector: Selector<unknown>;
  listener: Listener<unknown>;
  lastValue: unknown;
}

export interface Store {
  getState(): AppState;
  dispatch(action: Action): void;
  select<T>(selector: Selector<T>): T;
  subscribe<T>(selector: Selector<T>, listener: Listener<T>): () => void;
  // history
  undo(scope: HistoryScopeKey): void;
  redo(scope: HistoryScopeKey): void;
  canUndo(scope: HistoryScopeKey): boolean;
  canRedo(scope: HistoryScopeKey): boolean;
  getUndoLabel(scope: HistoryScopeKey): string | null;
  getRedoLabel(scope: HistoryScopeKey): string | null;
  subscribeHistory(cb: () => void): () => void;
}

export function createStore(initialState: AppState): Store {
  let state = initialState;

  const configHistory: HistoryScope = { past: [], future: [] };
  const schemaHistory: HistoryScope = { past: [], future: [] };
  const historyListeners = new Set<() => void>();

  const subs = new Set<Subscription>();

  function getState(): AppState {
    return state;
  }

  function notifyHistory(): void {
    for (const cb of historyListeners) cb();
  }

  function snapshotForScope(scope: HistoryScopeKey): unknown {
    if (scope === 'config') {
      return clone({ configs: state.configs, configIds: state.configIds });
    }
    return clone(state.settings.paramsSchemas);
  }

  function pushHistory(scope: HistoryScopeKey, entry: HistoryEntry): void {
    const h = scope === 'config' ? configHistory : schemaHistory;
    h.past.push(entry);
    if (h.past.length > MAX_HISTORY_DEPTH) h.past.shift();
    h.future.length = 0; // 任何新 commit 清空 future（v1 语义）
  }

  function dispatch(action: Action): void {
    const prev = state;
    const next = reducer(prev, action);

    // history commit（显式 commit 点 + 未跳过）
    if (action.meta?.skipHistory !== true) {
      if (COMMIT_CONFIG_TYPES.has(action.type)) {
        const label = commitLabel(action);
        pushHistory('config', { snapshot: snapshotForScope('config'), label });
      } else if (action.type === 'SCHEMA_PATCH') {
        pushHistory('schema', { snapshot: snapshotForScope('schema'), label: '编辑 schema' });
      }
    }

    if (next === prev) return; // reducer 未变更（如 CONFIG_UPDATE_FIELD 同值）
    state = next;

    // 通知订阅者（shallow 比较 selector 输出）
    for (const sub of subs) {
      const value = sub.selector(state);
      if (!shallowEqual(value, sub.lastValue)) {
        sub.lastValue = value;
        sub.listener(value, prev, state);
      }
    }
    notifyHistory();
  }

  function restore(scope: HistoryScopeKey, entry: HistoryEntry | undefined): void {
    if (!entry) return;
    dispatch({
      type: 'HISTORY_RESTORE',
      payload: { scope, snapshot: entry.snapshot },
      meta: { skipHistory: true },
    });
  }

  function undo(scope: HistoryScopeKey): void {
    const h = scope === 'config' ? configHistory : schemaHistory;
    const entry = h.past.pop();
    if (!entry) return;
    // 当前状态推入 future（互推语义，v1: undo 前把当前推 redo 栈）
    h.future.push({ snapshot: snapshotForScope(scope), label: entry.label });
    restore(scope, entry);
    notifyHistory();
  }

  function redo(scope: HistoryScopeKey): void {
    const h = scope === 'config' ? configHistory : schemaHistory;
    const entry = h.future.pop();
    if (!entry) return;
    h.past.push({ snapshot: snapshotForScope(scope), label: entry.label });
    restore(scope, entry);
    notifyHistory();
  }

  function select<T>(selector: Selector<T>): T {
    return selector(state);
  }

  function subscribe<T>(selector: Selector<T>, listener: Listener<T>): () => void {
    const sub: Subscription = {
      selector: selector as Selector<unknown>,
      listener: listener as Listener<unknown>,
      lastValue: selector(state),
    };
    subs.add(sub);
    return () => {
      subs.delete(sub);
    };
  }

  function canUndo(scope: HistoryScopeKey): boolean {
    return (scope === 'config' ? configHistory : schemaHistory).past.length > 0;
  }
  function canRedo(scope: HistoryScopeKey): boolean {
    return (scope === 'config' ? configHistory : schemaHistory).future.length > 0;
  }
  function getUndoLabel(scope: HistoryScopeKey): string | null {
    const h = scope === 'config' ? configHistory : schemaHistory;
    return h.past.length > 0 ? (h.past[h.past.length - 1]!.label) : null;
  }
  function getRedoLabel(scope: HistoryScopeKey): string | null {
    const h = scope === 'config' ? configHistory : schemaHistory;
    return h.future.length > 0 ? (h.future[h.future.length - 1]!.label) : null;
  }
  function subscribeHistory(cb: () => void): () => void {
    historyListeners.add(cb);
    return () => historyListeners.delete(cb);
  }

  return {
    getState,
    dispatch,
    select,
    subscribe,
    undo,
    redo,
    canUndo,
    canRedo,
    getUndoLabel,
    getRedoLabel,
    subscribeHistory,
  };
}

function commitLabel(action: Action): string {
  switch (action.type) {
    case 'CONFIG_SAVE':
      return '保存配置';
    case 'CONFIG_DELETE':
      return '删除配置';
    case 'CONFIG_COPY':
      return '复制配置';
    default:
      return '操作';
  }
}
