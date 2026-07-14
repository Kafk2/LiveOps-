/**
 * ui/segment-builder.ts — segments 可视化构建器（扁平条件流，方案 1）
 *
 * 根 group 扁平渲染（无边框）：children 纵向排列，行间显示「且/或」运算符
 * （点切换所属组 op）。条件压成紧凑单行（取反 + key + 两参数 + 删除）。
 * 用户「+ 分组」才出现嵌套组（浅背景容器，头标 op/取反/删除）。
 * 树结构/算法（parse/serialize/applyAtPath）不变，仅改渲染与编辑交互。
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
  let previewEl: HTMLElement | null = null;

  function refreshPreview(): void {
    if (!previewEl) return;
    const s = serializeSegmentExpr(tree);
    previewEl.textContent = s ? `表达式：${s}` : '（无条件，全体玩家可见）';
  }
  function emit(): void {
    opts.onChange(serializeSegmentExpr(tree));
  }
  function updateNode(path: string, fn: (n: SegmentExpr) => SegmentExpr): void {
    tree = applyAtPath(tree, path, fn);
    emit();
    refreshPreview();
  }

  function h(cls: string): HTMLElement {
    const e = document.createElement('div');
    e.className = cls;
    return e;
  }

  // 小图标按钮（取反/删除）
  function iconBtn(text: string, title: string, active: boolean, onClick: () => void): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-icon' + (active ? ' active' : '');
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  /** 运算符连接器（且/或），点切换所属 group op */
  function opConnector(op: 'and' | 'or', path: string, inline: boolean): HTMLElement {
    const el = document.createElement(inline ? 'span' : 'div');
    el.className = 'seg-op ' + (op === 'and' ? 'seg-op-and' : 'seg-op-or') + (inline ? ' seg-op-inline' : '');
    el.textContent = op === 'and' ? '且' : '或';
    el.title = '点击切换 且/或';
    el.addEventListener('click', () => {
      updateNode(path, (n) => (n.type === 'group' ? { ...n, op: n.op === 'and' ? 'or' : 'and' } : n));
      render();
    });
    return el;
  }

  function paramInline(label: string, val: string, path: string, field: 'param1' | 'param2'): HTMLElement {
    const w = document.createElement('label');
    w.className = 'seg-param';
    const l = document.createElement('span');
    l.textContent = label;
    w.appendChild(l);
    const i = document.createElement('input');
    i.value = val;
    i.placeholder = '空';
    i.addEventListener('input', () => updateNode(path, (n) => (n.type === 'condition' ? { ...n, [field]: i.value } : n)));
    w.appendChild(i);
    return w;
  }

  function renderCondition(node: Extract<SegmentExpr, { type: 'condition' }>, path: string): HTMLElement {
    const wrap = h('seg-cond');
    wrap.appendChild(iconBtn('!', '取反', node.negate, () => {
      updateNode(path, (n) => ({ ...n, negate: !n.negate }));
      render();
    }));
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
    wrap.appendChild(paramInline(keyDef?.param1Label ?? 'p1', node.param1, path, 'param1'));
    wrap.appendChild(paramInline(keyDef?.param2Label ?? 'p2', node.param2, path, 'param2'));
    wrap.appendChild(iconBtn('✕', '删除', false, () => {
      const segs = path.split('.');
      const idx = parseInt(segs.pop()!, 10);
      const parentPath = segs.join('.');
      tree = applyAtPath(tree, parentPath, (n) =>
        n.type === 'group' ? { ...n, children: n.children.filter((_, i) => i !== idx) } : n,
      );
      emit();
      render();
    }));
    return wrap;
  }

  function addBar(path: string): HTMLElement {
    const bar = h('seg-addbar');
    const mk = (text: string, child: SegmentExpr) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary btn-sm';
      b.textContent = text;
      b.addEventListener('click', () => {
        tree = applyAtPath(tree, path, (n) => (n.type === 'group' ? { ...n, children: [...n.children, child] } : n));
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
    const isRoot = path === '';
    const wrap = isRoot ? h('seg-root') : h('seg-group-flat');
    wrap.dataset.op = node.op;
    if (!isRoot) {
      const head = h('seg-group-head');
      head.appendChild(opConnector(node.op, path, false));
      head.appendChild(iconBtn('!', '取反', node.negate, () => {
        updateNode(path, (n) => ({ ...n, negate: !n.negate }));
        render();
      }));
      head.appendChild(iconBtn('✕', '删除', false, () => {
        const segs = path.split('.');
        const idx = parseInt(segs.pop()!, 10);
        const parentPath = segs.join('.');
        tree = applyAtPath(tree, parentPath, (n) =>
          n.type === 'group' ? { ...n, children: n.children.filter((_, i) => i !== idx) } : n,
        );
        emit();
        render();
      }));
      wrap.appendChild(head);
    }
    const body = h('seg-group-body');
    node.children.forEach((c, i) => {
      const childPath = isRoot ? String(i) : `${path}.${i}`;
      if (i > 0) body.appendChild(opConnector(node.op, path, true)); // 行间运算符
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
    previewEl = h('seg-preview');
    root.appendChild(previewEl);
    refreshPreview();
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
