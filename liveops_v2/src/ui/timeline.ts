/**
 * ui/timeline.ts — 最小时间轴（迭代 1b/1c）
 *
 * 目的：验证"表单编辑 → 时间轴实时预览未保存"的核心产品价值。
 * 先用 DOM 渲染（性能在后续迭代用 Canvas + 虚拟化替换）。
 *
 * 关键契约：
 * - committed configs 画实色 bar；
 * - 当前 selectedConfig 若有 draft，用 {...committed, ...draft} 计算 period，
 *   画虚线/半透明 bar 覆盖，表示"未保存的预览位置"；
 * - DRAFT_EDIT 后实时重算（订阅 editor.draft）。
 */

import type { Store } from '@/core/store';
import {
  selectConfigsArray,
  selectActivityMetaMap,
  getActivityName,
  getActivityType,
} from '@/core/selectors';
import { getSchedules } from '@/model/schedule';
import { isEnabled, Config, Period, ActivityMeta } from '@/core/types';

const PX_PER_HOUR = 12; // 固定，缩放留后续
const ROW_HEIGHT = 30;
const BAR_HEIGHT = 22;
const DAY_MS = 86400000;
const PAD_DAYS = 7;

interface Range {
  min: number;
  max: number;
}

function computeRange(configs: Config[]): Range {
  let min = Infinity;
  let max = -Infinity;
  for (const c of configs) {
    for (const p of getSchedules(c)) {
      if (p.openTime < min) min = p.openTime;
      if (p.closeTime > max) max = p.closeTime;
    }
  }
  if (!isFinite(min)) {
    const now = Date.now();
    min = now;
    max = now + 30 * DAY_MS;
  }
  return { min: min - PAD_DAYS * DAY_MS, max: max + PAD_DAYS * DAY_MS };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rowHtml(
  config: Config,
  displayConfig: Config,
  range: Range,
  metaMap: Record<string, ActivityMeta>,
  isDraft: boolean,
): string {
  const periods: Period[] = getSchedules(displayConfig);
  const name = escapeHtml(getActivityName(config, metaMap));
  const type = getActivityType(config, metaMap);
  const bars = periods
    .map((p) => {
      const left = ((p.openTime - range.min) / 3600000) * PX_PER_HOUR;
      const width = Math.max(((p.closeTime - p.openTime) / 3600000) * PX_PER_HOUR, 2);
      const style = isDraft
        ? 'border:2px dashed var(--color-warning);background:rgba(250,173,20,0.25);box-sizing:border-box;'
        : `background:${typeColor(type)};`;
      return `<div title="${name} 第${p.period}期" style="position:absolute;left:${left}px;width:${width}px;top:4px;height:${BAR_HEIGHT}px;${style}border-radius:3px;"></div>`;
    })
    .join('');
  return `<div style="height:${ROW_HEIGHT}px;position:relative;border-bottom:1px solid var(--color-border-light);">
    <span style="position:absolute;left:0;z-index:2;background:var(--color-bg-card);padding:0 8px 0 4px;font-size:12px;line-height:${ROW_HEIGHT}px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}${isDraft ? ' <span style="color:var(--color-warning);">●</span>' : ''}</span>
    ${bars}
  </div>`;
}

function typeColor(type: string): string {
  const map: Record<string, string> = {
    深度活动: '#FADB14',
    副棋盘: '#722ED1',
    集卡活动: '#A8071A',
    节日活动: '#95DE64',
    促活活动: '#13C2C2',
    长线活动: '#F759AB',
    feature: '#BAE0FF',
    default: '#346CE5',
  };
  return map[type] ?? '#346CE5';
}

export function renderTimeline(store: Store, root: HTMLElement): void {
  function render(): void {
    const state = store.getState();
    const configs = selectConfigsArray(state).filter(isEnabled);
    const metaMap = selectActivityMetaMap(state);
    const draft = state.editor.draft;
    const selectedId = state.ui.selectedConfigId;

    if (configs.length === 0) {
      root.innerHTML = '<div class="empty-state">暂无可显示的配置</div>';
      return;
    }

    const range = computeRange(configs);
    const totalWidth = Math.max(
      ((range.max - range.min) / 3600000) * PX_PER_HOUR,
      root.clientWidth || 800,
    );

    const now = Date.now();
    const nowLeft = ((now - range.min) / 3600000) * PX_PER_HOUR;

    const rows = configs
      .map((c) => {
        const isDraftRow = c.id === selectedId && draft != null;
        const display: Config = isDraftRow ? { ...c, ...draft } : c;
        return rowHtml(c, display, range, metaMap, isDraftRow);
      })
      .join('');

    root.innerHTML = `
      <div style="overflow-x:auto;max-height:520px;border:1px solid var(--color-border);border-radius:4px;position:relative;">
        <div style="position:relative;width:${totalWidth}px;min-height:${configs.length * ROW_HEIGHT}px;">
          <div title="今天" style="position:absolute;left:${nowLeft}px;top:0;bottom:0;width:2px;background:var(--color-danger);z-index:1;"></div>
          ${rows}
        </div>
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--color-text-secondary);">
        共 ${configs.length} 条已启用配置；
        <span style="display:inline-block;width:24px;height:10px;border:2px dashed var(--color-warning);background:rgba(250,173,20,0.25);vertical-align:middle;border-radius:2px;"></span> 未保存预览
      </div>`;
  }

  render();
  // committed 配置变 → 重渲染
  store.subscribe(selectConfigsArray, render);
  // 草稿变 → 重渲染（实时预览未保存位置）
  store.subscribe((s) => s.editor.draft, render);
  // 选中变 → 重渲染（draft overlay 跟随选中）
  store.subscribe((s) => s.ui.selectedConfigId, render);
}
