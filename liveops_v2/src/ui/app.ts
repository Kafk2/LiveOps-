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
import { renderTimeline } from '@/ui/timeline';
import { createRecurrenceWizard } from '@/ui/recurrence-wizard';
import { renderSchemaTab } from '@/ui/schema-tab';
import { resolveParamsSchema } from '@/schema/params-schema';

const TABS: { key: TabKey; label: string; enabled: boolean }[] = [
  { key: 'config', label: '配置管理', enabled: true },
  { key: 'dependency', label: '依赖关系', enabled: false },
  { key: 'mutex', label: '互斥组', enabled: false },
  { key: 'timeline', label: '时间轴', enabled: true },
  { key: 'compare', label: '版本对比', enabled: false },
  { key: 'schema', label: 'Schema 编辑', enabled: true },
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
      <main id="main">
        <div id="configTab" class="main-content">
          <section class="config-list" id="configList"></section>
          <section class="config-form" id="configForm"></section>
        </div>
        <div id="timelineTab" style="display:none;padding:20px;"></div>
        <div id="schemaTab" style="display:none;"></div>
      </main>
      <div id="exportArea" style="margin-top:16px;"></div>
    </div>
  `;

  const listEl = root.querySelector('#configList') as HTMLElement;
  const formEl = root.querySelector('#configForm') as HTMLElement;
  const statusEl = root.querySelector('#status') as HTMLElement;
  const exportEl = root.querySelector('#exportArea') as HTMLElement;

  // ---- 列表渲染（搜索/排序/折叠/discardUnsaved 守卫）----
  function renderList(): void {
    const state = store.getState();
    const metaMap = selectActivityMetaMap(state);
    const search = state.ui.listSearch.toLowerCase().trim();
    const sort = state.ui.listSort;
    const collapsed = state.settings.uiSettings.typeGroupCollapsed;

    let configs = selectConfigsArray(state);
    if (search) {
      configs = configs.filter(
        (c) =>
          getActivityName(c, metaMap).toLowerCase().includes(search) ||
          c.activityKey.toLowerCase().includes(search),
      );
    }

    statusEl.textContent = `已加载 ${configs.length} 条配置${search ? '（搜索结果）' : ''}（撤销 ${store.canUndo('config') ? '✓' : '✗'} / 重做 ${store.canRedo('config') ? '✓' : '✗'}）`;

    let html = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
      <input id="searchInput" type="text" placeholder="搜索活动名称/key（回车）" value="${escapeHtml(state.ui.listSearch)}" style="flex:1;min-width:140px;padding:6px 8px;border:1px solid var(--color-border);border-radius:4px;">
      <select id="sortSelect" style="padding:6px;border:1px solid var(--color-border);border-radius:4px;">
        <option value="duration"${sort === 'duration' ? ' selected' : ''}>按持续时间</option>
        <option value="name"${sort === 'name' ? ' selected' : ''}>按名称</option>
        <option value="date"${sort === 'date' ? ' selected' : ''}>按开始日期</option>
        <option value="custom"${sort === 'custom' ? ' selected' : ''}>自定义</option>
      </select>
      <button class="btn btn-primary btn-sm" id="newBtn">+ 新建</button>
    </div>`;

    if (configs.length === 0) {
      html += `<div class="empty-state">${search ? '未找到匹配的配置' : '暂无配置'}</div>`;
      listEl.innerHTML = html;
      bindListControls();
      return;
    }

    if (sort !== 'custom') {
      configs = [...configs].sort((a, b) => {
        if (sort === 'duration') return (parseInt(b.duration, 10) || 0) - (parseInt(a.duration, 10) || 0);
        if (sort === 'name') return getActivityName(a, metaMap).localeCompare(getActivityName(b, metaMap));
        return (b.scheduleStartDate || '').localeCompare(a.scheduleStartDate || '');
      });
    }

    const groups = new Map<string, Config[]>();
    for (const c of configs) {
      const type = getActivityType(c, metaMap);
      const arr = groups.get(type);
      if (arr) arr.push(c);
      else groups.set(type, [c]);
    }

    const selectedId = state.ui.selectedConfigId;
    for (const [type, items] of groups) {
      const isCollapsed = !!collapsed[type];
      html += `<div class="type-group-header" data-type="${escapeHtml(type)}" style="display:flex;align-items:center;gap:6px;padding:8px 0;cursor:pointer;font-weight:600;color:var(--color-primary);border-bottom:2px solid var(--color-border);user-select:none;">
        <span style="display:inline-block;transform:${isCollapsed ? '' : 'rotate(90deg)'};transition:transform 0.15s;">▶</span>
        <span>${escapeHtml(type)}（${items.length}）</span>
      </div>`;
      if (!isCollapsed) {
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
    }
    listEl.innerHTML = html;
    bindListControls();
  }

  function bindListControls(): void {
    // discardUnsavedIfNeeded 守卫：切换/新建前若有草稿需确认
    const draftGuard = (): boolean =>
      !store.getState().editor.draft || confirm('有未保存的修改，丢弃？');

    listEl.querySelector('#searchInput')?.addEventListener('change', (e) => {
      store.dispatch({ type: 'UI_PATCH', payload: { listSearch: (e.target as HTMLInputElement).value } });
    });
    listEl.querySelector('#sortSelect')?.addEventListener('change', (e) => {
      store.dispatch({
        type: 'UI_PATCH',
        payload: { listSort: (e.target as HTMLSelectElement).value as 'duration' | 'name' | 'date' | 'custom' },
      });
    });
    listEl.querySelector('#newBtn')?.addEventListener('click', () => {
      if (!draftGuard()) return;
      const c = createEmptyConfig();
      store.dispatch({ type: 'CONFIG_SAVE', payload: c });
      store.dispatch({ type: 'UI_PATCH', payload: { selectedConfigId: c.id } });
    });
    listEl.querySelectorAll<HTMLElement>('.type-group-header').forEach((h) => {
      h.addEventListener('click', () => {
        const type = h.dataset.type!;
        const s = store.getState().settings.uiSettings;
        const cur = { ...s.typeGroupCollapsed, [type]: !s.typeGroupCollapsed[type] };
        store.dispatch({
          type: 'SETTINGS_PATCH',
          payload: { uiSettings: { ...s, typeGroupCollapsed: cur } },
        });
      });
    });
    listEl.querySelectorAll<HTMLElement>('.config-row').forEach((row) => {
      row.addEventListener('click', () => {
        if (!draftGuard()) return;
        store.dispatch({ type: 'UI_PATCH', payload: { selectedConfigId: row.dataset.id ?? null } });
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

    const draft = store.getState().editor.draft;
    const draftMarkerText = draft ? ' ● 未保存' : '';
    let html = `<div class="section-title">编辑配置 · ${escapeHtml(config.activityKey || '(未命名)')}<span id="draftMarker" style="color:var(--color-warning);font-size:12px;">${draftMarkerText}</span></div>`;
    for (const f of CSV_SCHEMA) {
      if (f.key === 'recurrenceValue') {
        html += `<div class="form-group"><label>recurrenceValue</label><div id="recurrenceWizardHost"></div></div>`;
        continue;
      }
      if (f.key === 'params') {
        html += `<div class="form-group"><label>params</label><div id="paramsHost"></div></div>`;
        continue;
      }
      const draftVal = draft?.[f.key];
      const committedVal = (config as unknown as Record<string, string>)[f.key] ?? '';
      const val = draftVal ?? committedVal;
      const readonly = f.derived ? 'readonly style="background:#f5f5f5;"' : '';
      const req = f.required ? ' <span style="color:var(--color-danger)">*</span>' : '';
      const dirty =
        draftVal !== undefined && draftVal !== committedVal
          ? ' style="border-color:var(--color-warning);"'
          : '';
      html += `<div class="form-group"><label>${escapeHtml(f.key)}${req}</label><input data-field="${escapeHtml(f.key)}" value="${escapeHtml(val)}" ${readonly}${dirty}></div>`;
    }
    html += `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-success btn-sm" id="saveBtn">💾 保存（入撤销栈）</button>
      <button class="btn btn-secondary btn-sm" id="cancelBtn">取消（丢弃草稿）</button>
      <button class="btn btn-secondary btn-sm" id="copyBtn">复制</button>
      <button class="btn btn-danger btn-sm" id="delBtn">删除</button>
      <button class="btn btn-secondary btn-sm" id="exportBtn">导出 CSV</button>
    </div>`;

    formEl.innerHTML = html;

    // 字段编辑 → 写草稿（input 事件实时写，不碰 committed，不入栈）
    formEl.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const field = input.dataset.field as keyof Config;
        store.dispatch({ type: 'DRAFT_EDIT', payload: { field, value: input.value } });
      });
    });

    // 循环模式 wizard（recurrenceValue 不用 input，用受控插件 wizard）
    const wizardHost = formEl.querySelector<HTMLElement>('#recurrenceWizardHost');
    if (wizardHost) {
      const draftNow = store.getState().editor.draft;
      const wizardVal = draftNow?.recurrenceValue ?? config.recurrenceValue;
      const wizard = createRecurrenceWizard({
        value: wizardVal,
        onChange: (v) =>
          store.dispatch({ type: 'DRAFT_EDIT', payload: { field: 'recurrenceValue', value: v } }),
      });
      wizardHost.appendChild(wizard.getElement());
    }

    // params 结构化字段（按 resolveParamsSchema 渲染；无 schema 时回退 json input）
    const paramsHost = formEl.querySelector<HTMLElement>('#paramsHost');
    if (paramsHost) {
      const state = store.getState();
      const meta = selectActivityMetaMap(state)[config.activityKey];
      const activityType = meta?.activityType ?? 'unknown';
      const schemaFields = resolveParamsSchema(
        state.settings.paramsSchemas,
        config.activityKey,
        activityType,
      );
      const draftNow = store.getState().editor.draft;
      const paramsStr = draftNow?.params ?? config.params;
      let paramsObj: Record<string, unknown> = {};
      try {
        const p = JSON.parse(paramsStr);
        if (p && typeof p === 'object' && !Array.isArray(p)) paramsObj = p as Record<string, unknown>;
      } catch {
        // 脏 JSON：回退 json input
      }
      if (schemaFields.length === 0) {
        const ta = document.createElement('textarea');
        ta.rows = 3;
        ta.value = paramsStr;
        ta.style.cssText = 'width:100%;padding:6px;border:1px solid var(--color-border);border-radius:4px;font-family:monospace;font-size:12px;';
        ta.addEventListener('change', () =>
          store.dispatch({ type: 'DRAFT_EDIT', payload: { field: 'params', value: ta.value } }),
        );
        paramsHost.appendChild(ta);
      } else {
        const update = (key: string, val: unknown) => {
          const next = { ...paramsObj, [key]: val };
          store.dispatch({ type: 'DRAFT_EDIT', payload: { field: 'params', value: JSON.stringify(next) } });
        };
        for (const sf of schemaFields) {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'margin-bottom:6px;';
          const lbl = document.createElement('label');
          lbl.textContent = sf.key + (sf.required ? ' *' : '');
          lbl.style.cssText = 'display:block;font-size:12px;margin-bottom:2px;';
          wrap.appendChild(lbl);
          const input = document.createElement('input');
          input.value = String(paramsObj[sf.key] ?? sf.default ?? '');
          input.style.cssText = 'width:100%;padding:4px;border:1px solid var(--color-border);border-radius:3px;';
          input.addEventListener('change', () => update(sf.key, input.value));
          wrap.appendChild(input);
          paramsHost.appendChild(wrap);
        }
      }
    }

    formEl.querySelector('#cancelBtn')?.addEventListener('click', () => {
      store.dispatch({ type: 'DRAFT_RESET' });
      renderForm();
    });

    formEl.querySelector('#saveBtn')?.addEventListener('click', () => {
      // 保存 = committed + 所有未应用草稿（input/wizard 都已实时写入 draft）
      const draftNow = store.getState().editor.draft ?? {};
      const next: Config = { ...config, ...draftNow } as Config;
      store.dispatch({ type: 'CONFIG_SAVE', payload: next });
      renderForm();
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

  // ---- tab 路由（config / timeline）----
  const navEl = root.querySelector('#navTabs') as HTMLElement;
  const configTabEl = root.querySelector('#configTab') as HTMLElement;
  const timelineTabEl = root.querySelector('#timelineTab') as HTMLElement;
  const schemaTabEl = root.querySelector('#schemaTab') as HTMLElement;

  function syncTabs(): void {
    const active = store.getState().ui.activeTab;
    navEl.querySelectorAll<HTMLElement>('.nav-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === active);
    });
    configTabEl.style.display = active === 'config' ? '' : 'none';
    timelineTabEl.style.display = active === 'timeline' ? '' : 'none';
    schemaTabEl.style.display = active === 'schema' ? '' : 'none';
  }
  navEl.querySelectorAll<HTMLButtonElement>('.nav-tab').forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      store.dispatch({
        type: 'UI_PATCH',
        payload: { activeTab: btn.dataset.tab as TabKey },
      });
    });
  });
  syncTabs();
  renderTimeline(store, timelineTabEl);
  renderSchemaTab(store, schemaTabEl);

  // 订阅：configsArray 变 → 列表刷新；selectedConfigId 变 → 表单刷新
  store.subscribe(selectConfigsArray, () => renderList());
  store.subscribe((s) => s.ui.listSearch, renderList);
  store.subscribe((s) => s.ui.listSort, renderList);
  store.subscribe((s) => s.settings.uiSettings.typeGroupCollapsed, renderList);
  store.subscribe((s) => s.ui.selectedConfigId, () => renderForm());
  store.subscribe((s) => s.ui.activeTab, syncTabs);
  // draft 变 → 只更新 marker（不重渲染表单，避免失焦）
  store.subscribe((s) => s.editor.draft, () => {
    const m = root.querySelector('#draftMarker');
    if (m) m.textContent = store.getState().editor.draft ? ' ● 未保存' : '';
  });
  // history 状态变化 → status 刷新
  store.subscribeHistory(() => renderList());
}
