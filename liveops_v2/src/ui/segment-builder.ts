/**
 * ui/segment-builder.ts — segments 构建器（树结构 + 行首且/或 + 单行紧凑条件）
 *
 * - 根 group 扁平；嵌套「且/或组」轻微背景容器（保留组合能力）
 * - 条件单行 nowrap：[行首且/或圆] [!取反] [key▼] [参数1] [参数2] [✕]
 * - 行首「且/或」圆形色块（点切换所属组 op）
 * - + 条件 / + 且组 / + 或组
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
  const rootEl = document.createElement('div');
  rootEl.className = 'seg-builder';
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
  function div(cls: string): HTMLElement {
    const e = document.createElement('div');
    e.className = cls;
    return e;
  }
  function iconBtn(text: string, title: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-icon' + (active ? ' active' : '');
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }
  function opConnector(op: 'and' | 'or', path: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'seg-optag ' + (op === 'and' ? 'seg-optag-and' : 'seg-optag-or');
    el.textContent = op === 'and' ? '且' : '或';
    el.title = '切换 且/或';
    el.addEventListener('click', () => {
      updateNode(path, (n) => (n.type === 'group' ? { ...n, op: n.op === 'and' ? 'or' : 'and' } : n));
      render();
    });
    return el;
  }
  function paramInput(placeholder: string, val: string, path: string, field: 'param1' | 'param2'): HTMLInputElement {
    const i = document.createElement('input');
    i.className = 'seg-param-input';
    i.value = val;
    i.placeholder = placeholder;
    i.addEventListener('input', () => updateNode(path, (n) => (n.type === 'condition' ? { ...n, [field]: i.value } : n)));
    return i;
  }
  function deleteNode(path: string): void {
    const segs = path.split('.');
    const idx = parseInt(segs.pop()!, 10);
    const parentPath = segs.join('.');
    tree = applyAtPath(tree, parentPath, (n) =>
      n.type === 'group' ? { ...n, children: n.children.filter((_, i) => i !== idx) } : n,
    );
    emit();
    render();
  }
  function addChild(path: string, child: SegmentExpr): void {
    tree = applyAtPath(tree, path, (n) => (n.type === 'group' ? { ...n, children: [...n.children, child] } : n));
    emit();
    render();
  }

  function renderCondition(node: Extract<SegmentExpr, { type: 'condition' }>, path: string): HTMLElement {
    const wrap = div('seg-cond');
    wrap.appendChild(iconBtn('!', '取反', node.negate, () => {
      updateNode(path, (n) => ({ ...n, negate: !n.negate }));
      render();
    }));
    const sel = document.createElement('select');
    sel.className = 'seg-key-sel';
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
      o.textContent = node.key + '(未注册)';
      o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      updateNode(path, (n) => (n.type === 'condition' ? { ...n, key: sel.value } : n));
      render();
    });
    wrap.appendChild(sel);
    const keyDef = opts.segmentKeys.find((k) => k.key === node.key);
    wrap.appendChild(paramInput(keyDef?.param1Label ?? 'p1', node.param1, path, 'param1'));
    wrap.appendChild(paramInput(keyDef?.param2Label ?? 'p2', node.param2, path, 'param2'));
    wrap.appendChild(iconBtn('✕', '删除', false, () => deleteNode(path)));
    return wrap;
  }

  function addBar(path: string): HTMLElement {
    const bar = div('seg-addbar');
    const mk = (text: string, child: SegmentExpr) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', () => addChild(path, child));
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
    const wrap = isRoot ? div('seg-root') : div('seg-group');
    wrap.dataset.op = node.op;
    if (isRoot) {
      // 根：顶部一个「且/或」标记（组级，非每行重复），点切换全组 op
      const opBar = div('seg-root-op');
      opBar.appendChild(opConnector(node.op, path));
      const hint = document.createElement('span');
      hint.className = 'seg-op-hint';
      hint.textContent = '满足以下条件';
      opBar.appendChild(hint);
      wrap.appendChild(opBar);
    } else {
      // 嵌套组：头一个 op + 取反 + 删除
      const head = div('seg-group-head');
      head.appendChild(opConnector(node.op, path));
      head.appendChild(iconBtn('!', '取反', node.negate, () => {
        updateNode(path, (n) => ({ ...n, negate: !n.negate }));
        render();
      }));
      head.appendChild(iconBtn('✕', '删除', false, () => deleteNode(path)));
      wrap.appendChild(head);
    }
    const body = div('seg-group-body');
    node.children.forEach((c, i) => {
      const childPath = isRoot ? String(i) : `${path}.${i}`;
      body.appendChild(renderNode(c, childPath)); // 条件行无行首连接符（组级 op 已在上方）
    });
    wrap.appendChild(body);
    wrap.appendChild(addBar(path));
    return wrap;
  }

  function renderNode(node: SegmentExpr, path: string): HTMLElement {
    return node.type === 'condition' ? renderCondition(node, path) : renderGroup(node, path);
  }

  function render(): void {
    rootEl.innerHTML = '';
    rootEl.appendChild(renderNode(tree, ''));
    previewEl = div('seg-preview');
    rootEl.appendChild(previewEl);
    refreshPreview();
  }

  render();

  return {
    getElement: () => rootEl,
    refresh(value: string) {
      tree = parseToRoot(value);
      render();
    },
    destroy() {
      rootEl.innerHTML = '';
    },
  };
}
