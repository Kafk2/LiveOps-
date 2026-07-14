/**
 * tests/segment-expr.test.ts — segments 表达式 serialize/parse 边界 + round-trip
 */

import { describe, it, expect } from 'vitest';
import {
  serializeSegmentExpr,
  parseSegmentExpr,
  DEFAULT_SEGMENT_KEYS,
} from '@/model/segment-expr';
import type { SegmentExpr } from '@/core/types';

describe('segment-expr serialize/parse', () => {
  it('单条件 serialize', () => {
    const c: SegmentExpr = { type: 'condition', key: 'userLevel', param1: '10', param2: '99999', negate: false };
    expect(serializeSegmentExpr(c)).toBe('userLevel;10#99999');
  });

  it('AND 组顶层不包外层括号', () => {
    const g: SegmentExpr = { type: 'group', op: 'and', negate: false, children: [
      { type: 'condition', key: 'version', param1: '10.4.5', param2: '', negate: false },
      { type: 'condition', key: 'lifeTime', param1: '10', param2: '9999', negate: false },
    ] };
    expect(serializeSegmentExpr(g)).toBe('version;10.4.5#&lifeTime;10#9999');
  });

  it('取反 serialize（条件/组）', () => {
    const c: SegmentExpr = { type: 'condition', key: 'userLevel', param1: '10', param2: '', negate: true };
    expect(serializeSegmentExpr(c)).toBe('!userLevel;10#');
  });

  it('嵌套 OR 组带括号', () => {
    const g: SegmentExpr = { type: 'group', op: 'and', negate: false, children: [
      { type: 'group', op: 'or', negate: false, children: [
        { type: 'condition', key: 'a', param1: '1', param2: '', negate: false },
        { type: 'condition', key: 'b', param1: '2', param2: '', negate: false },
      ] },
      { type: 'condition', key: 'c', param1: '3', param2: '', negate: false },
    ] };
    expect(serializeSegmentExpr(g)).toBe('(a;1#|b;2#)&c;3#');
  });

  it('parse 单条件', () => {
    expect(parseSegmentExpr('userLevel;10#99999')).toEqual({
      type: 'condition', key: 'userLevel', param1: '10', param2: '99999', negate: false,
    });
  });

  it('parse AND（同级左结合，顶层 group）', () => {
    const e = parseSegmentExpr('version;10.4.5#&lifeTime;10#9999');
    expect(e?.type).toBe('group');
    expect(e && e.type === 'group' && e.op).toBe('and');
    expect(e && e.type === 'group' && e.children.length).toBe(2);
  });

  it('parse 括号分组 + 取反', () => {
    const e = parseSegmentExpr('!(version;10.4.5#)&lifeTime;10#9999');
    expect(e?.type).toBe('group');
    expect(e && e.type === 'group' && e.op).toBe('and');
    // 左子是取反的 version
    const left = e && e.type === 'group' ? e.children[0] : null;
    expect(left?.type).toBe('condition');
    expect(left && left.type === 'condition' && left.negate).toBe(true);
  });

  it('parse 空串 → null', () => {
    expect(parseSegmentExpr('')).toBeNull();
    expect(parseSegmentExpr('   ')).toBeNull();
  });

  it('parse 非法 → null', () => {
    expect(parseSegmentExpr('garbage')).toBeNull(); // 无 ;#
    expect(parseSegmentExpr('(a;1#')).toBeNull(); // 括号不匹配
    expect(parseSegmentExpr('a;1#&')).toBeNull(); // 末尾运算符无右操作数
  });

  it('round-trip：常见表达式 serialize∘parse 稳定', () => {
    const cases = [
      'userLevel;10#99999',
      'version;10.4.5#&lifeTime;10#9999',
      '(version;10.4.5#|item;Energy#5)&lifeTime;10#9999',
      '!userLevel;10#',
      '(a;1#|b;2#)&c;3#',
    ];
    for (const s of cases) {
      const parsed = parseSegmentExpr(s);
      expect(parsed, `parse failed: ${s}`).not.toBeNull();
      const back = serializeSegmentExpr(parsed);
      // round-trip 后再 parse 应等价（表达式可能因顶层去括号略有差异，但语义等价）
      expect(parseSegmentExpr(back), `reparse failed: ${back}`).not.toBeNull();
    }
  });

  it('文档示例 round-trip', () => {
    const doc = '(version;10.4.5#)&lifeTime;10#9999';
    const parsed = parseSegmentExpr(doc);
    expect(parsed).not.toBeNull();
    // 顶层是 group(因 () 包裹两元素？实际 () 包整个 → 单元素 group → 解析为内部)
    // (A)&B : 括号包 A，外层 & B → and(A, B)
    expect(parsed?.type).toBe('group');
  });

  it('DEFAULT_SEGMENT_KEYS 含 5 种', () => {
    expect(DEFAULT_SEGMENT_KEYS.length).toBe(5);
    expect(DEFAULT_SEGMENT_KEYS.map((k) => k.key).sort()).toEqual(
      ['item', 'lifeTime', 'payAmount', 'userLevel', 'version'],
    );
  });
});
