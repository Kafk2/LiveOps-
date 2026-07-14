/**
 * ui/app.ts — 根组件（阶段1 最小可用）
 *
 * 阶段1 目标：验证数据流（import-v1-data → store → 列表+表单 → 编辑保存 → CSV 闭环）。
 * - 左侧配置列表：按 activityType 分组（activityMeta join），点击选中
 * - 右侧配置表单：按 csv-schema 渲染字段（简化 input，derived 字段只读）
 * - 编辑 onchange → dispatch CONFIG_UPDATE_FIELD（细粒度，不入栈）
 * - 保存按钮 → dispatch CONFIG_SAVE（显式 commit 点，入 history）
 *
 * 阶段2/3 升级： FieldType.create 复合控件、虚拟列表、完整分组/折叠/拖拽。
 */

import type { Store } from '@/core/store';
import {
  selectConfigsArray,
  selectActivityMetaMap,
  getActivityName,
  getActivityType,
} from '@/core/selectors';
import { isEnabled, Config, TabKey } from '@/core/types';
import { CSV_SCHEMA } from '@/schema/csv-schema';
import { createEmptyConfig, copyConfig } from '@/model/config';
import { encodeConfigs } from '@/services/csv-codec';

const TABS: { key: TabKey; label: string; enabled: boolean }[] = [
  { key: 'config', label: '配置管理', enabled: true },
  { key: 'dependency', label: '依赖关系', enabled: false },
  { key: 'mutex', label: '互斥组', enabled: false },
  { key: 'timeline', label: '时间轴', enabled: false },
  { key: 'compare', label: '版本对比', enabled: false },
  { key: 'schema', label: 'Schema 编辑', enabled: false },
];

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderApp(store: Store, root: HTMLElement): void {
  root.innerHTML = `
    <div class="container">
      <header class="header">
        <h1>活动配置管理系统 v2</h1>
        <div class="status" id="status">加载中…</div>
      </header>
      <nav class="nav-tabs" id="navTabs">
        ${TABS.map(
          (t) =>
            `<button class="nav-tab${t.key === 'config' ? ' active' : ''}${
              t.enabled ? '' : ' disabled'
            }" data-tab="${t.key}"${t.enabled ? '' : ' disabled'}>${t.label}</button>`,
        ).join('')}
      </nav>
      <main class="main-content" id="main">
        <section class="config-list" id="configList"></section>
        <section class="config-form" id="configForm"></section>
      </main>
      <div id="exportArea" style="margin-top:16px;"></div>
    </div>
  `;

  const listEl = root.querySelector('#configList') as HTMLElement;
  const formEl = root.querySelector('#configForm') as HTMLElement;
  const statusEl = root.querySelector('#status') as HTMLElement;
  const exportEl = root.querySelector('#exportArea') as HTMLElement;

  // ---- 列表渲染 ----
  function renderList(): void {
    const state = store.getState();
    const configs = selectConfigsArray(state);
    const metaMap = selectActivityMetaMap(state);

    statusEl.textContent = `已加载 ${configs.length} 条配置（撤销 ${store.canUndo('config') ? '✓' : '✗'} / 重做 ${store.canRedo('config') ? '✓' : '✗'}）`;

    if (configs.length === 0) {
      listEl.innerHTML = '<div class="empty-state">暂无配置</div>';
      return;
    }

    // 按 activityType 分组（activityMeta join）
    const groups = new Map<string, Config[]>();
    for (const c of configs) {
      const type = getActivityType(c, metaMap);
      const arr = groups.get(type);
      if (arr) arr.push(c);
      else groups.set(type, [c]);
    }

    const selectedId = state.ui.selectedConfigId;
    let html = `<button class="btn btn-primary btn-sm" id="newBtn" style="margin-bottom:12px;">+ 新建配置</button>`;
    for (const [type, items] of groups) {
      html += `<div style="margin-top:12px;font-weight:600;color:var(--color-primary);border-bottom:2px solid var(--color-border);padding-bottom:4px;">${escapeHtml(type)}（${items.length}）</div>`;
      html += '<table class="config-table"><tbody>';
      for (const c of items) {
        const active = c.id === selectedId ? ' active' : '';
        const name = escapeHtml(getActivityName(c, metaMap));
        const badge = isEnabled(c)
          ? '<span class="status-badge status-enabled">启用</span>'
          : '<span class="status-badge status-disabled">停用</span>';
        html += `<tr class="config-row${active}" data-id="${escapeHtml(c.id)}"><td>${name}</td><td>${escapeHtml(c.activityKey)}</td><td>${escapeHtml(c.scheduleStartDate)}</td><td>${badge}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    listEl.innerHTML = html;

    listEl.querySelector('#newBtn')?.addEventListener('click', () => {
      const c = createEmptyConfig();
      store.dispatch({ type: 'CONFIG_SAVE', payload: c });
      store.dispatch({ type: 'UI_PATCH', payload: { selectedConfigId: c.id } });
    });
    listEl.querySelectorAll<HTMLElement>('.config-row').forEach((row) => {
      row.addEventListener('click', () => {
        store.dispatch({
          type: 'UI_PATCH',
          payload: { selectedConfigId: row.dataset.id ?? null },
        });
      });
    });
  }

  // ---- 表单渲染（仅在 selectedConfigId 变化时重渲染，避免编辑失焦）----
  function renderForm(): void {
    const state = store.getState();
    const id = state.ui.selectedConfigId;
    const config = id ? state.configs[id] ?? null : null;

    if (!config) {
      formEl.innerHTML = '<div class="empty-state">从左侧选择一个配置，或新建</div>';
      return;
    }

    let html = `<div class="section-title">编辑配置 · ${escapeHtml(config.activityKey || '(未命名)')}</div>`;
    for (const f of CSV_SCHEMA) {
      const val = (config as unknown as Record<string, string>)[f.key] ?? '';
      const readonly = f.derived ? 'readonly style="background:#f5f5f5;"' : '';
      const req = f.required ? ' <span style="color:var(--color-danger)">*</span>' : '';
      html += `<div class="form-group"><label>${escapeHtml(f.key)}${req}</label><input data-field="${escapeHtml(f.key)}" value="${escapeHtml(val)}" ${readonly}></div>`;
    }
    html += `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-success btn-sm" id="saveBtn">💾 保存（入撤销栈）</button>
      <button class="btn btn-secondary btn-sm" id="copyBtn">复制</button>
      <button class="btn btn-danger btn-sm" id="delBtn">删除</button>
      <button class="btn btn-secondary btn-sm" id="exportBtn">导出 CSV</button>
    </div>`;

    formEl.innerHTML = html;

    // 字段编辑 → 细粒度 dispatch（不入栈）
    formEl.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => {
      input.addEventListener('change', () => {
        const field = input.dataset.field as keyof Config;
        store.dispatch({
          type: 'CONFIG_UPDATE_FIELD',
          payload: { id: config.id, field, value: input.value },
        });
      });
    });

    formEl.querySelector('#saveBtn')?.addEventListener('click', () => {
      // 收集 DOM 当前值（编辑后未 change 的也一并存）
      const patch: Record<string, string> = {};
      formEl.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => {
        const k = input.dataset.field!;
        if (!CSV_SCHEMA.find((f) => f.key === k)?.derived) patch[k] = input.value;
      });
      const next: Config = { ...config, ...patch } as Config;
      store.dispatch({ type: 'CONFIG_SAVE', payload: next });
    });

    formEl.querySelector('#copyBtn')?.addEventListener('click', () => {
      const c = copyConfig(config);
      store.dispatch({ type: 'CONFIG_COPY', payload: { sourceId: config.id, newId: c.id } });
      store.dispatch({ type: 'UI_PATCH', payload: { selectedConfigId: c.id } });
    });

    formEl.querySelector('#delBtn')?.addEventListener('click', () => {
      store.dispatch({ type: 'CONFIG_DELETE', payload: config.id });
      store.dispatch({ type: 'UI_PATCH', payload: { selectedConfigId: null } });
    });

    formEl.querySelector('#exportBtn')?.addEventListener('click', () => {
      const csv = encodeConfigs(selectConfigsArray(store.getState()));
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      exportEl.innerHTML = `<a href="${url}" download="schedule_v2.csv" class="btn btn-primary btn-sm">⬇ 下载 schedule_v2.csv</a>`;
    });
  }

  renderList();
  renderForm();

  // 订阅：configsArray 变 → 列表刷新；selectedConfigId 变 → 表单刷新
  store.subscribe(selectConfigsArray, () => renderList());
  store.subscribe((s) => s.ui.selectedConfigId, () => renderForm());
  // history 状态变化 → status 刷新
  store.subscribeHistory(() => renderList());
}
