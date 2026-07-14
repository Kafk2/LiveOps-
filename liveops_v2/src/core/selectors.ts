/**
 * core/selectors.ts — memoized 选择器（reselect 风格）
 *
 * createSelector 的 input 用 Object.is 比较。依赖 store 的 structural sharing：
 * 未变更的切片保持引用稳定，input 不变则跳过 resultFn，返回缓存输出。
 * 这在 2000 配置规模下让 s => s.configs[id] 的订阅只在自己的 config 变更时触发。
 */

import { AppState, Config, ActivityMeta, Selector } from './types';

export function createSelector<I extends unknown[], R>(
  inputs: { [K in keyof I]: Selector<I[K]> },
  resultFn: (...args: I) => R,
): Selector<R> {
  let lastInputs: I | null = null;
  let lastOutput: R;
  return (state: AppState): R => {
    const cur = inputs.map((fn) => fn(state)) as I;
    if (
      lastInputs !== null &&
      cur.length === lastInputs.length &&
      cur.every((v, i) => Object.is(v, lastInputs![i]))
    ) {
      return lastOutput;
    }
    lastInputs = cur;
    lastOutput = resultFn(...cur);
    return lastOutput;
  };
}

// ----------------------------------------------------------------------------
// 基础切片选择器（返回 state 内引用，保持 structural sharing）
// ----------------------------------------------------------------------------

export const selectConfigs: Selector<Record<string, Config>> = (s) => s.configs;
export const selectConfigIds: Selector<string[]> = (s) => s.configIds;
export const selectSettings: Selector<AppState['settings']> = (s) => s.settings;
export const selectUISettings: Selector<AppState['settings']['uiSettings']> = (s) =>
  s.settings.uiSettings;
export const selectActivityMeta: Selector<ActivityMeta[]> = (s) => s.settings.activityMeta;
export const selectParamsSchemas: Selector<AppState['settings']['paramsSchemas']> = (s) =>
  s.settings.paramsSchemas;

// ----------------------------------------------------------------------------
// 派生选择器
// ----------------------------------------------------------------------------

/** configs 数组（保序，过滤已删除）—— memoized，依赖切片引用稳定 */
export const selectConfigsArray: Selector<Config[]> = createSelector(
  [selectConfigs, selectConfigIds],
  (configs, ids) => ids.map((id) => configs[id]).filter((c): c is Config => c != null),
);

/** activityKey → ActivityMeta 索引（memoized） */
export const selectActivityMetaMap: Selector<Record<string, ActivityMeta>> = createSelector(
  [selectActivityMeta],
  (meta) => {
    const m: Record<string, ActivityMeta> = {};
    for (const a of meta) m[a.activityKey] = a;
    return m;
  },
);

/** 按 configId 取配置（工厂选择器） */
export function selectConfigById(id: string): Selector<Config | null> {
  return (s) => s.configs[id] ?? null;
}

/** 按 configId 取 bar 颜色（工厂选择器） */
export function selectBarColor(configId: string): Selector<string | null> {
  return (s) => s.settings.uiSettings.barColors[configId] ?? null;
}

// ----------------------------------------------------------------------------
// join 工具（非 memoized，供渲染层调用，输入是已选数据）
// ----------------------------------------------------------------------------

/** 获取 config 的 activityType（从 activityMeta join，CSV 里没有此字段） */
export function getActivityType(
  config: Config,
  metaMap: Record<string, ActivityMeta>,
): string {
  return metaMap[config.activityKey]?.activityType ?? 'unknown';
}

export function getActivityName(
  config: Config,
  metaMap: Record<string, ActivityMeta>,
): string {
  return metaMap[config.activityKey]?.activityName ?? config.activityKey;
}
