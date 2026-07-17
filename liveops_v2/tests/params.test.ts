/**
 * tests/params.test.ts — params 变体解析/序列化单测（兼容矩阵 + 往返）
 */
import { describe, it, expect } from 'vitest';
import { splitTopLevelObjects, parseParamsVariants, serializeParamsVariants } from '@/model/params';

describe('splitTopLevelObjects', () => {
  it('空串返回空数组', () => {
    expect(splitTopLevelObjects('')).toEqual([]);
  });
  it('单个空对象', () => {
    expect(splitTopLevelObjects('{}')).toEqual(['{}']);
  });
  it('多个对象裸拼接', () => {
    expect(splitTopLevelObjects('{"a":1},{"b":2}')).toEqual(['{"a":1}', '{"b":2}']);
  });
  it('外层 [] 数组写法（兼容）', () => {
    expect(splitTopLevelObjects('[{"a":1},{"b":2}]')).toEqual(['{"a":1}', '{"b":2}']);
  });
  it('忽略顶层非法片段', () => {
    expect(splitTopLevelObjects('{"a":1},xxx,{"b":2}')).toEqual(['{"a":1}', '{"b":2}']);
  });
  it('值含逗号不误拆', () => {
    expect(splitTopLevelObjects('{"a":"x,y"}')).toEqual(['{"a":"x,y"}']);
  });
  it('值含大括号不误拆', () => {
    expect(splitTopLevelObjects('{"a":"{x}"}')).toEqual(['{"a":"{x}"}']);
  });
  it('空白/换行分隔', () => {
    expect(splitTopLevelObjects('{"a":1}\n , \n{"b":2}')).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe('parseParamsVariants', () => {
  it('空串 → []', () => {
    expect(parseParamsVariants('')).toEqual([]);
  });
  it('纯空白 → []', () => {
    expect(parseParamsVariants('   ')).toEqual([]);
  });
  it('单个空对象 → [{}]', () => {
    expect(parseParamsVariants('{}')).toEqual([{}]);
  });
  it('单对象 → 解析', () => {
    expect(parseParamsVariants('{"a":1}')).toEqual([{ a: 1 }]);
  });
  it('多对象 → 数组', () => {
    expect(parseParamsVariants('{"a":1},{"b":2}')).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it('外层 [] 兼容', () => {
    expect(parseParamsVariants('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it('忽略非法片段', () => {
    expect(parseParamsVariants('{"a":1},xxx,{"b":2}')).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it('值含逗号', () => {
    expect(parseParamsVariants('{"a":"x,y"}')).toEqual([{ a: 'x,y' }]);
  });
  it('值含大括号', () => {
    expect(parseParamsVariants('{"a":"{x}"}')).toEqual([{ a: '{x}' }]);
  });
});

describe('serializeParamsVariants', () => {
  it('空数组 → 空串', () => {
    expect(serializeParamsVariants([])).toBe('');
  });
  it('单对象', () => {
    expect(serializeParamsVariants([{ a: 1 }])).toBe('{"a":1}');
  });
  it('多对象逗号拼接无外层 []', () => {
    expect(serializeParamsVariants([{ a: 1 }, { b: 2 }])).toBe('{"a":1},{"b":2}');
  });
});

describe('往返', () => {
  it('parse → serialize 等价（多变体）', () => {
    const raw = '{"pass":"Pass202606"},{"pass":"Pass202607"}';
    expect(serializeParamsVariants(parseParamsVariants(raw))).toBe(raw);
  });
  it('空往返', () => {
    expect(serializeParamsVariants(parseParamsVariants(''))).toBe('');
  });
});
