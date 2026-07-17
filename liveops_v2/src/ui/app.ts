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
import { runNormalizers } from '@/schema/validators';
import { createEmptyConfig, copyConfig } from '@/model/config';
import { parseRecurrenceValue } from '@/model/recurrence/builtin';
import {
  parseDuration,
  mergeDuration,
  endDateToCycleCount,
  cycleCountToEndDateString,
  validateDurationAgainstPeriod,
} from '@/model/cycle';
import { calculateActualSchedules } from '@/model/schedule';
import {
  TL_COLOR_PALETTE,
  colorBtnBackground,
  titleBarBackground,
} from '@/ui/color-palette';
import { encodeConfigs, parseCSV, decodeConfigs } from '@/services/csv-codec';
import { renderTimeline } from '@/ui/timeline';
import { createRecurrenceWizard } from '@/ui/recurrence-wizard';
import { renderSchemaTab } from '@/ui/schema-tab';
import { resolveParamsSchema } from '@/schema/params-schema';
import { getFieldType } from '@/schema/field-types';
import type { FieldController, FieldDef } from '@/schema/field-types';
import { parseParamsVariants, serializeParamsVariants, type ParamVariant } from '@/model/params';
import { renderDependencyTab, renderMutexTab } from '@/ui/relation-tabs';
import { renderActivityMgmtTab } from '@/ui/activity-management-tab';
import { renderSegmentTab } from '@/ui/segment-tab';
import { createSegmentBuilder } from '@/ui/segment-builder';

const TABS: { key: TabKey; label: string; enabled: boolean }[] = [
  { key: 'config', label: '配置管理', enabled: true },
  { key: 'activityMgmt', label: '活动管理', enabled: true },
  { key: 'segment', label: '玩家分群', enabled: true },
  { key: 'dependency', label: '依赖关系', enabled: true },
  { key: 'mutex', label: '互斥组', enabled: true },
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

/** weekly/biweekly 循环要求开始日期为周一（用于实时 hint + normalizer 触发条件） */
function needsMonday(recurrenceValue: string): boolean {
  const mode = parseRecurrenceValue(recurrenceValue);
  return mode === 'weekly' || mode === 'biweekly';
}

/** 触发浏览器直接下载 CSV（不显示下载按钮） */
function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** draft 是否有字段与 committed 不同（真正改动才显示"未保存"，改回原值不算） */
function isDirty(draft: Partial<Record<string, string>> | null, config: Config): boolean {
  if (!draft) return false;
  const c = config as unknown as Record<string, string>;
  return Object.keys(draft).some((k) => draft[k] !== c[k]);
}

/** Date → YYYY-MM-DD HH:MM */
function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 解析 skin 字符串为皮肤列表（兼容旧 v1 JSON 数组 `["a","b"]` 与逗号分隔 `a,b`）。
 * 底层存储用逗号分隔（彻底无 []），CSV 列含逗号自动引号包裹。
 */
function parseSkinList(s: string): string[] {
  const str = (s ?? '').trim();
  if (!str) return [];
  try {
    const p = JSON.parse(str);
    if (Array.isArray(p)) return p.map((x) => String(x).trim()).filter((x) => x.length);
  } catch {
    // 非 JSON 数组：按逗号分隔
  }
  return str
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length);
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
        <div id="dependencyTab" style="display:none;"></div>
        <div id="mutexTab" style="display:none;"></div>
        <div id="activityMgmtTab" style="display:none;padding:20px;"></div>
        <div id="segmentTab" style="display:none;padding:20px;"></div>
      </main>
      <div id="exportArea" style="margin-top:16px;"></div>
    </div>
  `;

  const listEl = root.querySelector('#configList') as HTMLElement;
  const formEl = root.querySelector('#configForm') as HTMLElement;
  const statusEl = root.querySelector('#status') as HTMLElement;

  // 行拖拽当前 dragId（闭包变量，dragstart 写入 / drop 读取 / dragend 清空）
  let rowDragId: string | null = null;
  // 颜色选择器"点击外部关闭"的 document 监听（renderForm 重渲染前先移除旧的，避免泄漏）
  let docClickHandler: ((e: MouseEvent) => void) | null = null;
  // activityKey 搜索下拉"点击外部关闭"的 document 监听
  let akDocClickHandler: ((e: MouseEvent) => void) | null = null;

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

    // 标题行（贴近 v1：标题 + 导入/导出 CSV）
    const total = selectConfigsArray(state).length;
    statusEl.textContent = `${state.ui.loadedFile ? `已载入 ${state.ui.loadedFile}，` : ''}共 ${total} 条配置${search ? `（搜索到 ${configs.length} 条）` : ''}`;
    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <h2 style="margin:0;font-size:16px;">配置列表</h2>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary btn-sm" id="importBtn">📥 导入 CSV</button>
        <button class="btn btn-secondary btn-sm" id="exportAllBtn">📤 导出 CSV</button>
      </div>
    </div>`;
    // 搜索行（贴近 v1：搜索 + 排序 + 编辑排序 + 新建）
    const isCustom = sort === 'custom';
    const selMap = state.ui.editSelectedIds;
    const selectedCount = Object.keys(selMap).filter((id) => selMap[id]).length;
    const totalCount = selectConfigsArray(state).length;
    html += `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
      <input id="searchInput" type="text" placeholder="搜索活动名称/key（回车）" value="${escapeHtml(state.ui.listSearch)}" style="flex:1;min-width:140px;padding:6px 8px;border:1px solid var(--color-border);border-radius:4px;">
      <select id="sortSelect" style="padding:6px;border:1px solid var(--color-border);border-radius:4px;">
        <option value="duration"${sort === 'duration' ? ' selected' : ''}>按持续时间</option>
        <option value="name"${sort === 'name' ? ' selected' : ''}>按名称</option>
        <option value="date"${sort === 'date' ? ' selected' : ''}>按开始日期</option>
        <option value="custom"${sort === 'custom' ? ' selected' : ''}>自定义</option>
      </select>
      <button class="btn ${isCustom ? 'btn-primary' : 'btn-secondary'} btn-sm" id="editOrderBtn">${isCustom ? '✓ 编辑排序中' : '📒 编辑排序'}</button>
      ${isCustom ? `<button class="btn btn-secondary btn-sm" id="selectAllBtn">${selectedCount >= totalCount && totalCount > 0 ? '取消全选' : '全选'}</button>` : ''}
      ${isCustom && selectedCount > 0 ? `<button class="btn btn-danger btn-sm" id="batchDelBtn">🗑 删除选中(${selectedCount})</button>` : ''}
      <button class="btn btn-primary btn-sm" id="newBtn">+ 新建</button>
      <input type="file" id="importFile" accept=".csv,text/csv" style="display:none;">
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

    // custom 排序：按 uiSettings.configOrder[type] 重排各组内顺序（v1 index.html:2639 语义）
    if (sort === 'custom') {
      const order = state.settings.uiSettings.configOrder;
      for (const [type, items] of groups) {
        const orderIds = order[type] ?? [];
        items.sort((a, b) => {
          let ia = orderIds.indexOf(a.id);
          let ib = orderIds.indexOf(b.id);
          if (ia < 0) ia = 99999;
          if (ib < 0) ib = 99999;
          return ia - ib;
        });
      }
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
          const isCustom = sort === 'custom';
          const sel = state.ui.editSelectedIds;
          const selClass = isCustom && sel[c.id] ? ' edit-selected' : '';
          const cb = isCustom
            ? `<label class="edit-cb-wrap"><input type="checkbox" class="edit-cb" data-id="${escapeHtml(c.id)}"${sel[c.id] ? ' checked' : ''}></label>`
            : '';
          const dragAttrs = isCustom ? ' draggable="true"' : '';
          html += `<tr class="config-row${active}${selClass}" data-id="${escapeHtml(c.id)}"${dragAttrs}><td>${cb}${name}</td><td>${escapeHtml(c.activityKey)}</td><td>${escapeHtml(c.scheduleStartDate)}</td><td>${badge}</td></tr>`;
        }
        html += '</tbody></table>';
      }
    }
    listEl.innerHTML = html;
    bindListControls();
  }

  function bindListControls(): void {
    // discardUnsavedIfNeeded 守卫：切换/新建前若有草稿需确认
    // discardGuard：切配置/新建前若有真正改动（draft 与 committed 有差异）才确认
    const draftGuard = (): boolean => {
      const st = store.getState();
      const id = st.ui.selectedConfigId;
      const cfg = id ? st.configs[id] ?? null : null;
      return !cfg || !isDirty(st.editor.draft, cfg) || confirm('有未保存的修改，丢弃？');
    };

    listEl.querySelector('#searchInput')?.addEventListener('change', (e) => {
      store.dispatch({ type: 'UI_PATCH', payload: { listSearch: (e.target as HTMLInputElement).value } });
    });
    listEl.querySelector('#sortSelect')?.addEventListener('change', (e) => {
      store.dispatch({
        type: 'UI_PATCH',
        payload: { listSort: (e.target as HTMLSelectElement).value as 'duration' | 'name' | 'date' | 'custom' },
      });
    });
    // 编辑排序：切换 custom 模式（行可拖拽 + 多选），退出时清空多选
    listEl.querySelector('#editOrderBtn')?.addEventListener('click', () => {
      const cur = store.getState().ui.listSort;
      const next = cur === 'custom' ? 'duration' : 'custom';
      store.dispatch({ type: 'UI_PATCH', payload: { listSort: next, editSelectedIds: {} } });
    });
    // 全选 / 取消全选（仅 custom 模式）
    listEl.querySelector('#selectAllBtn')?.addEventListener('click', () => {
      const st = store.getState();
      const allIds = selectConfigsArray(st).map((c) => c.id);
      const cur = st.ui.editSelectedIds;
      const allSelected = allIds.length > 0 && allIds.every((id) => cur[id]);
      const nextSel = allSelected
        ? {}
        : Object.fromEntries(allIds.map((id) => [id, true] as const));
      store.dispatch({ type: 'UI_PATCH', payload: { editSelectedIds: nextSel } });
    });
    // 批量删除选中（CONFIGS_DELETE_BATCH 一次入 history）
    listEl.querySelector('#batchDelBtn')?.addEventListener('click', () => {
      const sel = store.getState().ui.editSelectedIds;
      const ids = Object.keys(sel).filter((id) => sel[id]);
      if (ids.length === 0) return;
      if (!confirm(`确定删除选中的 ${ids.length} 条配置？`)) return;
      store.dispatch({ type: 'CONFIGS_DELETE_BATCH', payload: ids });
      store.dispatch({ type: 'UI_PATCH', payload: { editSelectedIds: {} } });
    });
    // 多选勾选框：label 包裹扩大 hit area（方块不变），click 阻止冒泡避免触发选中配置
    listEl.querySelectorAll<HTMLElement>('.edit-cb-wrap').forEach((wrap) => {
      wrap.addEventListener('click', (e) => e.stopPropagation());
    });
    listEl.querySelectorAll<HTMLInputElement>('.edit-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.id!;
        const sel = { ...store.getState().ui.editSelectedIds };
        if (cb.checked) sel[id] = true;
        else delete sel[id];
        store.dispatch({ type: 'UI_PATCH', payload: { editSelectedIds: sel } });
      });
    });
    // 导出全部配置 CSV：直接下载（不显示下载按钮）
    listEl.querySelector('#exportAllBtn')?.addEventListener('click', () => {
      downloadCSV('schedule_v2.csv', encodeConfigs(selectConfigsArray(store.getState())));
    });
    listEl.querySelector('#newBtn')?.addEventListener('click', () => {
      if (!draftGuard()) return;
      const c = createEmptyConfig();
      store.dispatch({ type: 'CONFIG_SAVE', payload: c });
      store.dispatch({ type: 'UI_PATCH', payload: { selectedConfigId: c.id } });
    });
    // 导入 CSV：文件选择 → parseCSV → decodeConfigs → CONFIGS_REPLACE
    const importBtn = listEl.querySelector('#importBtn');
    const importFile = listEl.querySelector('#importFile') as HTMLInputElement | null;
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', async () => {
        const file = importFile.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const configs = decodeConfigs(parseCSV(text));
          if (configs.length === 0) {
            alert('未解析到有效配置（检查 CSV 格式/表头）');
            return;
          }
          if (!confirm(`导入 ${configs.length} 条配置？将替换当前所有配置。`)) return;
          store.dispatch({ type: 'CONFIGS_REPLACE', payload: configs, meta: { skipHistory: true } });
          store.dispatch({ type: 'UI_PATCH', payload: { selectedConfigId: null, loadedFile: file.name } });
        } catch (e) {
          alert('导入失败：' + (e as Error).message);
        }
        importFile.value = ''; // 允许重复导入同一文件
      });
    }
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

    // 行拖拽排序（仅 custom 模式下行带 draggable；多选时带选中行一起移动）
    listEl.querySelectorAll<HTMLElement>('.config-row[draggable="true"]').forEach((row) => {
      row.addEventListener('dragstart', (e) => {
        rowDragId = row.dataset.id ?? null;
        if (!rowDragId || !e.dataTransfer) return;
        e.dataTransfer.setData('text/plain', 'row:' + rowDragId);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
        // 多选拖拽：若拖拽行已选中且有其他选中，标记 buddy 行（一起移动）
        const sel = store.getState().ui.editSelectedIds;
        if (sel[rowDragId]) {
          listEl.querySelectorAll<HTMLElement>('.config-row[data-id]').forEach((r) => {
            const rid = r.dataset.id!;
            if (rid !== rowDragId && sel[rid]) r.classList.add('drag-buddy');
          });
        }
      });
      row.addEventListener('dragover', (e) => {
        if (!rowDragId) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        // 拖拽行/buddy 行不作为 drop 目标
        if (row.classList.contains('dragging') || row.classList.contains('drag-buddy')) return;
        listEl
          .querySelectorAll('.config-row.drop-above,.config-row.drop-below')
          .forEach((el) => el.classList.remove('drop-above', 'drop-below'));
        const rect = row.getBoundingClientRect();
        const above = e.clientY < rect.top + rect.height / 2;
        row.classList.add(above ? 'drop-above' : 'drop-below');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dragId = rowDragId;
        rowDragId = null;
        if (!dragId || !row.dataset.id || row.dataset.id === dragId) return;
        const targetId = row.dataset.id;
        const rect = row.getBoundingClientRect();
        const insertBefore = e.clientY < rect.top + rect.height / 2;
        // 多选：拖拽行选中且有其他选中 → 移动所有选中；否则只移动拖拽行
        const sel = store.getState().ui.editSelectedIds;
        const otherSelected = Object.keys(sel).filter((id) => sel[id] && id !== dragId);
        const idsToMove = sel[dragId] && otherSelected.length > 0 ? Object.keys(sel).filter((id) => sel[id]) : [dragId];
        const moveSet = new Set(idsToMove);
        // 从 DOM 读取该组当前渲染顺序作为基线
        const tbody = row.closest('tbody');
        if (!tbody) return;
        const baseIds = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-id]'))
          .map((tr) => tr.dataset.id!)
          .filter((id) => !moveSet.has(id));
        let idx = baseIds.indexOf(targetId);
        if (idx < 0) idx = baseIds.length;
        if (!insertBefore) idx++;
        baseIds.splice(idx, 0, ...idsToMove);
        // 写回 configOrder[type] 并切到 custom 排序；多选时清空选区
        const st = store.getState();
        const metaMap = selectActivityMetaMap(st);
        const cfg = st.configs[dragId];
        if (!cfg) return;
        const type = getActivityType(cfg, metaMap);
        const ui = st.settings.uiSettings;
        store.dispatch({
          type: 'SETTINGS_PATCH',
          payload: { uiSettings: { ...ui, configOrder: { ...ui.configOrder, [type]: baseIds } } },
        });
        if (idsToMove.length > 1) {
          store.dispatch({ type: 'UI_PATCH', payload: { editSelectedIds: {} } });
        }
        if (st.ui.listSort !== 'custom') {
          store.dispatch({ type: 'UI_PATCH', payload: { listSort: 'custom' } });
        }
      });
      row.addEventListener('dragend', () => {
        rowDragId = null;
        listEl
          .querySelectorAll('.config-row.dragging,.config-row.drag-buddy,.config-row.drop-above,.config-row.drop-below')
          .forEach((el) => el.classList.remove('dragging', 'drag-buddy', 'drop-above', 'drop-below'));
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
    const draftMarkerText = isDirty(draft, config) ? ' ● 未保存' : '';
    const metaMap = selectActivityMetaMap(state);
    // 合并视图：draft 覆盖 committed（preview/结果区用，不改 committed）
    const merged = { ...config, ...(draft ?? {}) } as Config;
    const recurVal = merged.recurrenceValue;
    const startVal = merged.scheduleStartDate;
    const cycleCountVal = endDateToCycleCount(startVal, merged.scheduleEndDate, recurVal);
    const dur = parseDuration(parseInt(merged.duration, 10) || 0);
    const mondayHintStyle = needsMonday(recurVal) ? 'color:var(--color-warning);' : 'display:none;';

    const enabledVal = merged.enabled === '1';
    const barColor = state.settings.uiSettings.barColors[config.id] ?? '';
    const titleBg = titleBarBackground(barColor);
    let html = `<div class="form-title-bar" id="formTitleBar"${titleBg ? ` style="background:${titleBg};"` : ''}>
      <div class="title-left">
        <label class="switch-toggle"><input type="checkbox" id="enabledToggle" ${enabledVal ? 'checked' : ''}><span class="switch-slider"></span></label>
        <span id="enabledLabel" style="color:${enabledVal ? 'var(--color-success)' : 'var(--color-danger)'};font-weight:${enabledVal ? '600' : '400'};font-size:13px;">${enabledVal ? '已启用' : '已停用'}</span>
        <div class="title-text">${escapeHtml(getActivityName(config, metaMap))}<span style="color:var(--color-text-tertiary);font-size:12px;">（${escapeHtml(config.activityKey || '未命名')}）</span><span id="draftMarker" style="color:var(--color-warning);font-size:12px;">${draftMarkerText}</span></div>
      </div>
      <div class="title-right">
        <div style="position:relative;"><button type="button" id="colorBtn" class="color-btn" style="background:${colorBtnBackground(barColor)};" title="活动颜色">🎨</button><div id="colorDropdown" class="color-dropdown"></div></div>
        <button class="btn btn-success btn-sm" id="saveBtn">💾 保存</button>
        <button class="btn btn-secondary btn-sm" id="copyBtn">复制</button>
        <button class="btn btn-danger btn-sm" id="delBtn">删除</button>
        <button class="btn btn-secondary btn-sm" id="cancelBtn">取消</button>
        <button class="btn btn-secondary btn-sm" id="exportBtn">导出</button>
      </div>
    </div>`;

    html += '<div class="edit-grid">';
    // ===== 左列：基础信息 =====
    html += '<div class="edit-col">';
    // activityKey 从已注册的 activityMeta 中搜索选择（不再手填）
    html += `<div class="form-group"><label>活动Key <span style="color:var(--color-danger)">*</span></label><div class="combobox" id="activityKeyCombo"><input type="text" id="activityKeySearch" value="${escapeHtml(merged.activityKey)}" placeholder="搜索或选择活动 Key" autocomplete="off"><div class="combobox-list" id="activityKeyList"></div></div><div class="hint">从「活动管理」页签注册的活动 Key 中选择</div></div>`;
    // 依赖/互斥（派生 readonly，空数组/空串不显示 []）
    const depVal = (draft?.dependency ?? config.dependency) || '';
    const mutexRaw = draft?.mutex ?? config.mutex;
    const mutexVal = !mutexRaw || mutexRaw === '[]' ? '' : mutexRaw;
    html += `<div class="form-group"><label>依赖活动</label><input value="${escapeHtml(depVal)}" readonly style="background:#f5f5f5;"></div>`;
    html += `<div class="form-group"><label>互斥活动</label><input value="${escapeHtml(mutexVal)}" readonly style="background:#f5f5f5;"></div>`;
    // 活动描述（只读，跟随 activityKey 从 activityMeta 读取；在「活动管理」页签编辑）
    // 注：活动名称不在配置表单显示——标题栏已展示
    const meta = metaMap[config.activityKey];
    html += `<div class="form-group"><label>活动描述</label><input id="activityDescDisplay" value="${escapeHtml(meta?.activityDescription ?? '')}" readonly style="background:#f5f5f5;"><div class="hint">在「活动管理」页签编辑</div></div>`;
    html += `<div class="form-group"><label>活动类型</label><input value="${escapeHtml(meta?.activityType ?? 'default')}" readonly style="background:#f5f5f5;"><div class="hint">在「活动类型」页签中拖动活动 Key 改变归属</div></div>`;
    // 皮肤配置：逗号分隔输入（底层存 JSON 数组兼容 v1 CSV，UI 无需 []）
    const skinDisplay = parseSkinList(draft?.skin ?? config.skin).join(',');
    html += `<div class="form-group"><label>皮肤配置</label><input id="skinInput" value="${escapeHtml(skinDisplay)}" placeholder="如 CCD01,CCD02"><div class="hint">逗号分隔，无需 []</div></div>`;
    html += '<div class="form-group"><label>业务参数（params）</label><div id="paramsHost"></div></div>';
    html += '<div class="form-group"><label>玩家条件（segments）</label><div id="segmentsHost"></div></div>';
    html += '</div>';
    // ===== 右列：排期 =====
    html += '<div class="edit-col">';
    html += '<div class="form-group"><label>循环规则</label><div id="recurrenceWizardHost"></div></div>';
    html += `<div class="form-group"><label>持续时间</label><div class="dur-row"><div><label class="mini-label">天</label><input type="number" id="durDays" min="0" value="${dur.days}"></div><div><label class="mini-label">时</label><input type="number" id="durHours" min="0" value="${dur.hours}"></div><div><label class="mini-label">分</label><input type="number" id="durMinutes" min="0" value="${dur.minutes}"></div><div><label class="mini-label">总计(秒)</label><div id="durTotal" class="dur-total">${escapeHtml(merged.duration)}</div></div></div></div>`;
    html += `<div class="form-row"><div class="form-group"><label>开始日期 <span style="color:var(--color-danger)">*</span></label><input type="date" data-field="scheduleStartDate" value="${escapeHtml(startVal)}"><div id="startDateHint" class="hint" style="${mondayHintStyle}">每周/双周循环要求开始日期为周一（保存时自动校正）</div></div><div class="form-group"><label>循环次数</label><input type="number" id="cycleCount" min="1" placeholder="留空=无限循环" value="${escapeHtml(cycleCountVal)}"><div id="cycleEndPreview" class="hint"></div></div></div>`;
    html += `<div class="form-group"><label>开启时间</label><input type="time" data-field="startTime" value="${escapeHtml(merged.startTime)}"></div>`;
    html += '</div>';
    html += '</div>';

    // 底部：可折叠「配置详情与实际结果」区
    html += `<div class="schedule-collapse"><div class="schedule-collapse-header" id="scheduleCollapseHeader"><span id="scheduleCollapseIcon">▼</span> 配置详情与实际结果</div><div class="schedule-collapse-body" id="scheduleCollapseBody"><div id="actualScheduleResult" class="as-grid"></div></div></div>`;

    formEl.innerHTML = html;

    // 字段编辑 → 写草稿（input 事件实时写，不碰 committed，不入栈）
    formEl.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const field = input.dataset.field as keyof Config;
        store.dispatch({ type: 'DRAFT_EDIT', payload: { field, value: input.value } });
      });
    });

    // 皮肤配置：逗号分隔存储（彻底无 []，CSV 列含逗号时自动引号包裹）
    const skinInput = formEl.querySelector<HTMLInputElement>('#skinInput');
    skinInput?.addEventListener('change', () => {
      const list = skinInput.value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length);
      store.dispatch({ type: 'DRAFT_EDIT', payload: { field: 'skin', value: list.join(',') } });
    });

    // activityKey 搜索选择（combobox）：从已注册 activityMeta 过滤，点选写入草稿
    const akSearch = formEl.querySelector<HTMLInputElement>('#activityKeySearch');
    const akList = formEl.querySelector<HTMLElement>('#activityKeyList');
    const akCombo = formEl.querySelector<HTMLElement>('#activityKeyCombo');
    const refreshAkList = (filter: string) => {
      if (!akList) return;
      const keys = store.getState().settings.activityMeta.map((m) => m.activityKey);
      const f = filter.toLowerCase().trim();
      const matches = keys.filter((k) => !f || k.toLowerCase().includes(f)).sort().slice(0, 50);
      akList.innerHTML = matches.length
        ? matches
            .map((k) => `<div class="combobox-item" data-key="${escapeHtml(k)}">${escapeHtml(k)}</div>`)
            .join('')
        : '<div class="combobox-empty">无匹配活动 Key</div>';
    };
    akSearch?.addEventListener('focus', () => {
      refreshAkList(akSearch.value);
      akList?.classList.add('open');
    });
    akSearch?.addEventListener('input', () => {
      store.dispatch({ type: 'DRAFT_EDIT', payload: { field: 'activityKey', value: akSearch.value } });
      refreshAkList(akSearch.value);
      akList?.classList.add('open');
    });
    // mousedown（而非 click）防止 input 先失焦导致 list 消失
    akList?.addEventListener('mousedown', (e) => {
      const item = (e.target as HTMLElement).closest('.combobox-item') as HTMLElement | null;
      if (!item) return;
      e.preventDefault();
      const k = item.dataset.key!;
      if (akSearch) akSearch.value = k;
      store.dispatch({ type: 'DRAFT_EDIT', payload: { field: 'activityKey', value: k } });
      akList.classList.remove('open');
    });
    if (akDocClickHandler) document.removeEventListener('click', akDocClickHandler);
    akDocClickHandler = (e: MouseEvent) => {
      if (akCombo && !akCombo.contains(e.target as Node)) akList?.classList.remove('open');
    };
    document.addEventListener('click', akDocClickHandler);

    // 启用开关 → draft.enabled（'1'/'0'）+ label 实时更新
    const enabledToggle = formEl.querySelector<HTMLInputElement>('#enabledToggle');
    const enabledLabel = formEl.querySelector<HTMLElement>('#enabledLabel');
    enabledToggle?.addEventListener('change', () => {
      const on = enabledToggle.checked;
      store.dispatch({ type: 'DRAFT_EDIT', payload: { field: 'enabled', value: on ? '1' : '0' } });
      if (enabledLabel) {
        enabledLabel.textContent = on ? '已启用' : '已停用';
        enabledLabel.style.color = on ? 'var(--color-success)' : 'var(--color-danger)';
        enabledLabel.style.fontWeight = on ? '600' : '400';
      }
    });

    // activityName / activityDescription 为只读跟随（在「活动管理」页签编辑），此处无编辑绑定

    // 颜色选择器：渲染色板 + 下拉切换 + 选中即时落盘（SETTINGS_PATCH barColors，不入 history）
    const colorBtn = formEl.querySelector<HTMLElement>('#colorBtn');
    const colorDropdown = formEl.querySelector<HTMLElement>('#colorDropdown');
    if (colorBtn && colorDropdown) {
      const selected = barColor;
      const cells = TL_COLOR_PALETTE.flat()
        .map(
          (c) =>
            `<div class="color-cell${c.toLowerCase() === selected.toLowerCase() ? ' selected' : ''}" data-color="${c}" style="background:${c};"></div>`,
        )
        .join('');
      colorDropdown.innerHTML = `<div class="color-grid">${cells}</div><div class="color-custom-row"><input type="color" id="customColorInput" value="${selected || '#4472C4'}"><span>自定义</span></div>`;
      colorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        colorDropdown.classList.toggle('open');
        // 边缘翻转（右侧/下方不足时翻转）
        const r = colorBtn.getBoundingClientRect();
        colorDropdown.style.left = r.right + 200 > window.innerWidth ? 'auto' : '0';
        colorDropdown.style.right = r.right + 200 > window.innerWidth ? '0' : 'auto';
        colorDropdown.style.top =
          r.bottom + 240 > window.innerHeight ? `-${240}px` : `${colorBtn.offsetHeight + 6}px`;
      });
      const pick = (color: string) => {
        const st = store.getState();
        const ui = st.settings.uiSettings;
        store.dispatch({
          type: 'SETTINGS_PATCH',
          payload: {
            uiSettings: { ...ui, barColors: { ...ui.barColors, [config.id]: color } },
          },
        });
        colorDropdown.classList.remove('open');
        colorBtn.style.background = colorBtnBackground(color);
        const tb = formEl.querySelector<HTMLElement>('#formTitleBar');
        const bg = titleBarBackground(color);
        if (tb) tb.style.background = bg || '';
      };
      colorDropdown.querySelectorAll<HTMLElement>('.color-cell').forEach((cell) => {
        cell.addEventListener('click', () => pick(cell.dataset.color ?? ''));
      });
      colorDropdown.querySelector<HTMLInputElement>('#customColorInput')?.addEventListener('change', (e) => {
        pick((e.target as HTMLInputElement).value);
      });
      // 点击外部关闭（重渲染前移除旧 handler）
      if (docClickHandler) document.removeEventListener('click', docClickHandler);
      docClickHandler = (ev: MouseEvent) => {
        const t = ev.target as Node;
        if (!colorBtn.contains(t) && !colorDropdown.contains(t)) {
          colorDropdown.classList.remove('open');
        }
      };
      document.addEventListener('click', docClickHandler);
    }

    // duration 天/时/分 → 合并秒数 → 草稿；超循环周期长度 alert 不写入（v1 保真）
    const durDays = formEl.querySelector<HTMLInputElement>('#durDays');
    const durHours = formEl.querySelector<HTMLInputElement>('#durHours');
    const durMinutes = formEl.querySelector<HTMLInputElement>('#durMinutes');
    const durTotal = formEl.querySelector<HTMLElement>('#durTotal');
    const handleDur = () => {
      const secs = mergeDuration(
        Number(durDays?.value),
        Number(durHours?.value),
        Number(durMinutes?.value),
      );
      const st = store.getState();
      const rv = st.editor.draft?.recurrenceValue ?? config.recurrenceValue;
      const v = validateDurationAgainstPeriod(secs, rv);
      if (!v.ok) {
        alert(
          `持续时间（${secs}秒）超过循环周期长度（${Math.floor(v.maxSeconds / 86400)}天），未保存。请缩短持续时间或增加循环周期。`,
        );
        return;
      }
      if (durTotal) durTotal.textContent = String(secs);
      store.dispatch({ type: 'DRAFT_EDIT', payload: { field: 'duration', value: String(secs) } });
    };
    durDays?.addEventListener('change', handleDur);
    durHours?.addEventListener('change', handleDur);
    durMinutes?.addEventListener('change', handleDur);

    // 循环次数 → 派生 scheduleEndDate（scheduleEndDate 不再直接编辑，由循环次数驱动）
    const cycleCountInput = formEl.querySelector<HTMLInputElement>('#cycleCount');
    cycleCountInput?.addEventListener('input', () => {
      const cc = cycleCountInput.value.trim();
      const st = store.getState();
      const d = st.editor.draft;
      const start = d?.scheduleStartDate ?? config.scheduleStartDate;
      const rv = d?.recurrenceValue ?? config.recurrenceValue;
      const endDate = cc ? cycleCountToEndDateString(start, cc, rv) : '';
      store.dispatch({ type: 'DRAFT_EDIT', payload: { field: 'scheduleEndDate', value: endDate } });
    });

    // 折叠「配置详情与实际结果」
    formEl.querySelector('#scheduleCollapseHeader')?.addEventListener('click', () => {
      const body = formEl.querySelector('#scheduleCollapseBody');
      const icon = formEl.querySelector('#scheduleCollapseIcon');
      body?.classList.toggle('collapsed');
      if (icon) icon.textContent = body?.classList.contains('collapsed') ? '▶' : '▼';
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

    // params 多循环类型（变体数组，逗号裸拼接 {…},{…}；每变体共用同一 schema）
    const paramControllers: { ctrl: FieldController; label: string }[] = [];
    const paramsHost = formEl.querySelector<HTMLElement>('#paramsHost');
    if (paramsHost) {
      // 当前最新 variants（从 draft 读，保证多卡片并发编辑不互相覆盖）
      const curVariants = (): ParamVariant[] =>
        parseParamsVariants(store.getState().editor.draft?.params ?? config.params);
      const renderParams = (): void => {
        paramsHost.innerHTML = '';
        const st = store.getState();
        const schemaFields = resolveParamsSchema(st.settings.paramsSchemas, config.activityKey);
        if (schemaFields.length === 0) {
          // 无 Params Schema：提示去 Schema 编辑器定义
          const tip = document.createElement('div');
          tip.className = 'hint';
          tip.style.cssText = 'padding:10px;background:#f5f5f5;border-radius:4px;line-height:1.6;';
          tip.textContent = '该活动暂无 Params Schema。请在「Schema 编辑」页签定义参数结构后，再在此配置参数。';
          paramsHost.appendChild(tip);
          return;
        }
        const paramsStr = st.editor.draft?.params ?? config.params;
        const variants = parseParamsVariants(paramsStr);
        paramControllers.length = 0;
        // 写回整个 variants 到 draft.params（新增/删除/字段编辑统一入口）
        const commit = (next: ParamVariant[]): void => {
          store.dispatch({ type: 'DRAFT_EDIT', payload: { field: 'params', value: serializeParamsVariants(next) } });
        };

        variants.forEach((variant, vi) => {
          const card = document.createElement('div');
          card.style.cssText =
            'border:1px solid var(--color-border);border-radius:4px;padding:8px 10px;margin-bottom:8px;background:#fafafa;';
          const head = document.createElement('div');
          head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';
          const title = document.createElement('span');
          title.style.cssText = 'font-size:13px;font-weight:600;color:var(--color-primary);';
          title.textContent = `循环类型 ${vi + 1}`;
          const delBtn = document.createElement('button');
          delBtn.className = 'btn btn-danger btn-sm';
          delBtn.textContent = '× 删除';
          delBtn.addEventListener('click', () => {
            const cur = curVariants();
            cur.splice(vi, 1);
            commit(cur);
            renderParams();
          });
          head.appendChild(title);
          head.appendChild(delBtn);
          card.appendChild(head);

          for (const sf of schemaFields) {
            const ft = getFieldType(sf.fieldType) ?? getFieldType('text');
            const wrap = document.createElement('div');
            wrap.style.cssText = 'margin-bottom:6px;';
            const lbl = document.createElement('label');
            lbl.textContent = `${sf.key}${sf.required ? ' *' : ''}${ft ? `（${ft.name}）` : ''}`;
            lbl.style.cssText = 'display:block;font-size:12px;margin-bottom:2px;';
            wrap.appendChild(lbl);
            if (!ft) {
              card.appendChild(wrap);
              continue; // 理论不发生（基础类型均已注册）
            }
            const ctrl = ft.create({
              value: variant[sf.key] ?? sf.default ?? ft.defaultValue(),
              fieldDef: sf as unknown as FieldDef,
              onChange: (val) => {
                const cur = curVariants();
                let target = cur[vi];
                if (!target) {
                  target = {};
                  cur[vi] = target;
                }
                target[sf.key] = val;
                commit(cur);
              },
            });
            paramControllers.push({ ctrl, label: `循环类型 ${vi + 1} · ${sf.key}` });
            const el = ctrl.getElement();
            // checkbox 保持原生尺寸；其余类型宽度铺满
            if (sf.fieldType !== 'boolean') {
              el.style.cssText = 'width:100%;padding:4px;border:1px solid var(--color-border);border-radius:3px;';
            }
            wrap.appendChild(el);
            card.appendChild(wrap);
          }
          paramsHost.appendChild(card);
        });

        // 底部：新增循环类型
        const addBtn = document.createElement('button');
        addBtn.className = 'btn btn-primary btn-sm';
        addBtn.textContent = '+ 新增循环类型';
        addBtn.addEventListener('click', () => {
          const cur = curVariants();
          cur.push({});
          commit(cur);
          renderParams();
        });
        paramsHost.appendChild(addBtn);
      };
      renderParams();
    }

    // segments 可视化构建器（从 config/draft.segments 解析树，编辑写 draft.segments）
    const segmentsHost = formEl.querySelector<HTMLElement>('#segmentsHost');
    if (segmentsHost) {
      const draftNow = store.getState().editor.draft;
      const segVal = draftNow?.segments ?? config.segments;
      const builder = createSegmentBuilder({
        value: segVal,
        segmentKeys: store.getState().settings.segmentKeys,
        onChange: (v) => store.dispatch({ type: 'DRAFT_EDIT', payload: { field: 'segments', value: v } }),
      });
      segmentsHost.appendChild(builder.getElement());
    }

    // 初始渲染 cycleEndPreview + 折叠结果区（draft 变化时由订阅刷新）
    updateCycleEndPreview();
    renderActualSchedule();

    formEl.querySelector('#cancelBtn')?.addEventListener('click', () => {
      store.dispatch({ type: 'DRAFT_RESET' });
      renderForm();
    });

    formEl.querySelector('#saveBtn')?.addEventListener('click', () => {
      // 保存 = committed + 所有未应用草稿；dependency/mutex 从 settings 反查（派生字段）
      const draftNow = store.getState().editor.draft ?? {};
      const st = store.getState().settings;
      const activityKey = draftNow.activityKey ?? config.activityKey;
      // 校验 activityKey 非空（v1 保真）
      if (!activityKey || !activityKey.trim()) {
        alert('活动Key不能为空，请填写后再保存');
        return;
      }
      // params 按 fieldType 校验（所有循环类型 × 所有字段）：required 空值 / 类型不匹配 → 阻断保存
      const paramErrs: string[] = [];
      for (const { ctrl, label } of paramControllers) {
        for (const e of ctrl.validate()) paramErrs.push(`[${label}] ${e.message}`);
      }
      if (paramErrs.length) {
        alert('参数校验未通过，请修正后再保存：\n' + paramErrs.join('\n'));
        return;
      }
      const dep = st.dependencies
        .filter((d) => d.child === activityKey)
        .map((d) => d.parent)
        .join(',');
      const mutexArr = st.mutexGroups.filter((g) => g.activities.includes(activityKey)).map((g) => g.id);
      const next: Config = {
        ...config,
        ...draftNow,
        dependency: dep,
        mutex: mutexArr.length > 0 ? JSON.stringify(mutexArr) : '',
      } as Config;
      // 保存前跑 normalizer（周一校正等自动改值，非阻断）
      const { config: normalized, messages } = runNormalizers(next);
      if (messages.length > 0) {
        alert(messages.join('\n'));
      }
      store.dispatch({ type: 'CONFIG_SAVE', payload: normalized });
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
      downloadCSV('schedule_v2.csv', encodeConfigs(selectConfigsArray(store.getState())));
    });
  }

  // ---- 表单派生预览：cycleEndPreview + 折叠结果区（draft 变化时刷新）----
  function currentMerged(): Config | null {    const st = store.getState();
    const id = st.ui.selectedConfigId;
    const cfg = id ? st.configs[id] ?? null : null;
    if (!cfg) return null;
    return { ...cfg, ...(st.editor.draft ?? {}) } as Config;
  }

  // 循环次数下方：最后结束时间预览（展开 recurrence 找第 N 次开启日 + duration）
  function updateCycleEndPreview(): void {
    const el = formEl.querySelector('#cycleEndPreview');
    if (!el) return;
    const cfg = currentMerged();
    if (!cfg) return;
    const cc = endDateToCycleCount(cfg.scheduleStartDate, cfg.scheduleEndDate, cfg.recurrenceValue);
    if (cc && cfg.scheduleStartDate && cfg.startTime) {
      const durSec = parseInt(cfg.duration, 10) || 0;
      let rv: number[] = [1];
      try {
        const parsed = JSON.parse(cfg.recurrenceValue || '[1]');
        if (Array.isArray(parsed)) rv = parsed;
      } catch {
        // 回退 [1]
      }
      const count = parseInt(cc, 10);
      let found = 0;
      let lastDate: Date | null = null;
      for (let d = 1; d <= 3650 && found < count; d++) {
        if (rv[(d - 1) % rv.length] === 1) {
          found++;
          if (found === count) {
            lastDate = new Date(cfg.scheduleStartDate);
            lastDate.setDate(lastDate.getDate() + (d - 1));
          }
        }
      }
      if (lastDate) {
        const parts = cfg.startTime.split(':').map(Number);
        lastDate.setHours(parts[0] ?? 0, parts[1] ?? 0, 0, 0);
        const end = new Date(lastDate.getTime() + durSec * 1000);
        el.innerHTML = `<span style="color:var(--color-success);">结束时间：${fmtDate(end)}</span>`;
      } else {
        el.innerHTML = '';
      }
    } else if (!cc && cfg.scheduleStartDate && cfg.startTime) {
      el.innerHTML = '<span style="color:var(--color-text-tertiary);">无限循环</span>';
    } else {
      el.innerHTML = '';
    }
  }

  // 折叠结果区：左=配置详情 10 行，右=前 5 期表格（v1 renderActualSchedule 保真）
  function renderActualSchedule(): void {
    const el = formEl.querySelector('#actualScheduleResult');
    if (!el) return;
    const cfg = currentMerged();
    if (!cfg) return;
    if (!cfg.scheduleStartDate) {
      el.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--color-text-tertiary);">请设置开始日期后查看结果</div>';
      return;
    }
    const st = store.getState();
    const metaMap = selectActivityMetaMap(st);
    const schedules = calculateActualSchedules(cfg);
    const durationHours = (parseInt(cfg.duration, 10) || 86400) / 3600;
    const startTime = cfg.startTime || '10:00';
    let rv: number[] = [1];
    try {
      const parsed = JSON.parse(cfg.recurrenceValue || '[1]');
      if (Array.isArray(parsed)) rv = parsed;
    } catch {
      // 回退
    }
    const row = (label: string, val: string) =>
      `<div style="line-height:1.8;"><span style="color:var(--color-text-tertiary);">${escapeHtml(label)}</span> ${escapeHtml(val)}</div>`;
    const fmtParams = (raw: string): string => {
      if (!raw) return '无参数';
      const variants = parseParamsVariants(raw);
      if (variants.length === 0) return raw + '（非法 JSON）';
      return serializeParamsVariants(variants);
    };
    const left = `<div class="as-left">
      <div style="color:var(--color-primary);font-weight:600;margin-bottom:4px;">配置详情</div>
      ${row('ID:', cfg.id)}
      ${row('Key:', cfg.activityKey || '-')}
      ${row('依赖:', cfg.dependency || '-')}
      ${row('互斥:', cfg.mutex || '-')}
      ${row('开始日期:', cfg.scheduleStartDate)}
      ${row('开始时间:', startTime)}
      ${row('结束:', cfg.scheduleEndDate || '无限循环')}
      ${row('规则:', '[' + rv.join(',') + ']')}
      ${row('玩家条件:', cfg.segments || '无条件（全体可见）')}
      ${row('参数:', fmtParams(cfg.params))}
      ${row('持续:', durationHours + 'h')}
      ${row('类型:', getActivityType(cfg, metaMap))}
    </div>`;
    const display = schedules.slice(0, 5);
    const right = `<div class="as-right">
      <div style="color:var(--color-text-secondary);margin-bottom:6px;"><b>前${display.length}期</b>（共${schedules.length}期）</div>
      ${display.length === 0
        ? '<div style="text-align:center;color:var(--color-text-tertiary);">请设置开始日期后查看结果</div>'
        : `<table class="as-table"><thead><tr><th>期数</th><th>开启</th><th>结束</th></tr></thead><tbody>
          ${display
            .map(
              (p) =>
                `<tr><td>第${p.period}期</td><td style="color:var(--color-success);">${fmtDate(new Date(p.openTime))}</td><td style="color:var(--color-danger);">${fmtDate(new Date(p.closeTime))}</td></tr>`,
            )
            .join('')}
        </tbody></table>`}
    </div>`;
    el.innerHTML = left + right;
  }

  renderList();
  renderForm();

  // ---- tab 路由（config / timeline）----
  const navEl = root.querySelector('#navTabs') as HTMLElement;
  const configTabEl = root.querySelector('#configTab') as HTMLElement;
  const timelineTabEl = root.querySelector('#timelineTab') as HTMLElement;
  const schemaTabEl = root.querySelector('#schemaTab') as HTMLElement;
  const dependencyTabEl = root.querySelector('#dependencyTab') as HTMLElement;
  const mutexTabEl = root.querySelector('#mutexTab') as HTMLElement;
  const activityMgmtTabEl = root.querySelector('#activityMgmtTab') as HTMLElement;
  const segmentTabEl = root.querySelector('#segmentTab') as HTMLElement;

  function syncTabs(): void {
    const active = store.getState().ui.activeTab;
    navEl.querySelectorAll<HTMLElement>('.nav-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === active);
    });
    configTabEl.style.display = active === 'config' ? '' : 'none';
    timelineTabEl.style.display = active === 'timeline' ? '' : 'none';
    schemaTabEl.style.display = active === 'schema' ? '' : 'none';
    dependencyTabEl.style.display = active === 'dependency' ? '' : 'none';
    mutexTabEl.style.display = active === 'mutex' ? '' : 'none';
    activityMgmtTabEl.style.display = active === 'activityMgmt' ? '' : 'none';
    segmentTabEl.style.display = active === 'segment' ? '' : 'none';
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
  renderDependencyTab(store, dependencyTabEl);
  renderMutexTab(store, mutexTabEl);
  renderActivityMgmtTab(store, activityMgmtTabEl);
  renderSegmentTab(store, segmentTabEl);

  // 订阅：configsArray 变 → 列表刷新；selectedConfigId 变 → 表单刷新
  store.subscribe(selectConfigsArray, () => renderList());
  store.subscribe((s) => s.ui.listSearch, renderList);
  store.subscribe((s) => s.ui.listSort, renderList);
  store.subscribe((s) => s.settings.uiSettings.typeGroupCollapsed, renderList);
  // configOrder 变 → custom 模式下行序刷新（拖拽 drop 后；同 type 顺序写回）
  store.subscribe((s) => s.settings.uiSettings.configOrder, renderList);
  store.subscribe((s) => s.ui.loadedFile, renderList);
  // editSelectedIds 变 → custom 模式行选中态/批量按钮计数刷新
  store.subscribe((s) => s.ui.editSelectedIds, renderList);
  // activityMeta 变 → 列表 name/分组刷新 + 表单折叠结果区刷新（不改表单 input 避免失焦）
  store.subscribe((s) => s.settings.activityMeta, () => {
    renderList();
    renderActualSchedule();
  });
  store.subscribe((s) => s.ui.selectedConfigId, () => renderForm());
  store.subscribe((s) => s.ui.activeTab, syncTabs);
  // draft 变 → 只更新 marker（不重渲染表单，避免失焦）
  store.subscribe((s) => s.editor.draft, () => {
    const st = store.getState();
    const id = st.ui.selectedConfigId;
    const cfg = id ? st.configs[id] ?? null : null;
    const m = root.querySelector('#draftMarker');
    if (m) m.textContent = cfg && isDirty(st.editor.draft, cfg) ? ' ● 未保存' : '';
    // 周一 hint 随 recurrence 模式（wizard 切换）实时显隐
    const h = root.querySelector('#startDateHint') as HTMLElement | null;
    if (h) {
      const st = store.getState();
      const id = st.ui.selectedConfigId;
      const cfg = id ? st.configs[id] : null;
      const rv = st.editor.draft?.recurrenceValue ?? cfg?.recurrenceValue ?? '';
      h.style.display = needsMonday(rv) ? '' : 'none';
    }
    // cycleEndPreview + 折叠结果区随 draft 实时刷新（duration/日期/循环次数/循环规则变更）
    updateCycleEndPreview();
    renderActualSchedule();
    // activityKey 变 → 刷新活动描述只读（从 activityMeta 读取，跟随 activityKey 联动）
    const descDisp = root.querySelector<HTMLInputElement>('#activityDescDisplay');
    if (descDisp) {
      const cfg = currentMerged();
      const mm = selectActivityMetaMap(store.getState());
      descDisp.value = cfg ? mm[cfg.activityKey]?.activityDescription ?? '' : '';
    }
  });
  // history 状态变化 → status 刷新
  store.subscribeHistory(() => renderList());
}
