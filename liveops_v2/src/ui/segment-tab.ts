/**
 * ui/segment-tab.ts — 玩家分群（segmentKey）管理页签
 *
 * 注册 segmentKey（玩家条件 key）+ 名称 + 两参数标签 + 说明。
 * 配置表单 segments 构建器从这里读可选 key。
 * 默认内置 5 种（userLevel/lifeTime/payAmount/version/item），可增删改。
 */

import type { Store } from '@/core/store';
import type { SegmentKeyDef } from '@/core/types';
import { selectSettings } from '@/core/selectors';

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderSegmentTab(store: Store, host: HTMLElement): void {
  function render(): void {
    const settings = selectSettings(store.getState());
    const keys = settings.segmentKeys;

    let html =
      '<div style="padding:20px;"><div class="section-title">玩家分群（segmentKey）管理</div>' +
      '<div style="font-size:12px;color:var(--color-text-tertiary);margin-bottom:12px;">注册玩家条件 key 及其两参数语义。配置表单的 segments 构建器从此处选择 key。</div>' +
      '<div class="am-toolbar"><button class="btn btn-primary btn-sm" id="segNewBtn">+ 注册 segmentKey</button></div>';

    html += '<table class="am-table"><thead><tr><th>segmentKey</th><th>名称</th><th>参数1标签</th><th>参数2标签</th><th>说明</th><th>操作</th></tr></thead><tbody>';
    for (const k of keys) {
      html += `<tr data-key="${escapeHtml(k.key)}">` +
        `<td><input class="seg-key" data-key="${escapeHtml(k.key)}" value="${escapeHtml(k.key)}" style="width:140px;padding:4px;border:1px solid var(--color-border);border-radius:3px;font-family:monospace;"></td>` +
        `<td><input class="seg-name" data-key="${escapeHtml(k.key)}" value="${escapeHtml(k.name)}" style="width:120px;padding:4px;border:1px solid var(--color-border);border-radius:3px;"></td>` +
        `<td><input class="seg-p1" data-key="${escapeHtml(k.key)}" value="${escapeHtml(k.param1Label)}" style="width:100px;padding:4px;border:1px solid var(--color-border);border-radius:3px;"></td>` +
        `<td><input class="seg-p2" data-key="${escapeHtml(k.key)}" value="${escapeHtml(k.param2Label)}" style="width:100px;padding:4px;border:1px solid var(--color-border);border-radius:3px;"></td>` +
        `<td><input class="seg-desc" data-key="${escapeHtml(k.key)}" value="${escapeHtml(k.description ?? '')}" style="width:180px;padding:4px;border:1px solid var(--color-border);border-radius:3px;"></td>` +
        `<td><button class="btn btn-danger btn-sm seg-del" data-key="${escapeHtml(k.key)}">删除</button></td>` +
        `</tr>`;
    }
    if (keys.length === 0) {
      html += '<tr><td colspan="6" class="am-empty">尚未注册任何 segmentKey</td></tr>';
    }
    html += '</tbody></table></div>';

    host.innerHTML = html;
    bind();
  }

  function commit(next: SegmentKeyDef[]): void {
    store.dispatch({ type: 'SETTINGS_PATCH', payload: { segmentKeys: next } });
  }

  function updateKey(oldKey: string, patch: Partial<SegmentKeyDef>): void {
    const st = store.getState();
    // 改 key 时需同步所有引用该 key 的 segments? segments 存表达式字符串，改 key 不自动迁移。
    // 此处仅改注册表；表达式中的旧 key 文本不变（用户自行同步）。
    const next = st.settings.segmentKeys.map((k) => (k.key === oldKey ? { ...k, ...patch } : k));
    commit(next);
  }

  function bind(): void {
    host.querySelector('#segNewBtn')?.addEventListener('click', () => {
      const key = prompt('请输入 segmentKey（如 vipLevel）：');
      if (!key || !key.trim()) return;
      const k = key.trim();
      const st = store.getState();
      if (st.settings.segmentKeys.some((x) => x.key === k)) {
        alert('该 segmentKey 已存在：' + k);
        return;
      }
      commit([
        ...st.settings.segmentKeys,
        { key: k, name: k, param1Label: '参数1', param2Label: '参数2', description: '' },
      ]);
    });

    host.querySelectorAll<HTMLInputElement>('.seg-key').forEach((inp) => {
      inp.addEventListener('change', () => {
        const old = inp.dataset.key!;
        const newKey = inp.value.trim();
        if (!newKey || newKey === old) return;
        const st = store.getState();
        if (st.settings.segmentKeys.some((x) => x.key === newKey)) {
          alert('segmentKey 冲突：' + newKey);
          return;
        }
        updateKey(old, { key: newKey });
      });
    });
    host.querySelectorAll<HTMLInputElement>('.seg-name').forEach((inp) => {
      inp.addEventListener('change', () => updateKey(inp.dataset.key!, { name: inp.value }));
    });
    host.querySelectorAll<HTMLInputElement>('.seg-p1').forEach((inp) => {
      inp.addEventListener('change', () => updateKey(inp.dataset.key!, { param1Label: inp.value }));
    });
    host.querySelectorAll<HTMLInputElement>('.seg-p2').forEach((inp) => {
      inp.addEventListener('change', () => updateKey(inp.dataset.key!, { param2Label: inp.value }));
    });
    host.querySelectorAll<HTMLInputElement>('.seg-desc').forEach((inp) => {
      inp.addEventListener('change', () => updateKey(inp.dataset.key!, { description: inp.value }));
    });
    host.querySelectorAll<HTMLElement>('.seg-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.key!;
        if (!confirm(`删除 segmentKey「${k}」？（已使用的 segments 表达式中的该 key 不会自动迁移）`)) return;
        const st = store.getState();
        commit(st.settings.segmentKeys.filter((x) => x.key !== k));
      });
    });
  }

  render();
  store.subscribe((s) => s.settings.segmentKeys, render);
}
