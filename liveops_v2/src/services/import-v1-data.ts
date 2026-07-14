/**
 * services/import-v1-data.ts — dev 脚本：从 public/data/ 加载 v1 数据并组装 AppState 注入 store
 *
 * 职责：
 *   阶段 1-3（GitHub 同步尚未接入时）让 dev server 也能跑真实 v1 数据。
 *   从 public/data/ 多级回退加载 schedule + settings，组装好后 dispatch 进 store。
 *
 * 关键设计：
 *   1. 多级 HTTP 回退链（放弃 file://，dev/prod 一致走 fetch 相对路径）：
 *        主链路  latest.json → 版本化 schedule CSV（./data/<path>/<scheduleFile>）
 *        回退 1  ./data/schedule.csv（latest.json 或版本化 CSV 任一环节失败时）
 *        settings ./data/settings.json → 失败回退 getDefaultSettings()
 *      任一 fetch 失败仅 console.warn，不抛错，最终返回尽量多的数据 + 默认 settings。
 *   2. CSV 文本 → Config[] 交给 csv-codec 的 parseCSV + decodeConfigs（schema 驱动），
 *      本文件不感知具体列顺序，保持与 csv-schema 解耦。
 *   3. 注入走 CONFIGS_REPLACE / SETTINGS_REPLACE 且 meta.skipHistory = true，
 *      避免初始数据污染 undo 栈（与 GitHub pull / 批量导入同语义，见 core/store.ts）。
 */

import type { Config, Settings } from '@/core/types';
import type { Store } from '@/core/store';
import { parseCSV, decodeConfigs } from '@/services/csv-codec';

// ----------------------------------------------------------------------------
// getDefaultSettings —— fetch 失败时的最小合法 Settings 兜底
// ----------------------------------------------------------------------------

/**
 * 返回一份全新的最小合法 Settings（每次调用产生新对象，避免共享可变引用）。
 * heatmapRules 给 4 档默认配色（空档期 / 少量 / 适中 / 过量）。
 */
export function getDefaultSettings(): Settings {
  return {
    activityMeta: [],
    dependencies: [],
    mutexGroups: [],
    uiSettings: {
      configOrder: {},
      activityTypeOrder: ['default', 'festival', 'gift', 'feature'],
      typeGroupCollapsed: {},
      mergeGroups: [],
      heatmapRules: [
        { min: 1, color: '#F6FFED', label: '空档期' },
        { min: 2, color: '#FFEC3D', label: '少量' },
        { min: 8, color: '#16d419', label: '适中' },
        { min: 15, color: '#FF7A45', label: '过量' },
      ],
      barColors: {},
    },
    paramsSchemas: { byType: {}, overrides: {}, version: 1 },
  };
}

// ----------------------------------------------------------------------------
// loadV1Data —— 多级回退加载 configs + settings（失败不抛错）
// ----------------------------------------------------------------------------

/** latest.json 仅消费 path + scheduleFile 两个字段用于定位版本化 CSV */
interface LatestManifest {
  path?: string;
  scheduleFile?: string;
}

/** 安全 fetch 文本：网络/HTTP 错误统一返回 null，不抛错 */
async function fetchText(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[import-v1-data] ${url} 获取失败 (HTTP ${resp.status})`);
      return null;
    }
    return await resp.text();
  } catch (e) {
    console.warn(`[import-v1-data] ${url} 网络异常`, e);
    return null;
  }
}

/** 安全 fetch JSON：失败返回 null，不抛错 */
async function fetchJson<T>(url: string): Promise<T | null> {
  const text = await fetchText(url);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    console.warn(`[import-v1-data] ${url} JSON 解析异常`, e);
    return null;
  }
}

/** CSV 文本 → Config[]（schema 驱动编解码由 csv-codec 完成） */
function decodeCsvToConfigs(csvText: string): Config[] {
  try {
    return decodeConfigs(parseCSV(csvText));
  } catch (e) {
    console.warn('[import-v1-data] CSV 解码异常', e);
    return [];
  }
}

/**
 * 从 public/data/ 加载 v1 数据。
 * 多级回退，失败不抛错，返回尽量多的数据 + 默认 settings。
 */
export async function loadV1Data(): Promise<{ configs: Config[]; settings: Settings }> {
  let configs: Config[] = [];
  let primarySucceeded = false;

  // ---- 主链路：latest.json → 版本化 schedule CSV ----
  const latest = await fetchJson<LatestManifest>('./data/latest.json');
  if (latest && latest.path && latest.scheduleFile) {
    const csvText = await fetchText(`./data/${latest.path}/${latest.scheduleFile}`);
    if (csvText != null) {
      configs = decodeCsvToConfigs(csvText);
      // 注意：dev server 对不存在的路径可能 SPA 回退返回 200 HTML，
      // 此时 decode 得空 configs，必须继续回退（不能仅凭 csvText != null 判成功）
      primarySucceeded = configs.length > 0;
      if (!primarySucceeded) {
        console.warn('[import-v1-data] 版本化 schedule 解析为空（可能 HTML 回退），回退 schedule.csv');
      }
    } else {
      console.warn('[import-v1-data] 版本化 schedule 获取失败，回退 schedule.csv');
    }
  } else if (latest != null) {
    console.warn('[import-v1-data] latest.json 缺少 path/scheduleFile，回退 schedule.csv');
  }
  // latest == null 时 fetchText/fetchJson 已 warn 过，这里静默进入回退

  // ---- 回退：根目录 schedule.csv ----
  if (!primarySucceeded) {
    const csvText = await fetchText('./data/schedule.csv');
    if (csvText != null) {
      configs = decodeCsvToConfigs(csvText);
    }
  }

  // ---- settings.json → 失败用默认 ----
  const settingsJson = await fetchJson<Settings>('./data/settings.json');
  const settings: Settings = settingsJson ?? getDefaultSettings();

  return { configs, settings };
}

// ----------------------------------------------------------------------------
// injectV1Data —— 加载并注入 store（skipHistory，避免污染 undo 栈）
// ----------------------------------------------------------------------------

/**
 * 加载 v1 数据后 dispatch CONFIGS_REPLACE + SETTINGS_REPLACE。
 * meta.skipHistory = true：初始注入不应成为 undo 起点（与 GitHub pull 同语义）。
 */
export async function injectV1Data(store: Store): Promise<void> {
  const { configs, settings } = await loadV1Data();
  store.dispatch({
    type: 'CONFIGS_REPLACE',
    payload: configs,
    meta: { skipHistory: true },
  });
  store.dispatch({
    type: 'SETTINGS_REPLACE',
    payload: settings,
    meta: { skipHistory: true },
  });
}
