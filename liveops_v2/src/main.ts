/**
 * main.ts — 应用入口
 *
 * 启动顺序：
 * 1. 注册内置字段类型（schema 引擎）+ 循环模式
 * 2. 创建 store（initialState 用 getDefaultSettings + 空 configs）
 * 3. 绑定 history 快捷键
 * 4. 渲染 app
 * 5. dev：自动注入 v1 数据（public/data/）
 */

import { createStore } from '@/core/store';
import type { AppState } from '@/core/types';
import { registerAllFieldTypes } from '@/schema/field-types';
import { registerBuiltinRecurrenceModes } from '@/model/recurrence/builtin';
import { registerBuiltinNormalizers } from '@/model/normalizers/builtin';
import { bindHistoryKeyboard } from '@/core/history-keyboard';
import { getDefaultSettings, injectV1Data } from '@/services/import-v1-data';
import { bindPersistence, loadPersisted, hydrateFromPersisted } from '@/services/persistence';
import { renderApp } from '@/ui/app';
import './styles/theme.css';
import './styles/layout.css';
import './styles/form.css';

// 1. 注册可拓展机制（阶段3 之前只内置现有类型/模式）
registerAllFieldTypes();
registerBuiltinRecurrenceModes();
registerBuiltinNormalizers();

// 2. 初始 state
const initialState: AppState = {
  configs: {},
  configIds: [],
  settings: getDefaultSettings(),
  ui: {
    activeTab: 'config',
    selectedConfigId: null,
    listSearch: '',
    listSort: 'duration',
    loadedFile: '',
    editSelectedIds: {},
    timeline: { sliderPos: 0.625, scrollLeft: 0, showStopped: false, rowHeight: 29 },
  },
  editor: { draft: null },
};

const store = createStore(initialState);

// 3. history 快捷键（Ctrl+Z / Y / Shift+Z）
bindHistoryKeyboard(store);

// 4. 渲染
const appEl = document.getElementById('app');
if (appEl) {
  renderApp(store, appEl);
  // 5. 持久化订阅：先挂，使后续任何 dispatch（缓存回放 / fetch 注入）都被写回本地
  bindPersistence(store);
  // 6. 启动数据源：优先本地缓存（刷新不丢），无缓存才走 import-v1-data fetch 链
  const cached = loadPersisted();
  if (cached) {
    hydrateFromPersisted(store, cached, '本地草稿（自动保存）');
  } else {
    injectV1Data(store).catch((e) => console.error('注入 v1 数据失败:', e));
  }
}
