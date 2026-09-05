// 递归下降解析器：1:1 复刻 Java Parser（优先级链、赋值/函数/括号分派、
// 解析期常量折叠 Optimize、矩阵字面量分类、1×1 退化）。
// 行号：节点 line 取 Java 对应 token 的行（binop 取操作符行；call 取 LPAREN 行）。

import { Lexer, Token } from './lexer';
import { ExprError, TypeTag } from './types';
import { Node, binReturnType } from './ast';
import {
  Mat, matAddS, matSubS, matMulS, matDivS, matModS, matPowM,
  matAddM, matSubM, matMulM,
  iadd, isub, imul, intDiv, intMod, dmod,
} from './matrix';

// Java (int)(double) 窄化（饱和）——用于解析期真值判断
function javaIntCast(v: number): number {
  if (isNaN(v)) return 0;
  if (v >= 2147483647) return 2147483647;
  if (v < -2147483648) return -2147483648;
  return Math.trunc(v) | 0;
}

// int 幂（解析期折叠用，32 位回绕）
function intPow(l: number, r: number): number {
  let result = 1;
  for (let i = 0; i < r; i++) result = Math.imul(result, l);
  return result;
}

export class Parser {
  private lx: Lexer;

  constructor(lexer: Lexer) {
    this.lx = lexer;
  }

  parseBlock(): Node[] {
    const exps: Node[] = [];
    while (!this.isEnd(this.lx.peekToken())) {
      exps.push(this.parseExp());
      if (this.lx.peekToken().type === 'SEMI') this.lx.nextToken();
    }
    return exps;
  }

  // parseAssignOrFunctionCallExp：先试赋值，失败回退到 括号/函数/标识符。
  // recovery() 完整回滚（ptr+line+peek，与 Java 一致）；已消费的 token 在回滚后
  // 会被重新解析，最终失败形态由外层重试决定（与 Java 逐字节一致）。
  private parseAssignOrFunctionCall(): Node {
    try {
      this.lx.snapshot();
      const exp = this.parseAssignExp();
      this.lx.popSnapshot();
      return exp;
    } catch (e) {
      this.lx.recovery();
      if (this.lx.peekToken().type === 'LPAREN') {
        return this.parseParenExp();
      }
      this.lx.snapshot();
      this.lx.nextToken('IDENTIFIER');
      const tok = this.lx.peekToken();
      this.lx.recovery();
      if (tok.type === 'LPAREN') return this.parseFunctionCallExp();
      return this.parseIdentifier();
    }
  }

  // parseAssignExp：vars = exps（数量相等）
  private parseAssignExp(): Node {
    const vars = this.parseVars();
    this.lx.nextToken('ASSIGN');
    const exps = this.parseExps();
    if (vars.length !== exps.length) {
      throw new ExprError('assign expression\'s vars and exps length not equals');
    }
    // rt = 最后一个 rhs 的静态 rt
    const rt = exps[exps.length - 1].rt;
    return { k: 'assign', line: this.lxLine(), vars, exps, rt } as Node;
  }

  private lxLine(): number {
    return this.lx.peekToken().line - 0; // 行号以最近 token 为准（Java 用 lexer.line()）
  }

  private parseVars(): Node[] {
    const vars = [this.parseVar()];
    while (this.lx.peekToken().type === 'COMMA') {
      this.lx.nextToken();
      vars.push(this.parseVar());
    }
    return vars;
  }

  private parseVar(): Node {
    const t = this.lx.peekToken();
    if (t.type === 'LPAREN') {
      const exp = this.parseParenExp();
      if (exp.k !== 'namemat') throw new ExprError('not a var matrix');
      return exp;
    } else if (t.type === 'IDENTIFIER') {
      return this.parseIdentifier();
    }
    throw new ExprError('not a var');
  }

  private parseExps(): Node[] {
    const exps = [this.parseExp()];
    while (this.lx.peekToken().type === 'COMMA') {
      this.lx.nextToken();
      exps.push(this.parseExp());
    }
    return exps;
  }

  private parseExp(): Node {
    return this.parseExp7();
  }

  private parseIdentifier(): Node {
    const tok = this.lx.nextToken('IDENTIFIER');
    return { k: 'name', line: tok.line, name: tok.text, rt: -1 };
  }

  private parseFunctionCallExp(): Node {
    const nameTok = this.lx.nextToken('IDENTIFIER');
    const lparen = this.lx.nextToken('LPAREN');
    let args: Node[];
    if (this.lx.peekToken().type !== 'RPAREN') args = this.parseExps();
    else args = [];
    this.lx.nextToken('RPAREN');
    return { k: 'call', line: lparen.line, name: nameTok.text, args, rt: -1 };
  }

  // parseParenExp：矩阵/名字矩阵/1×1 退化
  private parseParenExp(): Node {
    const line = this.lx.nextToken('LPAREN').line;
    const exps: Node[][] = [];
    let expRow = this.parseExps();
    exps.push(expRow);
    let row = 1;
    const col = expRow.length;
    let isInt = allInt(expRow);
    let isFloat = allFloat(expRow);
    let isVar = allVar(expRow);
    while (this.lx.peekToken().type === 'DCOMMA') {
      this.lx.nextToken();
      expRow = this.parseExps();
      if (expRow.length !== col) throw new ExprError('bad matrix');
      exps.push(expRow);
      row++;
      if (isInt && !allInt(expRow)) isInt = false;
      if (isFloat && !allFloat(expRow)) isFloat = false;
      if (isVar && !allVar(expRow)) isVar = false;
    }
    this.lx.nextToken('RPAREN');
    if (row === 1 && col === 1) {
      return exps[0][0]; // 1×1 退化
    }
    if (isInt) {
      const d = new Int32Array(row * col);
      for (let i = 0; i < row; i++) {
        for (let j = 0; j < col; j++) {
          const e = expRowAt(exps, i, j);
          if (e.k === 'int') d[i * col + j] = e.v;
          else throw new ExprError('not a number'); // 理论不可达
        }
      }
      return { k: 'imat', line, r: row, c: col, d, rt: 12 };
    } else if (isFloat) {
      const d = new Float64Array(row * col);
      for (let i = 0; i < row; i++) {
        for (let j = 0; j < col; j++) {
          const e = expRowAt(exps, i, j);
          d[i * col + j] = (e as { v: number }).v;
        }
      }
      return { k: 'fmat', line, r: row, c: col, d, rt: 13 };
    } else if (!isVar) {
      return { k: 'mat', line, rows: exps, rt: 13 };
    }
    const names: string[][] = [];
    for (let i = 0; i < row; i++) {
      const r: string[] = [];
      for (let j = 0; j < col; j++) {
        const e = expRowAt(exps, i, j);
        if (e.k !== 'name') throw new ExprError('bad matrix');
        r.push(e.name);
      }
      names.push(r);
    }
    return { k: 'namemat', line, names, rt: 0 };
  }

  // ---- 优先级链（parseExp7 → parseExp0）----

  private parseExp7(): Node {
    let exp = this.parseExp6();
    let tok: Token | undefined;
    while (this.lx.peekToken().type === 'OR') {
      tok = this.lx.nextToken();
      exp = optimizeLogicalOr(mkBin(tok, 'OR', exp, this.parseExp6()));
    }
    return exp;
  }

  private parseExp6(): Node {
    let exp = this.parseExp5();
    let tok: Token | undefined;
    while (this.lx.peekToken().type === 'AND') {
      tok = this.lx.nextToken();
      exp = optimizeLogicalAnd(mkBin(tok, 'AND', exp, this.parseExp5()));
    }
    return exp;
  }

  private parseExp5(): Node {
    let exp = this.parseExp4();
    let tok: Token | undefined;
    while (isExp5(this.lx.peekToken())) {
      tok = this.lx.nextToken();
      exp = optimizeArithmetic(mkBin(tok, tokTypeAsOp(tok.type), exp, this.parseExp4()));
    }
    return exp;
  }

  private parseExp4(): Node {
    let exp = this.parseExp3();
    let tok: Token | undefined;
    while (isExp4(this.lx.peekToken())) {
      tok = this.lx.nextToken();
      exp = optimizeArithmetic(mkBin(tok, tokTypeAsOp(tok.type), exp, this.parseExp3()));
    }
    return exp;
  }

  private parseExp3(): Node {
    let exp = this.parseExp2();
    let tok: Token | undefined;
    while (isExp3(this.lx.peekToken())) {
      tok = this.lx.nextToken();
      exp = optimizeArithmetic(mkBin(tok, tokTypeAsOp(tok.type), exp, this.parseExp2()));
    }
    return exp;
  }

  private parseExp2(): Node {
    if (isExp2(this.lx.peekToken())) {
      const tok = this.lx.nextToken();
      return optimizeUnary(mkUn(tok, tok.type === 'NOT' ? 'NOT' : 'NEG', this.parseExp2()));
    }
    return this.parseExp1();
  }

  private parseExp1(): Node {
    const exp = this.parseExp0();
    if (this.lx.peekToken().type === 'POW') {
      const tok = this.lx.nextToken();
      return optimizeArithmetic(mkBin(tok, '^', exp, this.parseExp2()));
    }
    return exp;
  }

  private parseExp0(): Node {
    const t = this.lx.peekToken();
    if (t.type === 'LPAREN' || t.type === 'IDENTIFIER') return this.parseAssignOrFunctionCall();
    if (t.type === 'NUMBER') return this.parseNumberExp();
    throw new ExprError('need matrix, function call, assign expression, var, number');
  }

  private parseNumberExp(): Node {
    const tok = this.lx.nextToken('NUMBER');
    if (tok.text.includes('.')) {
      return { k: 'float', line: tok.line, v: Number(tok.text), rt: 7 };
    }
    // Java Integer.parseInt：±2^31 内为 int；溢出 → NumberFormatException → double。
    // 纯数字（无符号）字面量不可能 < -2^31，上限用 2^53 防 JS 精度失真。
    const v = Number(tok.text);
    if (v >= -2147483648 && v <= 2147483647) {
      return { k: 'int', line: tok.line, v, rt: 10 };
    }
    return { k: 'float', line: tok.line, v, rt: 7 };
  }

  private isEnd(t: Token): boolean {
    return t.type === 'EOF' || t.type === 'RPAREN';
  }
}

// ---- 辅助 ----

function expRowAt(rows: Node[][], i: number, j: number): Node {
  // 短行补 0（复刻 Java 解析器对短行的 0 填充：(1,2,,3,4) 的 expRow2 = [3,4]，
  // 展开到 col=4 时 j=2/3 补 IntegerExp(0)，且 0 会令 isInt 保持 true → imat）
  if (j < rows[i].length) return rows[i][j];
  return { k: 'int', line: 0, v: 0, rt: 10 } as Node;
}

function allInt(row: Node[]): boolean {
  for (const e of row) if (e.k !== 'int') return false;
  return true;
}
function allFloat(row: Node[]): boolean {
  for (const e of row) if (e.k !== 'int' && e.k !== 'float') return false;
  return true;
}
function allVar(row: Node[]): boolean {
  for (const e of row) if (e.k !== 'name') return false;
  return true;
}

function isExp5(t: Token): boolean {
  return t.type === 'LT' || t.type === 'LE' || t.type === 'GT' || t.type === 'GE' || t.type === 'EQ' || t.type === 'NEQ';
}
function isExp4(t: Token): boolean {
  return t.type === 'ADD' || t.type === 'MINUS';
}
function isExp3(t: Token): boolean {
  return t.type === 'MUL' || t.type === 'DIV' || t.type === 'MOD';
}
function isExp2(t: Token): boolean {
  return t.type === 'MINUS' || t.type === 'NOT';
}

function tokTypeAsOp(type: string): string {
  switch (type) {
    case 'ADD': return '+';
    case 'MINUS': return '-';
    case 'MUL': return '*';
    case 'DIV': return '/';
    case 'MOD': return '%';
    case 'LT': return '<';
    case 'LE': return '<=';
    case 'GT': return '>';
    case 'GE': return '>=';
    case 'EQ': return '==';
    case 'NEQ': return '!=';
    default: throw new ExprError('bad operator: ' + type);
  }
}

// Java BinOpExp 构造器：MINUS/NEG 归一为 SUB，并预计算静态 returnType
function mkBin(tok: Token, op: string, l: Node, r: Node): Node {
  const lt = l.rt;
  const rt = r.rt;
  const nOp = op === '-' ? '-' : op; // MINUS 已是 '-'
  const node: Node = { k: 'bin', line: tok.line, op: nOp as any, l, r, rt: -1 };
  if (op === 'AND' || op === 'OR') {
    node.rt = 10;
    return node;
  }
  node.rt = binReturnType(op, lt, rt);
  return node;
}

function mkUn(tok: Token, op: 'NEG' | 'NOT', e: Node): Node {
  return { k: 'un', line: tok.line, op, e, rt: e.rt };
}

// ---- 解析期常量折叠（复刻 Optimize）----

function optimizeLogicalOr(exp: Node): Node {
  if (exp.k !== 'bin') return exp;
  const l = exp.l;
  if (trueOnly(l)) return l;
  if (falseOnly(l)) return exp.r;
  return exp;
}

function optimizeLogicalAnd(exp: Node): Node {
  if (exp.k !== 'bin') return exp;
  const l = exp.l;
  if (falseOnly(l)) return l;
  if (trueOnly(l)) return exp.r;
  return exp;
}

function trueOnly(e: Node): boolean {
  if (e.k === 'int') return e.v !== 0;
  if (e.k === 'float') return javaIntCast(e.v) !== 0;
  return false;
}
function falseOnly(e: Node): boolean {
  if (e.k === 'int') return e.v === 0;
  if (e.k === 'float') return javaIntCast(e.v) === 0;
  return false;
}

function optimizeUnary(exp: Node): Node {
  if (exp.k !== 'un') return exp;
  const e = exp.e;
  if (exp.op === 'NEG') {
    if (e.k === 'int') return { k: 'int', line: exp.line, v: (-e.v) | 0, rt: 10 };
    if (e.k === 'float') return { k: 'float', line: exp.line, v: -e.v, rt: 7 };
    if (e.k === 'imat') return { k: 'imat', line: exp.line, r: e.r, c: e.c, d: toFlatMat(e).d as Int32Array, rt: 12 };
    if (e.k === 'fmat') return { k: 'fmat', line: exp.line, r: e.r, c: e.c, d: toFlatMat(e).d as Float64Array, rt: 13 };
  } else if (exp.op === 'NOT') {
    if (e.k === 'int') return { k: 'int', line: exp.line, v: e.v === 0 ? 1 : 0, rt: 10 };
    if (e.k === 'float') return { k: 'float', line: exp.line, v: e.v === 0.0 ? 1.0 : 0.0, rt: 7 };
  }
  return exp;
}

function toFlatMat(e: Node): Mat {
  if (e.k === 'imat') return { isInt: true, r: e.r, c: e.c, d: e.d };
  if (e.k === 'fmat') return { isInt: false, r: e.r, c: e.c, d: e.d };
  throw new ExprError('bad type');
}

function optimizeArithmetic(exp: Node): Node {
  if (exp.k !== 'bin') return exp;
  const { l, r, op } = exp as { l: Node; r: Node; op: string };
  // int op int
  if (l.k === 'int' && r.k === 'int') {
    const iv = foldInt(op, l.v, r.v);
    return iv !== null ? iv : exp;
  }
  // double 混合（int/float 标量）
  if (isNum(l) && isNum(r)) {
    const a = l.k === 'int' ? l.v : l.v;
    const b = r.k === 'int' ? r.v : r.v;
    const dv = foldDouble(op, a, b);
    return dv !== null ? dv : exp;
  }
  // 矩阵常量折叠
  if (l.k === 'imat' || l.k === 'fmat') {
    const lm = toFlatMat(l);
    const res = foldMat(op, lm, r);
    if (res) return res;
  }
  return exp;
}

type NumNode = { k: 'int'; line: number; v: number; rt: TypeTag } | { k: 'float'; line: number; v: number; rt: TypeTag };

function isNum(e: Node): e is NumNode {
  return e.k === 'int' || e.k === 'float';
}

function foldInt(op: string, a: number, b: number): Node | null {
  switch (op) {
    case '+': return { k: 'int', line: 0, v: iadd(a, b), rt: 10 };
    case '-': return { k: 'int', line: 0, v: isub(a, b), rt: 10 };
    case '*': return { k: 'int', line: 0, v: imul(a, b), rt: 10 };
    case '/': return { k: 'int', line: 0, v: intDiv(a, b), rt: 10 };
    case '%': return { k: 'int', line: 0, v: intMod(a, b), rt: 10 };
    case '^':
      if (b >= 0) return { k: 'int', line: 0, v: intPow(a, b), rt: 10 };
      return { k: 'float', line: 0, v: Math.pow(a, b), rt: 7 };
    default: return null;
  }
}

function foldDouble(op: string, a: number, b: number): Node | null {
  switch (op) {
    case '+': return { k: 'float', line: 0, v: a + b, rt: 7 };
    case '-': return { k: 'float', line: 0, v: a - b, rt: 7 };
    case '*': return { k: 'float', line: 0, v: a * b, rt: 7 };
    case '/': return { k: 'float', line: 0, v: a / b, rt: 7 };
    case '%': return { k: 'float', line: 0, v: dmod(a, b), rt: 7 };
    case '^': return { k: 'float', line: 0, v: Math.pow(a, b), rt: 7 };
    default: return null;
  }
}

// 复刻 Optimize.optimizeArithmeticBinaryOp 的矩阵折叠分支：
// int-lmat：±/* / % 配 int/float；^ 仅配 int（matPow，负指数也照折——与 Java while(k!=0) 一致）
// float-lmat：±/* / % 配 int/float；^ 仅配 int；±/* 配 int/float 矩阵
function foldMat(op: string, lm: Mat, r: Node): Node | null {
  if (r.k === 'int' || r.k === 'float') {
    const v = r.v;
    let m: Mat;
    switch (op) {
      case '+': m = matAddS(lm, v); break;
      case '-': m = matSubS(lm, v); break;
      case '*': m = matMulS(lm, v); break;
      case '/': m = matDivS(lm, v); break;
      case '%': m = matModS(lm, v); break;
      case '^':
        if (r.k !== 'int') return null; // ^ 只折 int 指数
        m = matPowM(lm, v);
        break;
      default: return null;
    }
    return toMatNode(m);
  }
  if (r.k === 'imat' || r.k === 'fmat') {
    const rm = toFlatMat(r);
    let m: Mat;
    switch (op) {
      case '+': m = matAddM(lm, rm); break;
      case '-': m = matSubM(lm, rm); break;
      case '*': m = matMulM(lm, rm); break;
      default: return null;
    }
    return toMatNode(m);
  }
  return null;
}

function toMatNode(m: Mat): Node {
  if (m.isInt) return { k: 'imat', line: 0, r: m.r, c: m.c, d: m.d as Int32Array, rt: 12 };
  return { k: 'fmat', line: 0, r: m.r, c: m.c, d: m.d as Float64Array, rt: 13 };
}
