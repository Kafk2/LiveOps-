/**
 * model/segment-expr.ts — segments 表达式树 serialize/parse + 默认 segmentKey
 *
 * segments 语法（需求文档 2.4）：
 *   基本条件：segmentKey;param1#param2  （如 userLevel;10#99999）
 *   组合：& 且 | 或 () 分组 ! 取反
 *   # 左右表示范围，左闭右开，空表示无限制
 *
 * 树结构（SegmentExpr）：condition 叶子 / group 内部节点（and|or，含 children + negate）。
 * serialize: 树 → 表达式字符串；parse: 表达式 → 树（递归下降，优先级 ! > & > |，同级左结合）。
 */

import type { SegmentExpr, SegmentKeyDef } from '@/core/types';

/** 内置 5 种 segmentKey（需求文档定义） */
export const DEFAULT_SEGMENT_KEYS: SegmentKeyDef[] = [
  { key: 'userLevel', name: '玩家等级', param1Label: '最小等级', param2Label: '最大等级', description: '玩家当前等级，开区间' },
  { key: 'lifeTime', name: '注册天数', param1Label: '最小天数', param2Label: '最大天数', description: '玩家注册天数（当前-注册，向下取整），开区间' },
  { key: 'payAmount', name: '充值金额', param1Label: '最小金额', param2Label: '最大金额', description: '累计支付金额，开区间' },
  { key: 'version', name: '客户端版本', param1Label: '最低版本', param2Label: '最高版本', description: '客户端版本号，开区间' },
  { key: 'item', name: '道具', param1Label: '道具ID', param2Label: '最小数量', description: '拥有指定道具数量（≥），左闭' },
];

// ----------------------------------------------------------------------------
// serialize: SegmentExpr → 表达式字符串
// ----------------------------------------------------------------------------

function serializeNode(expr: SegmentExpr): string {
  const inner =
    expr.type === 'condition'
      ? `${expr.key};${expr.param1}#${expr.param2}`
      : `(${expr.children.map(serializeNode).join(expr.op === 'and' ? '&' : '|')})`;
  return (expr.negate ? '!' : '') + inner;
}

/** 树 → 表达式。顶层 group 不包外层括号（更可读）。 */
export function serializeSegmentExpr(expr: SegmentExpr | null): string {
  if (!expr) return '';
  if (expr.type === 'group' && !expr.negate) {
    // 顶层 group：不包外层括号
    return expr.children.map(serializeNode).join(expr.op === 'and' ? '&' : '|');
  }
  return serializeNode(expr);
}

// ----------------------------------------------------------------------------
// parse: 表达式 → SegmentExpr（递归下降）
//   orExpr  := andExpr ('|' andExpr)*
//   andExpr := unary ('&' unary)*
//   unary   := '!' unary | primary
//   primary := condition | '(' orExpr ')'
//   condition := key ';' param1 '#' param2
// ----------------------------------------------------------------------------

interface Token {
  kind: 'cond' | 'and' | 'or' | 'lparen' | 'rparen' | 'not';
  value?: string; // cond: "key;p1#p2"
}

/** 分词：识别条件 / & / | / ( / ) / ! */
function tokenize(s: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '&') { tokens.push({ kind: 'and' }); i++; continue; }
    if (ch === '|') { tokens.push({ kind: 'or' }); i++; continue; }
    if (ch === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }
    if (ch === '!') { tokens.push({ kind: 'not' }); i++; continue; }
    // condition: 读到下一个 & | ( ) ! 或字符串末尾
    let j = i;
    while (j < s.length && !'&|()!'.includes(s[j]!)) j++;
    const cond = s.slice(i, j).trim();
    if (!cond || !cond.includes(';') || !cond.includes('#')) return null; // 非法条件
    tokens.push({ kind: 'cond', value: cond });
    i = j;
  }
  return tokens;
}

function parseCondition(tok: Token): SegmentExpr {
  // tok.value = "key;p1#p2"
  const v = tok.value ?? '';
  const semi = v.indexOf(';');
  const hash = v.indexOf('#');
  const key = v.slice(0, semi);
  const param1 = v.slice(semi + 1, hash);
  const param2 = v.slice(hash + 1);
  return { type: 'condition', key, param1, param2, negate: false };
}

class Parser {
  pos = 0;
  constructor(private tokens: Token[]) {}

  peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos]! : null;
  }
  next(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos++]! : null;
  }

  parseOr(): SegmentExpr | null {
    const first = this.parseAnd();
    if (!first) return null;
    const children: SegmentExpr[] = [first];
    while (this.peek()?.kind === 'or') {
      this.next();
      const next = this.parseAnd();
      if (!next) return null;
      children.push(next);
    }
    if (children.length === 1) return children[0]!;
    return { type: 'group', op: 'or', children, negate: false };
  }

  parseAnd(): SegmentExpr | null {
    const first = this.parseUnary();
    if (!first) return null;
    const children: SegmentExpr[] = [first];
    while (this.peek()?.kind === 'and') {
      this.next();
      const next = this.parseUnary();
      if (!next) return null;
      children.push(next);
    }
    if (children.length === 1) return children[0]!;
    return { type: 'group', op: 'and', children, negate: false };
  }

  parseUnary(): SegmentExpr | null {
    if (this.peek()?.kind === 'not') {
      this.next();
      const child = this.parseUnary();
      if (!child) return null;
      // 取反作用于子节点：若子是 group/condition，设其 negate=true
      return { ...child, negate: !child.negate } as SegmentExpr;
    }
    return this.parsePrimary();
  }

  parsePrimary(): SegmentExpr | null {
    const tok = this.peek();
    if (!tok) return null;
    if (tok.kind === 'cond') {
      this.next();
      return parseCondition(tok);
    }
    if (tok.kind === 'lparen') {
      this.next();
      const inner = this.parseOr();
      if (this.peek()?.kind !== 'rparen') return null; // 括号不匹配
      this.next();
      return inner;
    }
    return null; // 非法
  }
}

/** 表达式 → 树。空串/非法返回 null。 */
export function parseSegmentExpr(str: string): SegmentExpr | null {
  const s = str.trim();
  if (!s) return null;
  const tokens = tokenize(s);
  if (!tokens || tokens.length === 0) return null;
  const parser = new Parser(tokens);
  const expr = parser.parseOr();
  if (!expr) return null;
  if (parser.pos !== tokens.length) return null; // 末尾有未消费 token（如多余括号）
  return expr;
}
