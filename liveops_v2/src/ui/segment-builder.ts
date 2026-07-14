/**
 * ui/segment-builder.ts — segments 可视化表达式构建器（纯可视化方案 B）
 *
 * 递归渲染 SegmentExpr 树：AND/OR 组（嵌套容器）+ 条件（key+两参数）+ 取反。
 * 编辑：添加条件/且组/或组、切换组 op、取反、改 key/参数、删除。
 * 根始终为 group（单条件根自动包成 AND 组）；空 group serialize 为 ''。
 * 编辑改内部 tree → serialize → onChange；不依赖外部重渲染（避免失焦）。
 */

import type { SegmentExpr, SegmentKeyDef } from '@/core/types';
import { parseSegmentExpr, serializeSegmentExpr } from '@/model/segment-expr';

export interface SegmentBuilderOpts {
  value: string;
  segmentKeys: SegmentKeyDef[];
  onChange: (expr: string) => void;
}

export interface SegmentBuilderHandle {
  getElement(): HTMLElement;
  refresh(value: string): void;
  destroy(): void;
}

function parseToRoot(value: string): SegmentExpr {
  const p = parseSegmentExpr(value);
  if (!p) return { type: 'group', op: 'and', children: [], negate: false };
  if (p.type === 'condition') return { type: 'group', op: 'and', children: [p], negate: false };
  return p;
}

/** 不可变更新 path 处的节点 */
function applyAtPath(node: SegmentExpr, path: string, fn: (n: SegmentExpr) => SegmentExpr): SegmentExpr {
  if (path === '') return fn(node);
  const segs = path.split('.');
  const idx = parseInt(segs[0]!, 10);
  const rest = segs.slice(1).join('.');
  if (node.type !== 'group') return node;
  const children = node.children.map((c, i) => (i === idx ? applyAtPath(c, rest, fn) : c));
  return { ...node, children };
}

export function createSegmentBuilder(opts: SegmentBuilderOpts): SegmentBuilderHandle {
  let tree: SegmentExpr = parseToRoot(opts.value);
  const root = document.createElement('div');
  root.className = 'seg-builder';

  function emit(): void {
    opts.onChange(serializeSegmentExpr(tree));
  }
  function updateNode(path: string, fn: (n: SegmentExpr) => SegmentExpr): void {
    tree = applyAtPath(tree, path, fn);
    emit();
  }

  function h(tag: string, cls: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = cls;
    return e;
  }

  function delBtn(path: string): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-danger btn-sm';
    b.textContent = '✕';
    b.title = '删除';
    b.addEventListener('click', () => {
      const segs = path.split('.');
      const idx = parseInt(segs.pop()!, 10);
      const parentPath = segs.join('.');
      tree = applyAtPath(tree, parentPath, (n) =>
        n.type === 'group' ? { ...n, children: n.children.filter((_, i) => i !== idx) } : n,
      );
      emit();
      render();
    });
    return b;
  }

  function negBtn(negate: boolean, path: string): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-secondary btn-sm';
    b.textContent = negate ? '✓ 取反' : '! 取反';
    b.title = '取反';
    b.addEventListener('click', () => {
      updateNode(path, (n) => ({ ...n, negate: !n.negate }));
      render();
    });
    return b;
  }

  function paramInput(label: string, val: string, path: string, field: 'param1' | 'param2'): HTMLElement {
    const w = h('div', 'seg-param');
    const l = document.createElement('label');
    l.textContent = label;
    w.appendChild(l);
    const i = document.createElement('input');
    i.value = val;
    i.placeholder = '空=不限';
    i.addEventListener('input', () => updateNode(path, (n) => (n.type === 'condition' ? { ...n, [field]: i.value } : n)));
    w.appendChild(i);
    return w;
  }

  function renderCondition(node: Extract<SegmentExpr, { type: 'condition' }>, path: string): HTMLElement {
    const wrap = h('div', 'seg-cond');
    if (path !== '') wrap.appendChild(negBtn(node.negate, path));
    // key select
    const sel = document.createElement('select');
    opts.segmentKeys.forEach((k) => {
      const o = document.createElement('option');
      o.value = k.key;
      o.textContent = k.name || k.key;
      if (k.key === node.key) o.selected = true;
      sel.appendChild(o);
    });
    if (node.key && !opts.segmentKeys.some((k) => k.key === node.key)) {
      const o = document.createElement('option');
      o.value = node.key;
      o.textContent = node.key + '（未注册）';
      o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      updateNode(path, (n) => (n.type === 'condition' ? { ...n, key: sel.value } : n));
      render();
    });
    wrap.appendChild(sel);
    const keyDef = opts.segmentKeys.find((k) => k.key === node.key);
    wrap.appendChild(paramInput(keyDef?.param1Label ?? '参数1', node.param1, path, 'param1'));
    wrap.appendChild(paramInput(keyDef?.param2Label ?? '参数2', node.param2, path, 'param2'));
    if (path !== '') wrap.appendChild(delBtn(path));
    return wrap;
  }

  function addBar(path: string): HTMLElement {
    const bar = h('div', 'seg-addbar');
    const mk = (text: string, child: SegmentExpr) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary btn-sm';
      b.textContent = text;
      b.addEventListener('click', () => {
        tree = applyAtPath(tree, path, (n) =>
          n.type === 'group' ? { ...n, children: [...n.children, child] } : n,
        );
        emit();
        render();
      });
      return b;
    };
    const firstKey = opts.segmentKeys[0]?.key ?? 'userLevel';
    bar.appendChild(mk('+ 条件', { type: 'condition', key: firstKey, param1: '', param2: '', negate: false }));
    bar.appendChild(mk('+ 且组', { type: 'group', op: 'and', children: [], negate: false }));
    bar.appendChild(mk('+ 或组', { type: 'group', op: 'or', children: [], negate: false }));
    return bar;
  }

  function renderGroup(node: Extract<SegmentExpr, { type: 'group' }>, path: string): HTMLElement {
    const wrap = h('div', 'seg-group');
    wrap.dataset.op = node.op;
    const head = h('div', 'seg-group-head');
    if (path !== '') head.appendChild(negBtn(node.negate, path));
    const opBtn = document.createElement('button');
    opBtn.type = 'button';
    opBtn.className = 'btn btn-primary btn-sm seg-op-btn';
    opBtn.textContent = node.op === 'and' ? '且 (AND)' : '或 (OR)';
    opBtn.addEventListener('click', () => {
      updateNode(path, (n) => (n.type === 'group' ? { ...n, op: n.op === 'and' ? 'or' : 'and' } : n));
      render();
    });
    head.appendChild(opBtn);
    if (path !== '') head.appendChild(delBtn(path));
    wrap.appendChild(head);
    const body = h('div', 'seg-group-body');
    node.children.forEach((c, i) => {
      const childPath = path === '' ? String(i) : `${path}.${i}`;
      body.appendChild(renderNode(c, childPath));
    });
    wrap.appendChild(body);
    wrap.appendChild(addBar(path));
    return wrap;
  }

  function renderNode(node: SegmentExpr, path: string): HTMLElement {
    return node.type === 'condition' ? renderCondition(node, path) : renderGroup(node, path);
  }

  function render(): void {
    root.innerHTML = '';
    root.appendChild(renderNode(tree, ''));
    // 表达式预览
    const preview = h('div', 'seg-preview');
    const s = serializeSegmentExpr(tree);
    preview.textContent = s ? `表达式：${s}` : '（无条件，全体玩家可见）';
    root.appendChild(preview);
  }

  render();

  return {
    getElement: () => root,
    refresh(value: string) {
      tree = parseToRoot(value);
      render();
    },
    destroy() {
      root.innerHTML = '';
    },
  };
}
