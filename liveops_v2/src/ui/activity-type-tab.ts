/**
 * ui/activity-type-tab.ts — 活动类型管理页签（v2 新增）
 *
 * 用户要求：把活动类型管理从配置表单移到独立页签。
 * - 类型卡片列表：每类型含名称 input（可改名，仅 default 不可删/不可改名）+ 删除按钮
 *   + 该类型下的 activityKey 列表
 * - 拖动 activityKey 到目标类型卡片 → 改该 activityKey 的 activityType（写 activityMeta）
 * - 新建类型（prompt）→ activityTypeOrder 追加
 * - 删除类型（非 default）→ 该类型下所有 activityKey 归入 default，activityTypeOrder 移除
 * - 重命名 = 批量改 activityType 值（所有该类型 meta + activityTypeOrder，冲突校验）
 *
 * 数据模型：activityType 存 activityMeta（按 activityKey 共享）。改归属影响所有同 key 配置。
 */

import type { Store } from '@/core/store';
import { selectConfigsArray, selectActivityMetaMap } from '@/core/selectors';

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

export function renderActivityTypeTab(store: Store, host: HTMLElement): void {
  let dragKey: string | null = null;

  function render(): void {
    const state = store.getState();
    const metas = state.settings.activityMeta;
    const configs = selectConfigsArray(state);
    const metaMap = selectActivityMetaMap(state);

    // 收集所有 activityType（typeOrder 优先，再补 meta/内置出现的）
    const typeOrder = state.settings.uiSettings.activityTypeOrder;
    const seen = new Set<string>();
    const types: string[] = [];
    for (const t of typeOrder) {
      if (!seen.has(t)) {
        seen.add(t);
        types.push(t);
      }
    }
    for (const m of metas) {
      if (m.activityType && !seen.has(m.activityType)) {
        seen.add(m.activityType);
        types.push(m.activityType);
      }
    }
    for (const t of BUILTIN_TYPES) {
      if (!seen.has(t)) {
        seen.add(t);
        types.push(t);
      }
    }

    // 按 activityType 分组 activityKey（去重，按 configs 首次出现顺序）
    const keysByType = new Map<string, string[]>();
    for (const t of types) keysByType.set(t, []);
    const keySeen = new Set<string>();
    for (const c of configs) {
      if (keySeen.has(c.activityKey)) continue;
      keySeen.add(c.activityKey);
      const t = metaMap[c.activityKey]?.activityType ?? 'default';
      if (!keysByType.has(t)) keysByType.set(t, []);
      keysByType.get(t)!.push(c.activityKey);
    }

    let html =
      '<div class="at-toolbar"><button class="btn btn-primary btn-sm" id="atNewBtn">+ 新建类型</button>' +
      '<span class="at-hint">拖动活动 Key 到目标类型卡片即可更改归属；仅「默认」类型不可删除/改名</span></div>';
    html += '<div class="at-cards">';
    for (const t of types) {
      const isDefault = t === 'default';
      const name = BUILTIN_TYPE_NAMES[t] ?? t;
      const keys = keysByType.get(t) ?? [];
      html += `<div class="at-card" data-type="${escapeHtml(t)}">`;
      html += `<div class="at-card-head"><input class="at-type-name" data-type="${escapeHtml(t)}" value="${escapeHtml(name)}"${isDefault ? ' disabled' : ''}><span class="at-count">${keys.length} 个 Key</span>`;
      if (!isDefault) {
        html += `<button class="btn btn-danger btn-sm at-del-btn" data-type="${escapeHtml(t)}">删除</button>`;
      }
      html += `</div>`;
      html += `<div class="at-key-zone" data-type="${escapeHtml(t)}">`;
      for (const k of keys) {
        html += `<div class="at-key" draggable="true" data-key="${escapeHtml(k)}">${escapeHtml(k)}</div>`;
      }
      if (keys.length === 0) {
        html += '<div class="at-key-empty">（拖入活动 Key）</div>';
      }
      html += `</div></div>`;
    }
    html += '</div>';
    host.innerHTML = html;
    bind();
  }

  function bind(): void {
    // 新建类型
    host.querySelector('#atNewBtn')?.addEventListener('click', () => {
      const k = prompt('请输入新活动类型的名称：');
      if (!k || !k.trim()) return;
      const name = k.trim();
      const st = store.getState();
      if (
        st.settings.activityMeta.some((m) => m.activityType === name) ||
        BUILTIN_TYPES.includes(name)
      ) {
        alert('该类型已存在：' + name);
        return;
      }
      const order = st.settings.uiSettings.activityTypeOrder;
      store.dispatch({
        type: 'SETTINGS_PATCH',
        payload: { uiSettings: { ...st.settings.uiSettings, activityTypeOrder: [...order, name] } },
      });
    });

    // 类型重命名（改 input → 批量改 activityType 值 + activityTypeOrder）
    host.querySelectorAll<HTMLInputElement>('.at-type-name').forEach((inp) => {
      inp.addEventListener('change', () => {
        const old = inp.dataset.type!;
        const newName = inp.value.trim();
        if (!newName || newName === old) return;
        const st = store.getState();
        if (
          st.settings.activityMeta.some((m) => m.activityType === newName) ||
          BUILTIN_TYPES.includes(newName)
        ) {
          alert('类型名冲突：' + newName);
          return;
        }
        const metas = st.settings.activityMeta.map((m) =>
          m.activityType === old ? { ...m, activityType: newName } : m,
        );
        const order = st.settings.uiSettings.activityTypeOrder.map((t) =>
          t === old ? newName : t,
        );
        store.dispatch({
          type: 'SETTINGS_PATCH',
          payload: {
            activityMeta: metas,
            uiSettings: { ...st.settings.uiSettings, activityTypeOrder: order },
          },
        });
      });
    });

    // 删除类型（default 不可删；该类型下 key 自动归 default）
    host.querySelectorAll<HTMLElement>('.at-del-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.type!;
        if (t === 'default') {
          alert('默认类型不能删除');
          return;
        }
        if (!confirm(`确定删除类型 "${BUILTIN_TYPE_NAMES[t] ?? t}" 吗？\n该类型下的活动 Key 将归入「默认」。`)) {
          return;
        }
        const st = store.getState();
        const metas = st.settings.activityMeta.map((m) =>
          m.activityType === t ? { ...m, activityType: 'default' } : m,
        );
        const order = st.settings.uiSettings.activityTypeOrder.filter((x) => x !== t);
        store.dispatch({
          type: 'SETTINGS_PATCH',
          payload: {
            activityMeta: metas,
            uiSettings: { ...st.settings.uiSettings, activityTypeOrder: order },
          },
        });
      });
    });

    // 拖拽 activityKey 到类型卡片 → 改 activityType
    host.querySelectorAll<HTMLElement>('.at-key[draggable="true"]').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        dragKey = el.dataset.key ?? null;
        if (!dragKey || !e.dataTransfer) return;
        e.dataTransfer.setData('text/plain', 'atkey:' + dragKey);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => {
        dragKey = null;
        host
          .querySelectorAll('.at-key.dragging,.at-key-zone.drop-hover')
          .forEach((x) => x.classList.remove('dragging', 'drop-hover'));
      });
    });
    host.querySelectorAll<HTMLElement>('.at-key-zone').forEach((zone) => {
      zone.addEventListener('dragover', (e) => {
        if (!dragKey) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        zone.classList.add('drop-hover');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('drop-hover'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drop-hover');
        const data = e.dataTransfer?.getData('text/plain') ?? '';
        if (!data.startsWith('atkey:')) return;
        const key = data.slice('atkey:'.length);
        const targetType = zone.dataset.type!;
        dragKey = null;
        const st = store.getState();
        const metas = st.settings.activityMeta;
        const idx = metas.findIndex((m) => m.activityKey === key);
        let nextMetas;
        if (idx >= 0) {
          if (metas[idx]?.activityType === targetType) return; // 同类型不动
          nextMetas = metas.map((m, i) => (i === idx ? { ...m, activityType: targetType } : m));
        } else {
          nextMetas = [
            ...metas,
            { activityKey: key, activityName: key, activityType: targetType, activityDescription: '' },
          ];
        }
        store.dispatch({ type: 'SETTINGS_PATCH', payload: { activityMeta: nextMetas } });
      });
    });
  }

  render();
  // activityMeta / activityTypeOrder / configs 变 → 重渲染
  store.subscribe((s) => s.settings.activityMeta, render);
  store.subscribe((s) => s.settings.uiSettings.activityTypeOrder, render);
  store.subscribe(selectConfigsArray, render);
}
