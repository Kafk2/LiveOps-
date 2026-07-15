/**
 * services/persistence.ts — 本地持久化（localStorage 自动存 + 导出/导入备份文件）
 *
 * 场景：未接公司后台前的过渡方案。
 * - 自动存：bindPersistence(store) 订阅 settings/configs 变化 → debounce 300ms → 写 localStorage。
 * - 启动优先：main 调 loadPersisted()，命中即用缓存（跳过 fetch），否则走 import-v1-data fetch 链。
 * - 兜底：localStorage 会被「清除所有网站数据」清空 → 提供 exportBackup / importBackup 文件备份恢复。
 *
 * 权威性：localStorage 仅本地草稿缓存，非跨设备权威源；换浏览器/清数据后用备份文件恢复。
 * 容错：底层 storage.ts 已 try/catch，隐私模式静默降级，不抛错。
 */

import type { Config, Settings } from '@/core/types';
import type { Store } from '@/core/store';
import { getJSON, setJSON, remove } from '@/services/storage';

const SETTINGS_KEY = 'liveops-cfg:settings-v1';
const CONFIGS_KEY = 'liveops-cfg:configs-v1';
const BACKUP_VERSION = 1;

interface PersistedConfigs {
  configs: Record<string, Config>;
  configIds: string[];
}

export interface PersistedState {
  settings: Settings;
  configs: Record<string, Config>;
  configIds: string[];
}

export interface BackupBundle {
  version: number;
  exportedAt: string;
  settings: Settings;
  configs: Record<string, Config>;
  configIds: string[];
}

/** 按 configIds 顺序取出 configs 数组（CONFIGS_REPLACE 按数组序建 ids，需保序）。 */
function configsInOrder(configs: Record<string, Config>, configIds: string[]): Config[] {
  const out: Config[] = [];
  const seen = new Set<string>();
  for (const id of configIds) {
    const c = configs[id];
    if (c) {
      out.push(c);
      seen.add(id);
    }
  }
  // 兜底：configIds 缺失或多出的脏数据，追加剩余（不丢配置）
  for (const [id, c] of Object.entries(configs)) {
    if (!seen.has(id)) out.push(c);
  }
  return out;
}

/** 读本地缓存。settings 和 configs 都存在才认为有效（防部分写入导致数据错乱）。 */
export function loadPersisted(): PersistedState | null {
  const settings = getJSON<Settings | null>(SETTINGS_KEY, null);
  const cfg = getJSON<PersistedConfigs | null>(CONFIGS_KEY, null);
  if (!settings || !cfg || !cfg.configs || !Array.isArray(cfg.configIds)) return null;
  return { settings, configs: cfg.configs, configIds: cfg.configIds };
}

/** 把当前 store 快照写本地（settings + configs 一起）。 */
export function writePersisted(settings: Settings, configs: Record<string, Config>, configIds: string[]): void {
  setJSON(SETTINGS_KEY, settings);
  setJSON(CONFIGS_KEY, { configs, configIds });
}

/** 清空本地缓存（重置为初始 fetch 数据）。 */
export function clearPersisted(): void {
  remove(SETTINGS_KEY);
  remove(CONFIGS_KEY);
}

/** 把 PersistedState 注入 store（跳过 history，避免污染 undo 栈）。 */
export function hydrateFromPersisted(store: Store, state: PersistedState, loadedFile: string): void {
  store.dispatch({ type: 'SETTINGS_REPLACE', payload: state.settings, meta: { skipHistory: true } });
  store.dispatch({
    type: 'CONFIGS_REPLACE',
    payload: configsInOrder(state.configs, state.configIds),
    meta: { skipHistory: true },
  });
  store.dispatch({ type: 'UI_PATCH', payload: { loadedFile }, meta: { skipHistory: true } });
}

/**
 * 挂持久化订阅：settings / configs 任一变化 → debounce 300ms 写本地。
 * 返回 unsubscribe（main 中常驻，通常不调）。
 */
export function bindPersistence(store: Store): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    const s = store.getState();
    writePersisted(s.settings, s.configs, s.configIds);
    timer = null;
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 300);
  };
  const u1 = store.subscribe((s) => s.settings, schedule);
  const u2 = store.subscribe((s) => ({ configs: s.configs, configIds: s.configIds }), schedule);
  return () => {
    u1();
    u2();
    if (timer) clearTimeout(timer);
  };
}

/** 导出当前 store 全量快照为 JSON 备份文件并触发下载。 */
export function exportBackup(store: Store): void {
  const s = store.getState();
  const exportedAt = new Date().toISOString();
  const bundle: BackupBundle = {
    version: BACKUP_VERSION,
    exportedAt,
    settings: s.settings,
    configs: s.configs,
    configIds: s.configIds,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `liveops-cfg-backup-${exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 从用户选择的备份文件恢复：解析 → 校验 → 注入 store（自动触发持久化回写）。 */
export function importBackupFromFile(file: File, store: Store): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = JSON.parse(String(reader.result)) as Partial<BackupBundle>;
      if (!raw || !raw.settings || !raw.configs) {
        alert('备份文件格式不正确：缺少 settings 或 configs');
        return;
      }
      if (!confirm('导入备份将覆盖当前的设置和配置（不可撤销），确认继续？')) return;
      const configIds = Array.isArray(raw.configIds) ? raw.configIds : Object.keys(raw.configs);
      hydrateFromPersisted(store, { settings: raw.settings, configs: raw.configs, configIds }, '导入备份');
      alert('备份已导入');
    } catch (e) {
      console.error('[persistence] 备份解析失败', e);
      alert('备份文件解析失败（不是有效的 JSON）');
    }
  };
  reader.onerror = () => alert('读取备份文件失败');
  reader.readAsText(file);
}
