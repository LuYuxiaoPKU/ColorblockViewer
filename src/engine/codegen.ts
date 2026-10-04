// 字节码 codegen 后端（engine/bench.ts 文件头预案）：同一 AST → new Function 单大闭包。
// 闭包后端（compiler.ts）每节点一次函数调用；本后端每表达式一条函数（无节点级
// 调用）。实测（2026-09-29）：bench 中位 17.77 → 14.07 ms/tick（约 1.26×；
// 瓶颈在 Math 内建与 25 字段 struct 访问而非节点级调用，预案 3–5× 未达，
// 见 engine/bench.ts 文件头与 docs/技术路线.md §3）。
// 1:1 语义保证：
//  - 编译期错误与闭包后端同点同消息（镜像 compileNode 结构：call 先
//    hasMathFunc/selectMathSig；bin 矩阵域三守卫；un NOT 对矩阵；assign 逆序
//    store 定型 + can't deconstruction number）——复用 compiler.ts 导出的
//    st/simulate/cmpD/cmpI，类型推断/仿真与闭包后端逐位一致；
//  - 求值顺序与字节码一致：左到右、AND/OR 短路（未求值分支无副作用）、
//    assign 先求全部 RHS 再逆序 store；
//  - 数值原语全部复用 matrix/runtime/mathfuncs 的同一实现（int 回绕、d2i 饱和、
//    dcmpl/dcmpg NaN 语义、矩阵运算/AIOOBE 等）；
//  - 局部变量槽位布局与 compileBlock 完全一致（同序 pin → 同序分配），
//    双后端跑同一 block 产生同一 struct 终值。
// new Function 不可用（CSP）或生成代码编译失败 → 返回 null，调用方回退闭包后端。
// index.html 无 CSP，正常路径走本后端。

import { Node } from './ast';
import { isField, PI, E } from './struct';
import { V, coerce, opMat } from './runtime';
import { Mat, matNeg, toNumber, d2i } from './matrix';
import { isub, intDiv, intMod, matToD, matToI, scalarMat } from './matrix';
import { MATH_SIGS, hasMathFunc, selectMathSig } from './mathfuncs';
import { st, simulate } from './compiler';
import { IntDivByZeroError, ExprError, TypeTag } from './types';

// ---- 运行时表（new Function 参数注入，避免代码串内拼标识符）----

// 函数表：MATH_SIGS 按注册顺序取 fn（代码引用 F[索引]，不拼函数名）
const FNS = MATH_SIGS.map((s) => s.fn);

const PRIM: Record<string, unknown> = {
  isub, intDiv, intMod, // 运行期分派路径（类型不可知）与 int 取反仍走表
  d2i, toNumber, matNeg,
  opMat,
  errDiv0: (z: boolean): number => {
    if (z) throw new IntDivByZeroError();
    return 0;
  },
  isMat: (v: V): boolean => typeof v !== 'number',
  // AND/OR 操作数 → int（与 compiler.asInt 同实现链）
  asInt: (v: V): number => (typeof v === 'number' ? d2i(v) : d2i(toNumber(v))),
  // 类型不可知路径的 coerce（与 runtime.coerce 同源；number 视 7、Mat 视 13）
  coerce: (rt: number, v: V, target: number): V => coerce(rt, v, target),
  matToD, matToI, scalarMat,
  errMatLeft: (): never => {
    throw new ExprError('the number must appear on the right side of the matrix');
  },
};

// ---- 编译上下文（与 compiler.ts Ctx 同序推进）----

interface GCtx {
  vt: Map<string, number>; // 名字 → 定型类型（与 verifyBlock/compileBlock 同序）
  slot: Map<string, number>; // 名字 → 槽位索引（按类型分桶，次序与闭包后端 pin 一致）
  intN: number;
  dblN: number;
  matN: number;
  c: (string | number | Mat)[]; // 常量表（代码引用 c[k]）
  tmp: number;
}

// 数字常量 → 字面量（跳过 c[] 数组访问；int 常量 → d2i 精确值，与运行期
// coerce 结果逐位一致；非常有限值不内联，留在常量表由运行期转换）
const numLit = (ctx: GCtx, v: number, natural: number, target: number): string => {
  if (!Number.isFinite(v)) return wrap(cNum(ctx, v), natural, target);
  if (natural === 10) {
    if (target === 7 || target === -1) return String(v);
    if (target === 10) return String(v | 0);
  }
  if (natural === 7) {
    if (target === 10) return String(d2i(v));
    if (target === 7 || target === -1) return String(v);
  }
  return wrap(cNum(ctx, v), natural, target);
};

const cNum = (ctx: GCtx, v: number): string => {
  ctx.c.push(v);
  return 'c[' + (ctx.c.length - 1) + ']';
};

// double 比较内联（与 compiler.cmpD 同语义：==/!= 的 NaN 走 !== 自然得 0，
// 有序比较先 NaN 判 0；操作数已是 double，无矩阵分支）
const cmpDLit = (op: string, l: string, r: string): string => {
  if (op === '==') return '(' + l + '===' + r + '?1:0)';
  if (op === '!=') return '(' + l + '!==' + r + '?1:0)';
  const sym: Record<string, string> = { '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
  return '(isNaN(' + l + ')||isNaN(' + r + ')?0:(' + l + sym[op] + r + '?1:0))';
};

// int 比较内联（操作数 32 位无 NaN，与 compiler.cmpI 同语义）
const cmpILit = (op: string, l: string, r: string): string => {
  const sym: Record<string, string> = { '<': '<', '<=': '<=', '>': '>', '>=': '>=', '==': '===', '!=': '!=' };
  return '(' + l + sym[op] + r + '?1:0)';
};

// int 四则内联（与 matrix.intDiv/intMod 同语义；/0 抛同一异常类）。
// errDiv0 = 「真 throw、假 return 0」哨兵 → 必须用**逗号表达式**先求它（真则
// throw、假的 0 被丢弃）再算商——**绝不能**用三元 `errDiv0(z)?div:0`：假分支
// 返回的 0 会被当条件恒走 else 返回 0（int 除法恒 0），且缺 else 本身是 JS
// 语法错误。此函数曾两连错（2026-10-05）：
// ① 初版 `errDiv0(z)?(trunc|0)` 缺 else → JS 语法错误 → new Function 抛 →
//    整条表达式静默回退闭包后端（int 除/模 codegen 从未生效）；
// ② 误改成三元补 :0 → int 除法恒返回 0（golden case 305 MIN_VALUE/-1 撞上）。
// 正确形式 = 逗号表达式。另：l/r 可能含副作用（嵌套赋值/字段写），判零与求商
// 都会引用 → 必须各固化一次。两形态：
//  - solid（静态 int 域路径，无 guard，body 是唯一求值点）：自固化 lExpr/rExpr
//  - ref（运行期不可知路径，guard 的 isMat(l)/isMat(r) 已固化 lVar/rVar）：只引用
const intDivSolid = (lv: string, le: string, rv: string, re: string): string =>
  '((((' + lv + '=' + le + '),' + rv + '=' + re + '),M.errDiv0(' + rv + '===0)),(Math.trunc(' + lv + '/' + rv + '))|0)';
const intModSolid = (lv: string, le: string, rv: string, re: string): string =>
  '((((' + lv + '=' + le + '),' + rv + '=' + re + '),M.errDiv0(' + rv + '===0)),(' + lv + '-Math.trunc(' + lv + '/' + rv + ')*' + rv + ')|0)';
const intDivRef = (lv: string, rv: string): string =>
  '(M.errDiv0(' + rv + '===0),(Math.trunc(' + lv + '/' + rv + '))|0)';
const intModRef = (lv: string, rv: string): string =>
  '(M.errDiv0(' + rv + '===0),(' + lv + '-Math.trunc(' + lv + '/' + rv + ')*' + rv + ')|0)';

const cStr = (ctx: GCtx, v: string): string => {
  ctx.c.push(v);
  return 'c[' + (ctx.c.length - 1) + ']';
};

const cMat = (ctx: GCtx, m: Mat): string => {
  ctx.c.push(m);
  return 'c[' + (ctx.c.length - 1) + ']';
};

function pin(ctx: GCtx, name: string, t: number): number {
  const ex = ctx.slot.get(name);
  if (ex !== undefined) return ex;
  let idx: number;
  if (t === 7) idx = ctx.dblN++;
  else if (t === 10) idx = ctx.intN++;
  else if (t === 12 || t === 13) idx = ctx.matN++;
  else throw new ExprError('bad type: ' + t);
  ctx.slot.set(name, idx);
  ctx.vt.set(name, t);
  return idx;
}

const tmpName = (ctx: GCtx): string => 'v' + ctx.tmp++;

// ---- 类型转换（codeGenTypeTransform 的代码形态）----
// target -1 = 原样；0 = POP（只求副作用）；7/10/12/13 = 转换。
// natural 已知时编译期定转换分支；-1 = 运行期按值分派（number 视 7、Mat 视 13，
// 与 runtime.coerceByValue / 闭包后端 wrap 完全一致）。
function wrap(base: string, natural: number, target: number): string {
  const b = '(' + base + ')';
  // target 0 = POP：求值（副作用）后丢弃——由 codegenBlock 用 void() 统一处理，
  // 这里返回自然值表达式（与 target -1 一致）
  if (target === 0) return base;
  if (target === -1 || (natural !== -1 && natural === target)) return base;
  if (natural === -1) {
    if (target === 7) return 'M.coerce(typeof ' + b + '=="number"?7:13,' + b + ',7)';
    if (target === 10) return 'M.coerce(typeof ' + b + '=="number"?7:13,' + b + ',10)';
    if (target === 12) return 'M.coerce(typeof ' + b + '=="number"?7:13,' + b + ',12)';
    if (target === 13) return 'M.coerce(typeof ' + b + '=="number"?7:13,' + b + ',13)';
    return b;
  }
  if (natural === 10 && target === 7) return b; // i2d 精确
  if (natural === 7 && target === 10) return 'M.d2i(' + b + ')';
  if ((natural === 12 || natural === 13) && target === 7) return 'M.toNumber(' + b + ')';
  if (natural === 13 && target === 10) return 'M.d2i(M.toNumber(' + b + '))';
  if (natural === 12 && target === 10) return 'M.toNumber(' + b + ')';
  if ((natural === 10 || natural === 7) && target === 12) return 'M.scalarMat(true,' + b + ')';
  if ((natural === 10 || natural === 7) && target === 13) return 'M.scalarMat(false,' + b + ')';
  if (natural === 12 && target === 13) return 'M.matToD(' + b + ')';
  if (natural === 13 && target === 12) return 'M.matToI(' + b + ')';
  // 其余组合 = bad type（与 coerce 同消息）
  return 'M.coerce(' + natural + ',' + b + ',' + target + ')';
}

const isCmp = (op: string): boolean =>
  op === '<' || op === '<=' || op === '>' || op === '>=' || op === '==' || op === '!=';

// ---- 节点 → 代码串（镜像 compileNode 的编译期错误时机）----

function emitNode(ctx: GCtx, n: Node, target: number): string {
  switch (n.k) {
    case 'int':
      return numLit(ctx, n.v, 10, target);
    case 'float':
      return numLit(ctx, n.v, 7, target);
    case 'imat': {
      const m: Mat = { isInt: true, r: n.r, c: n.c, d: n.d };
      return wrap(cMat(ctx, m), 12, target);
    }
    case 'fmat': {
      const m: Mat = { isInt: false, r: n.r, c: n.c, d: n.d };
      return wrap(cMat(ctx, m), 13, target);
    }
    case 'name': {
      if (isField(n.name)) return wrap('s.' + n.name, 7, target);
      if (n.name === 'PI') return wrap('cP', 7, target);
      if (n.name === 'E') return wrap('cE', 7, target);
      const t = ctx.vt.get(n.name);
      const idx = ctx.slot.get(n.name);
      if (t === undefined || idx === undefined) throw new ExprError('undefine var: ' + n.name);
      const base = t === 7 ? 'Ld[' + idx + ']' : t === 10 ? 'Li[' + idx + ']' : 'Lm[' + idx + ']';
      return wrap(base, t, target);
    }
    case 'un': return emitUn(ctx, n, target);
    case 'bin': return emitBin(ctx, n, target);
    case 'call': return emitCall(ctx, n, target);
    case 'mat': return emitMatrix(ctx, n.rows, target);
    case 'namemat': {
      // 元素名 → 直接 emitName（自然 7）
      const rows: Node[][] = n.names.map((row) => row.map((nm) => ({ k: 'name' as const, line: 0, name: nm, rt: -1 as const })));
      return emitMatrix(ctx, rows, target);
    }
    case 'assign': return emitAssign(ctx, n, target);
  }
}

function emitMatrix(ctx: GCtx, rows: Node[][], target: number): string {
  // codeGenLoadMatrix：逐元素 target 7，恒 [[D（与闭包后端同款实现）
  const R = rows.length, C = rows[0].length;
  const el: string[] = new Array(R * C);
  let o = 0;
  for (const row of rows) for (const e of row) el[o++] = emitNode(ctx, e, 7);
  const t = tmpName(ctx);
  const body =
    '(' + t + '={isInt:false,r:' + R + ',c:' + C + ',d:new Float64Array(' + R * C + ')},' +
    'function(){var o=0;var d=' + t + '.d;' +
    el.map((e) => 'd[o++]=' + e).join(';') +
    ';return ' + t + '}())';
  return wrap(body, 13, target);
}

function emitUn(ctx: GCtx, n: Extract<Node, { k: 'un' }>, target: number): string {
  const e = emitNode(ctx, n.e, -1);
  const t = st(n.e, ctx.vt);
  const op = n.op;
  let body: string;
  if (t === 7) {
    if (op === 'NOT') body = '(' + e + '===0?1.0:0.0)';
    else body = '(-(' + e + '))';
  } else if (t === 10) {
    if (op === 'NOT') body = '(' + e + '===0?1:0)';
    else body = '(M.isub(0,' + e + ')|0)';
  } else if (t === 12 || t === 13) {
    if (op === 'NOT') throw new ExprError('bad type');
    body = 'M.matNeg(' + e + ')';
  } else if (op === 'NEG') {
    body = '(typeof ' + e + '=="number"?-(' + e + '):M.matNeg(' + e + '))';
  } else {
    body = '(typeof ' + e + '=="number"?(' + e + '===0?1:0):M.errMatLeft())';
  }
  return wrap(body, t, target);
}

function emitCall(ctx: GCtx, n: Extract<Node, { k: 'call' }>, target: number): string {
  // codeGenFunctionCallExp 时序：① 名字+个数 ② rt==-1 实参仿真 ③ 打分 ④ codegen 实参
  if (!hasMathFunc(n.name, n.args.length)) throw new ExprError('function not found: ' + n.name);
  const argTypes: TypeTag[] = n.args.map((a) => {
    if (a.k === 'namemat') return 0 as TypeTag;
    const t = st(a, ctx.vt);
    return t === -1 ? (simulate(a, ctx.vt) as TypeTag) : (t as TypeTag);
  });
  const sig = selectMathSig(n.name, argTypes);
  if (!sig) throw new ExprError('function not found: ' + n.name);
  const params = sig.params, ret = sig.ret;
  const args = n.args.map((a, j) => emitNode(ctx, a, params[j] === 'I' ? 10 : 7));
  const idx = MATH_SIGS.indexOf(sig);
  let body: string;
  if (args.length === 0) body = 'F[' + idx + ']()';
  else if (args.length === 1) body = 'F[' + idx + '](' + args[0] + ')';
  else body = 'F[' + idx + '](' + args[0] + ',' + args[1] + ')';
  const inner = ret === 10 ? '(' + body + '|0)' : body;
  return wrap(inner, ret, target);
}

function emitBin(ctx: GCtx, n: Extract<Node, { k: 'bin' }>, target: number): string {
  const op = n.op;
  if (op === 'AND' || op === 'OR') {
    const tl = tmpName(ctx), tr = tmpName(ctx);
    const lc = emitNode(ctx, n.l, -1), rc = emitNode(ctx, n.r, -1);
    const l = '(' + tl + '=' + lc + ')', r = '(' + tr + '=' + rc + ')';
    const body = op === 'AND'
      ? 'M.asInt(' + l + ')===0?0:(M.asInt(' + r + ')===0?0:1)'
      : 'M.asInt(' + l + ')!==0?1:(M.asInt(' + r + ')!==0?1:0)';
    return wrap(body, 10, target);
  }
  const t = st(n, ctx.vt);
  if (t === 7) {
    const tl = tmpName(ctx), tr = tmpName(ctx);
    const lc = emitNode(ctx, n.l, 7), rc = emitNode(ctx, n.r, 7);
    const l = '(' + tl + '=' + lc + ')', r = '(' + tr + '=' + rc + ')';
    let body: string;
    if (isCmp(op)) {
      body = cmpDLit(op, l, r);
    } else {
      switch (op) {
        case '+': body = l + '+' + r; break;
        case '-': body = l + '-' + r; break;
        case '*': body = l + '*' + r; break;
        case '/': body = l + '/' + r; break;
        case '%': body = l + '%' + r; break;
        case '^': body = 'Math.pow(' + l + ',' + r + ')'; break;
        default: throw new ExprError('bad operator: ' + op);
      }
    }
    return wrap(body, isCmp(op) ? 10 : 7, target);
  }
  if (t === 10) {
    const tl = tmpName(ctx), tr = tmpName(ctx);
    const lc = emitNode(ctx, n.l, 10), rc = emitNode(ctx, n.r, 10);
    const l = '(' + tl + '=' + lc + ')', r = '(' + tr + '=' + rc + ')';
    let body: string;
    if (isCmp(op)) {
      body = cmpILit(op, l, r);
    } else {
      switch (op) {
        case '+': body = '(' + l + '+' + r + ')|0'; break;
        case '-': body = '(' + l + '-' + r + ')|0'; break;
        case '*': body = 'Math.imul(' + l + ',' + r + ')'; break;
        case '/': body = intDivSolid(tl, lc, tr, rc); break;
        case '%': body = intModSolid(tl, lc, tr, rc); break;
        case '^': body = 'Math.pow(' + l + ',' + r + ')'; break; // (II)D
        default: throw new ExprError('bad operator: ' + op);
      }
    }
    return wrap(body, isCmp(op) ? 10 : (op === '^' ? 7 : 10), target);
  }
  if (t === 12 || t === 13) {
    // 矩阵域（与 compileBin 同守卫、同错误时机）
    const lt = st(n.l, ctx.vt), rt = st(n.r, ctx.vt);
    if (lt === 7 || lt === 10) throw new ExprError('the number must appear on the right side of the matrix');
    if ((op === '/' || op === '%') && (rt === 12 || rt === 13)) throw new ExprError('bad operator: ' + op);
    if (op === '^' && rt !== 10) throw new ExprError('bad operator: ' + op);
    const tl = tmpName(ctx), tr = tmpName(ctx);
    const lc = emitNode(ctx, n.l, -1), rc = emitNode(ctx, n.r, -1);
    const l = '(' + tl + '=' + lc + ')', r = '(' + tr + '=' + rc + ')';
    const opC = cStr(ctx, op);
    return wrap('M.opMat(' + opC + ',' + l + ',' + r + ')', t === 13 ? 13 : 12, target);
  }
  // 类型不可知：运行期分派（镜像 compileBin 末段：左矩阵 → opMat 全接管；
  // 右矩阵 + 标量左 → the number must appear...；双标量按静态 int 域分派）
  const tl = tmpName(ctx), tr = tmpName(ctx);
  const lc = emitNode(ctx, n.l, -1), rc = emitNode(ctx, n.r, -1);
  // 左先求值（l 内含赋值），右仅标量路径才求值（r 内含赋值）——顺序与
  // 闭包后端 compileBin 末段一致
  const l = '(' + tl + '=' + lc + ')', r = '(' + tr + '=' + rc + ')';
  const aIntStatic = st(n.l, ctx.vt) === 10, bIntStatic = st(n.r, ctx.vt) === 10;
  const opC = cStr(ctx, op);
  let body: string;
  if (aIntStatic && bIntStatic) {
    switch (op) {
      case '<': case '<=': case '>': case '>=': case '==': case '!=':
        body = cmpILit(op, tl, tr); break;
      case '+': body = '(' + tl + '+' + tr + ')|0'; break;
      case '-': body = '(' + tl + '-' + tr + ')|0'; break;
      case '*': body = 'Math.imul(' + tl + ',' + tr + ')'; break;
      case '/': body = intDivRef(tl, tr); break; // l/r 已由 guard 的 isMat 赋值，只引用临时变量
      case '%': body = intModRef(tl, tr); break;
      case '^': body = 'Math.pow(' + tl + ',' + tr + ')'; break;
      default: throw new ExprError('bad operator: ' + op);
    }
  } else {
    switch (op) {
      case '<': case '<=': case '>': case '>=': case '==': case '!=':
        body = cmpDLit(op, tl, tr); break;
      case '+': body = tl + '+' + tr; break;
      case '-': body = tl + '-' + tr; break;
      case '*': body = tl + '*' + tr; break;
      case '/': body = tl + '/' + tr; break;
      case '%': body = tl + '%' + tr; break;
      case '^': body = 'Math.pow(' + tl + ',' + tr + ')'; break;
      default: throw new ExprError('bad operator: ' + op);
    }
  }
  const guard =
    'M.isMat(' + l + ')?M.opMat(' + opC + ',' + tl + ',' + r + '):' +
    'M.isMat(' + r + ')?M.errMatLeft():' + body;
  return wrap(guard, -1, target);
}

function emitAssign(ctx: GCtx, n: Extract<Node, { k: 'assign' }>, target: number): string {
  // codeGenAssignExp 时序：① 逐 RHS ② 类型定型 ③ 逆序 can't deconstruction 检查
  // ④ 逆序 store 定型（addLocalVar 次序）——与 compileAssign 一致
  const m = n.exps.length;
  const rhs = n.exps.map((e) => emitNode(ctx, e, -1));
  const types: number[] = new Array(m);
  for (let i = 0; i < m; i++) {
    let t = st(n.exps[i], ctx.vt);
    if (t === -1 || t === 0) t = simulate(n.exps[i], ctx.vt);
    types[i] = t;
  }
  for (let i = m - 1; i >= 0; i--) {
    const v = n.vars[i];
    if (v.k === 'namemat' && (types[i] !== 12 && types[i] !== 13)) {
      throw new ExprError("can't deconstruction number: " + types[i]);
    }
  }
  // store 定型（逆序，addLocalVar 次序）；同时算出每个目标的定型/槽位
  const slots: { arr: string; idx: number; t: number }[] = new Array(m);
  const nameSlots: { nm: string; arr: string; idx: number; t: number }[] = [];
  for (let i = m - 1; i >= 0; i--) {
    const v = n.vars[i];
    if (v.k === 'name') {
      if (!isField(v.name)) {
        if (!ctx.vt.has(v.name)) pin(ctx, v.name, types[i]);
        const t = ctx.vt.get(v.name) as number;
        const idx = ctx.slot.get(v.name) as number;
        slots[i] = { arr: t === 7 ? 'Ld' : t === 10 ? 'Li' : 'Lm', idx, t };
      }
    } else {
      const elT = types[i] === 12 ? 10 : 7;
      for (const row of v.names) for (const nm of row) {
        if (!isField(nm)) {
          if (!ctx.vt.has(nm)) pin(ctx, nm, elT);
          const t = ctx.vt.get(nm) as number;
          const idx = ctx.slot.get(nm) as number;
          nameSlots.push({ nm, arr: t === 7 ? 'Ld' : t === 10 ? 'Li' : 'Lm', idx, t });
        }
      }
    }
  }
  const tv = tmpName(ctx);
  const stores: string[] = new Array(m);
  for (let i = m - 1; i >= 0; i--) {
    const v = n.vars[i];
    const val = tv + '[' + i + ']';
    if (v.k === 'name') {
      if (isField(v.name)) {
        stores[i] = 's.' + v.name + '=' + wrap(val, types[i], 7) + ';';
      } else {
        const sl = slots[i];
        stores[i] = sl.arr + '[' + sl.idx + ']=' + wrap(val, types[i], sl.t) + ';';
      }
    } else {
      const C = v.names[0].length;
      const elT = types[i] === 12 ? 10 : 7;
      const parts: string[] = [];
      let p = 0;
      for (let j = 0; j < v.names.length; j++) {
        for (let k = 0; k < C; k++) {
          const nm = v.names[j][k];
          const ve = tv + '[' + i + '].d[' + (j * C + k) + ']';
          if (isField(nm)) {
            parts.push('s.' + nm + '=' + wrap(ve, elT, 7));
          } else {
            const sl = nameSlots[p++];
            parts.push(sl.arr + '[' + sl.idx + ']=' + wrap(ve, elT, sl.t));
          }
        }
      }
      stores[i] = parts.join(';') + ';';
    }
  }
  // 赋值 = IIFE 表达式（逗号表达式内不能有 ;，块内语句合法）：
  // 先求全部 RHS（tv 数组，左到右），再逆序 store，末条语句返回 tv[m-1]
  const body =
    '(()=>{var ' + tv + '=[' + rhs.join(',') + '];' +
    stores.join('') +
    (target !== 0 ? 'return ' + tv + '[' + (m - 1) + '];' : '') +
    '})()';
  // 返回值按最后 RHS 自然类型转换（ireturn = coerce(natural, 10) 等，
  // 与闭包后端 wrap(core, lastT, target) 一致）
  return wrap(body, types[m - 1], target);
}

// ---- 整块 → 可执行闭包 ----

export function codegenBlock(block: Node[]): ((s: unknown) => number) | null {
  if (block.length === 0) return null; // 空块由 parse 层 AioobeError 覆盖（与闭包后端一致）
  const ctx: GCtx = {
    vt: new Map(),
    slot: new Map(),
    intN: 0, dblN: 0, matN: 0,
    c: [],
    tmp: 0,
  };
  try {
    const last = block.length - 1;
    const stmts = block.map((stmt, i) => emitNode(ctx, stmt, i === last ? 10 : 0));
    const { intN, dblN, matN } = ctx;
    // 语句 0..n-2 只求副作用（void 丢弃产物），末条以返回值 = ireturn
    const head = stmts
      .slice(0, last)
      .map((s) => 'void(' + s + ');')
      .join('');
    const body =
      'var Li=new Array(' + intN + '),Ld=new Array(' + dblN + '),Lm=new Array(' + matN + ');' +
      'for(var i=0;i<Li.length;i++)Li[i]=0;' +
      'for(var i=0;i<Ld.length;i++)Ld[i]=0;' +
      'for(var i=0;i<Lm.length;i++)Lm[i]=null;' +
      head +
      'return (' + stmts[last] + ');';
    const fn = new Function('s', 'c', 'F', 'M', 'cP', 'cE', body);
    return (s: unknown): number => fn(s, ctx.c as unknown as string[], FNS, PRIM, PI, E);
  } catch (e) {
    // 编译期错误（ExprError）：闭包后端在 compileBlock 同样点抛出，parse 层
    // 会缓存「run 时抛出」的 throwing block（错误延迟到 invoke 期，对 UI 透明）。
    // 本后端同样延迟：返回一个 run 时才抛的闭包，保证 parse 层行为一致
    // （也保证双后端对拍时错误在 run 期可比对）。
    if (e instanceof ExprError) {
      return (): number => { throw e; };
    }
    // 仅 new Function 不可用/生成代码非法时回退闭包后端
    return null;
  }
}
