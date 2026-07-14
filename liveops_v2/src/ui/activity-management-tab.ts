/**
 * ui/activity-management-tab.ts — 活动管理页签
 *
 * 管理 activityKey 注册表（即 activityMeta），每条记录含：活动 Key + 活动名称 + 所属类型。
 * 上半部：activityKey 注册表（注册/改名/选类型/删除）
 * 下半部：活动类型管理（新增/改名/删除，仅「默认」不可删/不可改名）
 *
 * 配置管理页签的 activityKey 不再手填，从此注册表中选择（带搜索）。
 * 数据模型：activityMeta 按 activityKey 共享，一条 meta 对应一个活动 Key。
 */

import type { Store } from '@/core/store';
import { selectConfigsArray } from '@/core/selectors';

const BUILTIN_TYPES = ['default', 'festival', 'gift', 'feature'];
const BUILTIN_TYPE_NAMES: Record<string, string> = {
  default: '默认',
  festival: '活动',
  gift: '礼包',
  feature: '功能',
};

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderActivityMgmtTab(store: Store, host: HTMLElement): void {
  /** 收集所有活动类型（typeOrder 优先 + 内置 + meta 补充，去重保序） */
  function getAllTypes(): string[] {
    const st = store.getState();
    const order = st.settings.uiSettings.activityTypeOrder;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of order) if (!seen.has(t)) { seen.add(t); out.push(t); }
    for (const t of BUILTIN_TYPES) if (!seen.has(t)) { seen.add(t); out.push(t); }
    for (const m of st.settings.activityMeta) {
      if (m.activityType && !seen.has(m.activityType)) { seen.add(m.activityType); out.push(m.activityType); }
    }
    return out;
  }

  function updateMeta(key: string, patch: Partial<{ activityName: string; activityType: string; activityDescription: string }>): void {
    const st = store.getState();
    const metas = st.settings.activityMeta.map((m) => (m.activityKey === key ? { ...m, ...patch } : m));
    store.dispatch({ type: 'SETTINGS_PATCH', payload: { activityMeta: metas } });
  }

  function render(): void {
    const state = store.getState();
    const metas = [...state.settings.activityMeta].sort((a, b) => a.activityKey.localeCompare(b.activityKey));
    const types = getAllTypes();
    const configsArr = selectConfigsArray(state);
    const keyUsedCount = new Map<string, number>();
    for (const c of configsArr) keyUsedCount.set(c.activityKey, (keyUsedCount.get(c.activityKey) ?? 0) + 1);

    const typeOpts = (cur: string) =>
      types
        .map((t) => `<option value="${escapeHtml(t)}"${t === cur ? ' selected' : ''}>${escapeHtml(BUILTIN_TYPE_NAMES[t] ?? t)}</option>`)
        .join('') + '<option value="__new__">+ 新增类型...</option>';

    // ---- 上半部：activityKey 注册表 ----
    let html =
      '<div class="am-toolbar"><button class="btn btn-primary btn-sm" id="amNewKeyBtn">+ 注册活动 Key</button>' +
      '<span class="am-hint">管理已注册的活动 Key、名称与所属类型（配置管理从此处选择 Key）</span></div>';
    html += '<table class="am-table"><thead><tr><th>活动 Key</th><th>活动名称</th><th>活动类型</th><th>引用数</th><th>操作</th></tr></thead><tbody>';
    for (const m of metas) {
      const cnt = keyUsedCount.get(m.activityKey) ?? 0;
      html += `<tr data-key="${escapeHtml(m.activityKey)}">` +
        `<td class="am-key">${escapeHtml(m.activityKey)}</td>` +
        `<td><input class="am-name" data-key="${escapeHtml(m.activityKey)}" value="${escapeHtml(m.activityName)}"></td>` +
        `<td><select class="am-type" data-key="${escapeHtml(m.activityKey)}">${typeOpts(m.activityType)}</select></td>` +
        `<td class="am-count">${cnt}</td>` +
        `<td><button class="btn btn-danger btn-sm am-del" data-key="${escapeHtml(m.activityKey)}">删除</button></td>` +
        `</tr>`;
    }
    if (metas.length === 0) {
      html += '<tr><td colspan="5" class="am-empty">尚未注册任何活动 Key，点击上方「注册活动 Key」</td></tr>';
    }
    html += '</tbody></table>';

    // ---- 下半部：活动类型管理（新增/改名/删除，仅 default 不可删/不可改名）----
    html += '<div class="am-section-title">活动类型管理</div>';
    html += '<div class="am-types">';
    for (const t of types) {
      const isDefault = t === 'default';
      const name = BUILTIN_TYPE_NAMES[t] ?? t;
      html += `<div class="am-type-row" data-type="${escapeHtml(t)}">` +
        `<input class="am-type-name" data-type="${escapeHtml(t)}" value="${escapeHtml(name)}"${isDefault ? ' disabled' : ''}>` +
        `<span class="am-type-label">${isDefault ? '默认（不可删/不可改名）' : ''}</span>` +
        (isDefault ? '' : `<button class="btn btn-danger btn-sm am-type-del" data-type="${escapeHtml(t)}">删除</button>`) +
        `</div>`;
    }
    html += '<button class="btn btn-secondary btn-sm" id="amNewTypeBtn" style="margin-top:8px;">+ 新增类型</button>';
    html += '</div>';

    host.innerHTML = html;
    bind();
  }

  function bind(): void {
    // 注册新 activityKey
    host.querySelector('#amNewKeyBtn')?.addEventListener('click', () => {
      const key = prompt('请输入活动 Key（如 daily_login）：');
      if (!key || !key.trim()) return;
      const k = key.trim();
      const st = store.getState();
      if (st.settings.activityMeta.some((m) => m.activityKey === k)) {
        alert('该 Key 已存在：' + k);
        return;
      }
      const name = prompt('活动名称（可留空）：') ?? '';
      const metas = [
        ...st.settings.activityMeta,
        { activityKey: k, activityName: name.trim(), activityType: 'default', activityDescription: '' },
      ];
      store.dispatch({ type: 'SETTINGS_PATCH', payload: { activityMeta: metas } });
    });

    // 改活动名称
    host.querySelectorAll<HTMLInputElement>('.am-name').forEach((inp) => {
      inp.addEventListener('change', () => updateMeta(inp.dataset.key!, { activityName: inp.value }));
    });

    // 选活动类型（含新增类型）
    host.querySelectorAll<HTMLSelectElement>('.am-type').forEach((sel) => {
      sel.addEventListener('change', () => {
        const v = sel.value;
        const key = sel.dataset.key!;
        if (v === '__new__') {
          const st = store.getState();
          sel.value = st.settings.activityMeta.find((m) => m.activityKey === key)?.activityType ?? 'default';
          const nk = prompt('请输入新活动类型的名称：');
          if (!nk || !nk.trim()) return;
          const name = nk.trim();
          if (st.settings.activityMeta.some((m) => m.activityType === name) || BUILTIN_TYPES.includes(name)) {
            alert('类型已存在：' + name);
            return;
          }
          const order = st.settings.uiSettings.activityTypeOrder;
          store.dispatch({
            type: 'SETTINGS_PATCH',
            payload: { uiSettings: { ...st.settings.uiSettings, activityTypeOrder: [...order, name] } },
          });
          updateMeta(key, { activityType: name });
          return;
        }
        updateMeta(key, { activityType: v });
      });
    });

    // 删除 activityKey（config 不受影响，仅丢元数据）
    host.querySelectorAll<HTMLElement>('.am-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key!;
        const cnt = selectConfigsArray(store.getState()).filter((c) => c.activityKey === key).length;
        const msg =
          cnt > 0
            ? `活动 Key "${key}" 被 ${cnt} 条配置引用，删除后这些配置仍保留 Key 但丢失名称/类型元数据。确定删除？`
            : `确定删除活动 Key "${key}"？`;
        if (!confirm(msg)) return;
        const st = store.getState();
        const metas = st.settings.activityMeta.filter((m) => m.activityKey !== key);
        store.dispatch({ type: 'SETTINGS_PATCH', payload: { activityMeta: metas } });
      });
    });

    // ---- 活动类型管理 ----
    host.querySelector('#amNewTypeBtn')?.addEventListener('click', () => {
      const k = prompt('请输入新活动类型的名称：');
      if (!k || !k.trim()) return;
      const name = k.trim();
      const st = store.getState();
      if (st.settings.activityMeta.some((m) => m.activityType === name) || BUILTIN_TYPES.includes(name)) {
        alert('类型已存在：' + name);
        return;
      }
      const order = st.settings.uiSettings.activityTypeOrder;
      store.dispatch({
        type: 'SETTINGS_PATCH',
        payload: { uiSettings: { ...st.settings.uiSettings, activityTypeOrder: [...order, name] } },
      });
    });

    // 类型改名（批量改 activityType 值 + activityTypeOrder）
    host.querySelectorAll<HTMLInputElement>('.am-type-name').forEach((inp) => {
      inp.addEventListener('change', () => {
        const old = inp.dataset.type!;
        const newName = inp.value.trim();
        if (!newName || newName === old) return;
        const st = store.getState();
        if (st.settings.activityMeta.some((m) => m.activityType === newName) || BUILTIN_TYPES.includes(newName)) {
          alert('类型名冲突：' + newName);
          return;
        }
        const metas = st.settings.activityMeta.map((m) =>
          m.activityType === old ? { ...m, activityType: newName } : m,
        );
        const order = st.settings.uiSettings.activityTypeOrder.map((t) => (t === old ? newName : t));
        store.dispatch({
          type: 'SETTINGS_PATCH',
          payload: { activityMeta: metas, uiSettings: { ...st.settings.uiSettings, activityTypeOrder: order } },
        });
      });
    });

    // 类型删除（非 default → 该类型下 Key 归 default）
    host.querySelectorAll<HTMLElement>('.am-type-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.type!;
        if (t === 'default') {
          alert('默认类型不能删除');
          return;
        }
        if (!confirm(`确定删除类型 "${BUILTIN_TYPE_NAMES[t] ?? t}" 吗？\n该类型下的活动 Key 将归入「默认」。`)) return;
        const st = store.getState();
        const metas = st.settings.activityMeta.map((m) =>
          m.activityType === t ? { ...m, activityType: 'default' } : m,
        );
        const order = st.settings.uiSettings.activityTypeOrder.filter((x) => x !== t);
        store.dispatch({
          type: 'SETTINGS_PATCH',
          payload: { activityMeta: metas, uiSettings: { ...st.settings.uiSettings, activityTypeOrder: order } },
        });
      });
    });
  }

  render();
  store.subscribe((s) => s.settings.activityMeta, render);
  store.subscribe((s) => s.settings.uiSettings.activityTypeOrder, render);
  store.subscribe(selectConfigsArray, render);
}
