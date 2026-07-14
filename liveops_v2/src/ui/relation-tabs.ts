/**
 * ui/relation-tabs.ts — 依赖关系/互斥组 tab（继承 v1，迭代5b）
 *
 * 继承 v1 交互：依赖增删（修复 addDependency 无去重 bug）、互斥组增删改名/活动增删。
 * settings.dependencies / settings.mutexGroups 是唯一编辑真相源；Config.dependency/mutex
 * 是导出时派生列（编译阶段填充，本 tab 不写 Config）。
 */

import type { Store } from '@/core/store';
import { selectSettings } from '@/core/selectors';
import type { Dependency, MutexGroup } from '@/core/types';

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function newGroupId(): string {
  return 'group' + Date.now();
}

export function renderDependencyTab(store: Store, root: HTMLElement): void {
  function render(): void {
    const s = selectSettings(store.getState());
    const meta = s.activityMeta;
    const deps = s.dependencies;
    const parentOpts = meta.map((m) => `<option value="${escapeHtml(m.activityKey)}">${escapeHtml(m.activityName)} (${escapeHtml(m.activityKey)})</option>`).join('');

    root.innerHTML = `
      <div style="padding:20px;">
        <div class="section-title">依赖关系</div>
        <p style="font-size:13px;color:var(--color-text-secondary);margin-bottom:12px;">配置子活动依赖的父活动。导出时按此填充 Config.dependency 列。</p>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <select id="depParent" style="padding:6px;border:1px solid var(--color-border);border-radius:4px;min-width:200px;">${parentOpts}</select>
          <select id="depChild" style="padding:6px;border:1px solid var(--color-border);border-radius:4px;min-width:200px;">${parentOpts}</select>
          <button class="btn btn-primary btn-sm" id="depAddBtn">+ 添加依赖</button>
        </div>
        <table class="config-table"><thead><tr><th>父活动</th><th>子活动</th><th>操作</th></tr></thead><tbody>
          ${deps.map((d, i) => `<tr><td>${escapeHtml(d.parent)}</td><td>${escapeHtml(d.child)}</td><td><button class="btn btn-danger btn-sm" data-del="${i}">删除</button></td></tr>`).join('')}
        </tbody></table>
        ${deps.length === 0 ? '<div class="empty-state">暂无依赖关系</div>' : ''}
      </div>
    `;

    root.querySelector('#depAddBtn')?.addEventListener('click', () => {
      const parent = (root.querySelector('#depParent') as HTMLSelectElement).value;
      const child = (root.querySelector('#depChild') as HTMLSelectElement).value;
      if (!parent || !child || parent === child) {
        alert('请选择不同的父/子活动');
        return;
      }
      const next: Dependency[] = [...deps];
      // 修复 v1 bug：addDependency 去重（与 addChildDependency 一致）
      if (next.some((d) => d.parent === parent && d.child === child)) {
        alert('该依赖已存在');
        return;
      }
      next.push({ parent, child });
      store.dispatch({ type: 'SETTINGS_PATCH', payload: { dependencies: next } });
    });
    root.querySelectorAll<HTMLElement>('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.del!, 10);
        const next = deps.filter((_, idx) => idx !== i);
        store.dispatch({ type: 'SETTINGS_PATCH', payload: { dependencies: next } });
      });
    });
  }

  render();
  store.subscribe((s) => s.settings.dependencies, render);
  store.subscribe((s) => s.settings.activityMeta, render);
}

export function renderMutexTab(store: Store, root: HTMLElement): void {
  function render(): void {
    const s = selectSettings(store.getState());
    const meta = s.activityMeta;
    const groups = s.mutexGroups;
    const actOpts = meta.map((m) => `<option value="${escapeHtml(m.activityKey)}">${escapeHtml(m.activityName)}</option>`).join('');

    root.innerHTML = `
      <div style="padding:20px;">
        <div class="section-title">互斥组</div>
        <p style="font-size:13px;color:var(--color-text-secondary);margin-bottom:12px;">同一互斥组内的活动不可同时开启。导出时按此填充 Config.mutex 列。</p>
        <button class="btn btn-primary btn-sm" id="mgAddBtn" style="margin-bottom:12px;">+ 新建互斥组</button>
        ${groups.map((g, gi) => `
          <div class="config-panel" style="background:#f9f9f9;padding:12px;border-radius:6px;margin-bottom:12px;border-left:4px solid var(--color-primary);">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
              <input data-rename="${gi}" value="${escapeHtml(g.name)}" style="flex:1;padding:6px;border:1px solid var(--color-border);border-radius:4px;">
              <button class="btn btn-danger btn-sm" data-delgrp="${gi}">删除组</button>
            </div>
            <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
              ${g.activities.map((a) => `<span style="background:var(--color-primary);color:white;padding:3px 8px;border-radius:12px;font-size:12px;">${escapeHtml(a)} <span data-rmact="${gi}|${escapeHtml(a)}" style="cursor:pointer;">×</span></span>`).join('')}
            </div>
            <div style="display:flex;gap:6px;">
              <select data-addsel="${gi}" style="padding:4px;border:1px solid var(--color-border);border-radius:4px;flex:1;">${actOpts}</select>
              <button class="btn btn-secondary btn-sm" data-addact="${gi}">+ 加入</button>
            </div>
          </div>
        `).join('')}
        ${groups.length === 0 ? '<div class="empty-state">暂无互斥组</div>' : ''}
      </div>
    `;

    root.querySelector('#mgAddBtn')?.addEventListener('click', () => {
      const next: MutexGroup[] = [...groups, { id: newGroupId(), name: '新互斥组', activities: [] }];
      store.dispatch({ type: 'SETTINGS_PATCH', payload: { mutexGroups: next } });
    });
    root.querySelectorAll<HTMLInputElement>('[data-rename]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const i = parseInt(inp.dataset.rename!, 10);
        const name = inp.value.trim() || groups[i]!.name; // 空值回退原名（v1 语义）
        const next: MutexGroup[] = groups.map((g, idx) => (idx === i ? { ...g, name } : g));
        store.dispatch({ type: 'SETTINGS_PATCH', payload: { mutexGroups: next } });
      });
    });
    root.querySelectorAll<HTMLElement>('[data-delgrp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.delgrp!, 10);
        if (!confirm('删除互斥组？')) return;
        store.dispatch({ type: 'SETTINGS_PATCH', payload: { mutexGroups: groups.filter((_, idx) => idx !== i) } });
      });
    });
    root.querySelectorAll<HTMLElement>('[data-rmact]').forEach((span) => {
      span.addEventListener('click', () => {
        const [gi, act] = span.dataset.rmact!.split('|');
        const i = parseInt(gi!, 10);
        // filter 移除所有同名活动（v1 隐式批量语义）
        const next: MutexGroup[] = groups.map((g, idx) =>
          idx === i ? { ...g, activities: g.activities.filter((a) => a !== act) } : g,
        );
        store.dispatch({ type: 'SETTINGS_PATCH', payload: { mutexGroups: next } });
      });
    });
    root.querySelectorAll<HTMLElement>('[data-addact]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.addact!, 10);
        const sel = root.querySelector(`select[data-addsel="${i}"]`) as HTMLSelectElement;
        const act = sel.value;
        if (!act) return;
        const cur = groups[i]!;
        if (cur.activities.includes(act)) return; // 去重
        const next: MutexGroup[] = groups.map((g, idx) =>
          idx === i ? { ...g, activities: [...g.activities, act] } : g,
        );
        store.dispatch({ type: 'SETTINGS_PATCH', payload: { mutexGroups: next } });
      });
    });
  }

  render();
  store.subscribe((s) => s.settings.mutexGroups, render);
  store.subscribe((s) => s.settings.activityMeta, render);
}
