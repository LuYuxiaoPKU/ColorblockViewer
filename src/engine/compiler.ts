// 闭包编译后端：AST → 每节点一个小闭包 ((s, env, target) => V)。
// 与 CodeGen 字节码 1:1 对齐的要点：
//  - 节点闭包带 target（= codeGenTypeTransform 的目标类型）：名字加载/字面量按
//    target 做编译期类型转换（如 int 变量在 double 域被 i2d，int 常量烘焙成
//    double），与字节码的 transform 指令逐字一致；
//  - 静态类型已知时类型分派在编译期消除（字段读直接 s.x，int 常量烘焙，
//    局部变量槽位索引编译期固定）；
//  - int 32 位回绕（iadd/isub/imul/intDiv/intMod）；double 比较复刻 dcmpl/dcmpg
//    与 if* 组合（NaN 参与任何有序/相等比较 → 0，NaN!=NaN → 1，Probe28 实测）；
//  - 局部变量 = 块级槽位数组，首次 store 定型（addLocalVar 语义，逆序 store
//    次序与字节码一致），跨 invoke 复用、每次 run 前清零（Java 方法局部初值）；
//  - 解析期错误时机与 CodeGen 一致（function not found → 实参仿真 → 打分
//    "bad type: N"；undefine var / bad type / bad operator / can't deconstruction
//    number / the number must appear... 在编译时抛出）；运行期错误由
//    runtime/matrix 原语抛出（/ by zero、AIOOBE 等），消息逐字复刻。
// 求值顺序与字节码完全一致：左到右、AND/OR 短路（未求值分支无副作用）、
// assign 先求全部 RHS（target -1）再逆序 store。

import { Node } from './ast';
import { ParticleStruct, isField, PI, E } from './struct';
import { V, coerce, opMat } from './runtime';
import { Mat, matNeg, toNumber, d2i } from './matrix';
import { iadd, isub, imul, intDiv, intMod } from './matrix';
import { hasMathFunc, selectMathSig, MathSig } from './mathfuncs';
import { ExprError, TypeTag } from './types';

export interface Env {
  struct: ParticleStruct;
  intLoc: number[];
  dblLoc: number[];
  matLoc: (Mat | null)[];
}

export type C = (s: ParticleStruct, env: Env, target: number) => V;

// 字段读取（编译期烘焙为直接属性访问，等价 getfield D）
const FIELD_GETTERS: Record<string, (s: ParticleStruct) => number> = {
  x: (s) => s.x, y: (s) => s.y, z: (s) => s.z,
  s1: (s) => s.s1, s2: (s) => s.s2, dis: (s) => s.dis,
  t: (s) => s.t,
  cr: (s) => s.cr, cg: (s) => s.cg, cb: (s) => s.cb, alpha: (s) => s.alpha,
  vx: (s) => s.vx, vy: (s) => s.vy, vz: (s) => s.vz,
  cx: (s) => s.cx, cy: (s) => s.cy, cz: (s) => s.cz,
  dx: (s) => s.dx, dy: (s) => s.dy, dz: (s) => s.dz,
  ds1: (s) => s.ds1, ds2: (s) => s.ds2, ddis: (s) => s.ddis,
  age: (s) => s.age, destroy: (s) => s.destroy,
};

// ---- 局部变量布局（每块独立；复刻 CodeGen.localVars 首次 store 定型）----
interface Locals {
  type: Map<string, number>; // 名字 → 定型类型（7/10/12/13）
  slot: Map<string, number>; // 名字 → 槽位索引（按类型数组分桶）
  intN: number;
  dblN: number;
  matN: number;
}

function pin(locals: Locals, name: string, t: number): void {
  if (locals.type.has(name)) return; // 已定型
  if (t === 7) { locals.slot.set(name, locals.dblN++); }
  else if (t === 10) { locals.slot.set(name, locals.intN++); }
  else if (t === 12 || t === 13) { locals.slot.set(name, locals.matN++); }
  else throw new ExprError('bad type: ' + t);
  locals.type.set(name, t);
}

interface Ctx {
  vt: Map<string, number>; // 名字 → 静态类型（与 verifyBlock 同序推进）
  locals: Locals;
}

// 静态类型推断（与 index.ts staticTypeOf 同款规则；-1 = 需运行期判定）
function st(n: Node, vt: Map<string, number>): number {
  if (n.k === 'int') return 10;
  if (n.k === 'float') return 7;
  if (n.k === 'imat') return 12;
  if (n.k === 'fmat') return 13;
  if (n.k === 'mat') return 13;
  if (n.k === 'namemat') return 13;
  if (n.k === 'bin') {
    if (n.op === 'AND' || n.op === 'OR') return 10;
    const lt = st(n.l, vt), rt = st(n.r, vt);
    if (lt === -1 || rt === -1) return -1;
    if (lt === 10 && rt === 10) return n.op === '^' ? 7 : 10;
    if ((lt !== 10 || rt !== 7) && (lt !== 7 || rt !== 10) && (lt !== 7 || rt !== 7)) {
      return lt === 12 && (rt === 10 || rt === 12) ? 12 : 13;
    }
    return 7;
  }
  if (n.k === 'name') {
    if (isField(n.name) || n.name === 'PI' || n.name === 'E') return 7;
    return vt.get(n.name) ?? -1;
  }
  if (n.k === 'un') return st(n.e, vt);
  if (n.k === 'assign') return st(n.exps[n.exps.length - 1], vt);
  return -1; // call
}

// startSimulation 复刻（类型求值；可抛 codegen 错误，时机与 Java 一致）
function simulate(n: Node, vt: Map<string, number>): number {
  if (n.k === 'int') return 10;
  if (n.k === 'float') return 7;
  if (n.k === 'imat') return 12;
  if (n.k === 'fmat') return 13;
  if (n.k === 'mat') return 13;
  if (n.k === 'namemat') return 13;
  if (n.k === 'bin') {
    const lt = simulate(n.l, vt), rt = simulate(n.r, vt);
    if (Math.max(lt, rt) <= 0) throw new ExprError('bad type');
    if (lt === 10 && rt === 10) return 10;
    return (lt !== 10 || rt !== 7) && (lt !== 7 || rt !== 10) && (lt !== 7 || rt !== 7) ? -1 : 7;
  }
  if (n.k === 'un') {
    const t = simulate(n.e, vt);
    if (n.op === 'NOT' && (t === 12 || t === 13)) throw new ExprError('bad type');
    if (t === 12 || t === 13 || t === 7 || t === 10) return t;
    throw new ExprError('bad type');
  }
  if (n.k === 'call') {
    if (!hasMathFunc(n.name, n.args.length)) throw new ExprError('function not found: ' + n.name);
    const argTypes = n.args.map((a) => (a.k === 'namemat' ? (0 as TypeTag) : (simulate(a, vt) as TypeTag)));
    const sig = selectMathSig(n.name, argTypes);
    if (!sig) throw new ExprError('function not found: ' + n.name);
    return sig.ret;
  }
  if (n.k === 'name') {
    if (isField(n.name) || n.name === 'PI' || n.name === 'E') return 7;
    const t = vt.get(n.name);
    if (t === undefined) throw new ExprError('undefine var: ' + n.name);
    return t;
  }
  if (n.k === 'assign') return simulate(n.exps[n.exps.length - 1], vt);
  return -1;
}

// codeGenTypeTransform 的编译期形态：按 target 转换节点闭包的产物。
// target -1 = 原样；0 = void 上下文（Java：POP 丢弃，只求副作用）；
// 7/10/12/13 = 类型转换。
function wrap(base: C, natural: number, target: number): C {
  if (target === 0) {
    // POP：求值（副作用）后丢弃
    return (s, env) => { base(s, env, -1); return 0; };
  }
  if (target === -1 || (natural !== -1 && natural === target)) return base;
  return (s, env, t) => coerce(natural, base(s, env, -1), t);
}

/**
 * 编译整块。先干跑（RHS 定型 + 逆序 store 首次定型，复刻 addLocalVar 的槽位
 * 分配次序），再编译各语句。语句 0..n-2 target 0（只求副作用），
 * 最后一条 target 10（ireturn）。
 */
export function compileBlock(block: Node[]): (s: ParticleStruct) => number {
  const vt = new Map<string, number>();
  const locals: Locals = { type: new Map(), slot: new Map(), intN: 0, dblN: 0, matN: 0 };
  const ctx: Ctx = { vt, locals };
  // 语句按字节码顺序逐条 codegen（嵌套赋值随 RHS 编译就地定型，次序与
  // Java codeGenAssignExp 一致）。读名字解析当前已定型的局部；未定型 →
  // "undefine var"（codeGenNameExp 时序）。
  const last = block.length - 1;
  const fns: C[] = block.map((stmt, i) => compileNode(stmt, ctx, i === last ? 10 : 0));
  const { intN, dblN, matN } = locals;
  // 槽位数组跨 invoke 复用（顺序执行、无重入），每次 run 前清零
  const intLoc = new Array<number>(intN).fill(0);
  const dblLoc = new Array<number>(dblN).fill(0);
  const matLoc = new Array<Mat | null>(matN).fill(null);
  const env: Env = { struct: null as unknown as ParticleStruct, intLoc, dblLoc, matLoc };
  return (s: ParticleStruct): number => {
    env.struct = s;
    for (let i = 0; i < intLoc.length; i++) intLoc[i] = 0;
    for (let i = 0; i < dblLoc.length; i++) dblLoc[i] = 0;
    for (let i = 0; i < matLoc.length; i++) matLoc[i] = null;
    for (let i = 0; i < last; i++) fns[i](s, env, 0);
    return fns[last](s, env, 10) as number;
  };
}

function compileNode(n: Node, ctx: Ctx, target: number): C {
  const { vt, locals } = ctx;
  switch (n.k) {
    // 字面量：自然类型（10/7/12/13）下产原生值；target 由 wrap 统一转换
    // （Java codeGenTypeTransform 与 emit 等价：imat→7 烘焙 toNumber；
    //  fmat→10 烘焙 (int)toNumber；7/12→12/13 走 toMat；13→10 = toNumber+d2i）
    case 'int': {
      const v = n.v;
      const base: C = () => v;
      return wrap(base, 10, target);
    }
    case 'float': {
      const v = n.v;
      const base: C = () => v;
      return wrap(base, 7, target);
    }
    case 'imat': {
      const m: Mat = { isInt: true, r: n.r, c: n.c, d: n.d };
      const base: C = () => m;
      return wrap(base, 12, target);
    }
    case 'fmat': {
      const m: Mat = { isInt: false, r: n.r, c: n.c, d: n.d };
      const base: C = () => m;
      return wrap(base, 13, target);
    }
    case 'name': {
      if (isField(n.name)) {
        const fn = FIELD_GETTERS[n.name];
        const base: C = (s) => fn(s) as number;
        return wrap(base, 7, target);
      }
      if (n.name === 'PI' || n.name === 'E') {
        const v = n.name === 'PI' ? PI : E;
        const base: C = () => v;
        return wrap(base, 7, target);
      }
      // 局部变量（codeGenNameExp：读时未定型 → undefine var；正常路径读前
      // 必先 store 定型。verifyBlock ① 已先行拦截，这里是编译期兜底）
      const t = locals.type.get(n.name);
      const idx = locals.slot.get(n.name);
      if (t === undefined || idx === undefined) throw new ExprError('undefine var: ' + n.name);
      // 槽位数组按类型分桶：7→dblLoc / 10→intLoc / 12|13→matLoc
      const base: C =
        t === 7 ? (_s, env) => env.dblLoc[idx] as number :
        t === 10 ? (_s, env) => env.intLoc[idx] as number :
        (_s, env) => env.matLoc[idx] as Mat;
      return wrap(base, t, target);
    }
    case 'un': {
      // Java codeGenUnopExp：先 codeGenExp(exp, -1)（运行期返回自然类型），
      // 按返回类型分派（7→dneg；10→ineg；12/13→matNeg；其余→"bad type"）。
      // 自然类型经 st 静态已知时编译期定分派，不可知（-1）时运行期分派。
      const e = compileNode(n.e, ctx, -1);
      const t = st(n.e, vt);
      const op = n.op;
      let inner: C;
      if (t === 7) {
        if (op === 'NOT') inner = (s, env) => { const v = e(s, env, -1) as number; return v === 0 ? 1.0 : 0.0; };
        else inner = (s, env) => -(e(s, env, -1) as number);
      } else if (t === 10) {
        if (op === 'NOT') inner = (s, env) => { const v = e(s, env, -1) as number; return v === 0 ? 1 : 0; };
        else inner = (s, env) => isub(0, e(s, env, -1) as number);
      } else if (t === 12 || t === 13) {
        if (op === 'NOT') throw new ExprError('bad type');
        inner = (s, env) => matNeg(e(s, env, -1) as Mat);
      } else {
        // 类型不可知（-1）：运行期分派（NOT 对矩阵 → "bad type"，
        // 消息与 Java codeGenUnopExp 的 default 分支一致）
        if (op === 'NEG') {
          inner = (s, env) => { const v = e(s, env, -1); return typeof v === 'number' ? -v : matNeg(v); };
        } else {
          inner = (s, env) => { const v = e(s, env, -1); if (typeof v === 'number') return v === 0 ? 1 : 0; throw new ExprError('bad type'); };
        }
      }
      return wrap(inner, t, target);
    }
    case 'bin': return compileBin(n, ctx, target);
    case 'call': return compileCall(n, ctx, target);
    case 'mat': {
      // codeGenLoadMatrix：逐元素 codeGenExp(elem, 7)，恒 [[D
      const rows = n.rows.map((row) => row.map((e) => compileNode(e, ctx, 7)));
      const R = n.rows.length, C = n.rows[0].length;
      const inner: C = (s, env) => {
        const d = new Float64Array(R * C);
        let o = 0;
        for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) d[o++] = rows[i][j](s, env, 7) as number;
        return { isInt: false, r: R, c: C, d } as Mat;
      };
      return wrap(inner, 13, target);
    }
    case 'namemat': {
      // codeGenLoadMatrix(names)：恒 [[D
      const rows = n.names.map((row) => row.map((nm) => compileNameNode(nm, ctx, 7)));
      const R = n.names.length, C = n.names[0].length;
      const inner: C = (s, env) => {
        const d = new Float64Array(R * C);
        let o = 0;
        for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) d[o++] = rows[i][j](s, env, 7) as number;
        return { isInt: false, r: R, c: C, d } as Mat;
      };
      return wrap(inner, 13, target);
    }
    case 'assign': return compileAssign(n, ctx, target);
  }
}

function compileNameNode(name: string, ctx: Ctx, target: number): C {
  return compileNode({ k: 'name', line: 0, name, rt: -1 }, ctx, target);
}

// ---- double 域比较（dcmpl/dcmpg + if*；Probe28：NaN 有序/相等比较恒 0）----
function cmpD(op: string, a: number, b: number): number {
  const nan = isNaN(a) || isNaN(b);
  switch (op) {
    case '<': return nan ? 0 : a < b ? 1 : 0;
    case '<=': return nan ? 0 : a <= b ? 1 : 0;
    case '>': return nan ? 0 : a > b ? 1 : 0;
    case '>=': return nan ? 0 : a >= b ? 1 : 0;
    case '==': return a === b ? 1 : 0;
    case '!=': return a !== b ? 1 : 0;
  }
  throw new ExprError('bad operator: ' + op);
}

function cmpI(op: string, a: number, b: number): number {
  switch (op) {
    case '<': return a < b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    case '>': return a > b ? 1 : 0;
    case '>=': return a >= b ? 1 : 0;
    case '==': return a === b ? 1 : 0;
    case '!=': return a !== b ? 1 : 0;
  }
  throw new ExprError('bad operator: ' + op);
}

// AND/OR 操作数 → int（Java：codeGenExp(op, 10) 即 codeGenTypeTransform(自然类型, 10)；
// 矩阵 → toNumber(,d2i)，标量 → 原值/(int)窄化。运行期按实际值分派，
// 覆盖静态 st 不可知（如未定型变量）的情形）
function asInt(v: V): number {
  return typeof v === 'number' ? d2i(v) : d2i(toNumber(v));
}

function isCmp(op: string): boolean {
  return op === '<' || op === '<=' || op === '>' || op === '>=' || op === '==' || op === '!=';
}

function compileBin(n: Extract<Node, { k: 'bin' }>, ctx: Ctx, target: number): C {
  const { vt } = ctx;
  const op = n.op;
  if (op === 'AND' || op === 'OR') {
    // 字节码：l 转 int，ifeq(AND)/ifne(OR) 短路；否则 r 转 int 同判定。
    // 短路分支不求值（无副作用，Probe29）。操作数 target -1 + 运行期 asInt。
    const l = compileNode(n.l, ctx, -1), r = compileNode(n.r, ctx, -1);
    if (op === 'AND') {
      const inner: C = (s, env) => {
        if (asInt(l(s, env, -1)) === 0) return 0; // 短路：r 不求值
        return asInt(r(s, env, -1)) === 0 ? 0 : 1;
      };
      return wrap(inner, 10, target);
    }
    const inner: C = (s, env) => {
      if (asInt(l(s, env, -1)) !== 0) return 1; // 短路：r 不求值
      return asInt(r(s, env, -1)) !== 0 ? 1 : 0;
    };
    return wrap(inner, 10, target);
  }
  const t = st(n, vt);
  if (t === 7) {
    const l = compileNode(n.l, ctx, 7), r = compileNode(n.r, ctx, 7);
    let inner: C;
    if (isCmp(op)) {
      inner = (s, env) => cmpD(op, l(s, env, 7) as number, r(s, env, 7) as number);
    } else {
      switch (op) {
        case '+': inner = (s, env) => (l(s, env, 7) as number) + (r(s, env, 7) as number); break;
        case '-': inner = (s, env) => (l(s, env, 7) as number) - (r(s, env, 7) as number); break;
        case '*': inner = (s, env) => (l(s, env, 7) as number) * (r(s, env, 7) as number); break;
        case '/': inner = (s, env) => (l(s, env, 7) as number) / (r(s, env, 7) as number); break;
        case '%': inner = (s, env) => (l(s, env, 7) as number) % (r(s, env, 7) as number); break;
        case '^': inner = (s, env) => Math.pow(l(s, env, 7) as number, r(s, env, 7) as number); break;
        default: throw new ExprError('bad operator: ' + op);
      }
    }
    return wrap(inner, isCmp(op) ? 10 : 7, target);
  }
  if (t === 10) {
    const l = compileNode(n.l, ctx, 10), r = compileNode(n.r, ctx, 10);
    let inner: C;
    if (isCmp(op)) {
      inner = (s, env) => cmpI(op, l(s, env, 10) as number, r(s, env, 10) as number);
    } else {
      switch (op) {
        case '+': inner = (s, env) => iadd(l(s, env, 10) as number, r(s, env, 10) as number); break;
        case '-': inner = (s, env) => isub(l(s, env, 10) as number, r(s, env, 10) as number); break;
        case '*': inner = (s, env) => imul(l(s, env, 10) as number, r(s, env, 10) as number); break;
        case '/': inner = (s, env) => intDiv(l(s, env, 10) as number, r(s, env, 10) as number); break;
        case '%': inner = (s, env) => intMod(l(s, env, 10) as number, r(s, env, 10) as number); break;
        case '^': inner = (s, env) => Math.pow(l(s, env, 10) as number, r(s, env, 10) as number); break; // (II)D
        default: throw new ExprError('bad operator: ' + op);
      }
    }
    return wrap(inner, isCmp(op) ? 10 : (op === '^' ? 7 : 10), target);
  }
  if (t === 12 || t === 13) {
    // 矩阵域（codeGenBinopExp default）：ltype=codeGenExp(l,-1) 须 12/13，
    // 否则 "the number must appear on the right side of the matrix"（运行期，
    // 操作数先求值——短路/副作用时机与字节码一致）；rtype 7/10/12/13。
    // Java 重载选择守卫（编译期）：matDiv/matMod 矩阵右操作数 → "bad operator"；
    // matPow 仅 (矩阵, int)（(DD)/(II) 重载不存在）→ 右非 10 即 "bad operator: ^"。
    // 返回类型：l==13 或 r∈{7,13} → 13，否则 12。
    const lt = st(n.l, vt);
    const rt = st(n.r, vt);
    if (lt === 7 || lt === 10) throw new ExprError('the number must appear on the right side of the matrix');
    if ((op === '/' || op === '%') && (rt === 12 || rt === 13)) throw new ExprError('bad operator: ' + op);
    if (op === '^' && rt !== 10) throw new ExprError('bad operator: ' + op);
    const l = compileNode(n.l, ctx, -1), r = compileNode(n.r, ctx, -1);
    const retT = t === 13 ? 13 : 12;
    const inner: C = (s, env) => opMat(op, l(s, env, -1) as Mat, r(s, env, -1));
    return wrap(inner, retT, target);
  }
  // 类型不可知：运行期分派（左值是否矩阵决定矩阵路径 vs 标量路径；
  // 标量在左 → Java 的 ltype 默认分支报错，矩阵在左走 opMat 守卫）
  const l = compileNode(n.l, ctx, -1), r = compileNode(n.r, ctx, -1);
  const aIntStatic = st(n.l, vt) === 10, bIntStatic = st(n.r, vt) === 10;
  const inner: C = (s, env) => {
    const a = l(s, env, -1), b = r(s, env, -1);
    if (typeof a !== 'number') {
      return opMat(op, a, b); // opMat 内部抛 "bad operator"/AIOOBE 等
    }
    if (typeof b !== 'number') throw new ExprError('the number must appear on the right side of the matrix');
    // 标量 op 标量：按域提升（upwardType 运行期：任一侧 double → double 域）
    if (aIntStatic && bIntStatic) {
      if (isCmp(op)) return cmpI(op, a, b);
      switch (op) {
        case '+': return iadd(a, b);
        case '-': return isub(a, b);
        case '*': return imul(a, b);
        case '/': return intDiv(a, b);
        case '%': return intMod(a, b);
        case '^': return Math.pow(a, b);
        default: throw new ExprError('bad operator: ' + op);
      }
    }
    if (isCmp(op)) return cmpD(op, a, b);
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return a / b;
      case '%': return a % b;
      case '^': return Math.pow(a, b);
      default: throw new ExprError('bad operator: ' + op);
    }
  };
  return wrap(inner, -1, target);
}

function compileCall(n: Extract<Node, { k: 'call' }>, ctx: Ctx, target: number): C {
  const { vt } = ctx;
  // codeGenFunctionCallExp 时序：① 名字+个数筛选 ② rt==-1 实参仿真（错误按
  // 实参顺序抛出）③ 相似度打分（"bad type: N"）④ 选中后按形参类型 codegen 实参
  if (!hasMathFunc(n.name, n.args.length)) throw new ExprError('function not found: ' + n.name);
  const argTypes: TypeTag[] = n.args.map((a) => {
    if (a.k === 'namemat') return 0 as TypeTag;
    const t = st(a, vt);
    return t === -1 ? (simulate(a, vt) as TypeTag) : (t as TypeTag);
  });
  const sig = selectMathSig(n.name, argTypes) as MathSig;
  if (!sig) throw new ExprError('function not found: ' + n.name);
  const args = n.args.map((a, j) => compileNode(a, ctx, sig.params[j] === 'I' ? 10 : 7));
  const params = sig.params, fn = sig.fn, ret = sig.ret;
  let inner: C;
  if (args.length === 0) {
    inner = () => fn(0, 0);
  } else if (args.length === 1) {
    inner = (s, env) => fn(args[0](s, env, params[0] === 'I' ? 10 : 7) as number, 0);
  } else {
    inner = (s, env) => fn(
      args[0](s, env, params[0] === 'I' ? 10 : 7) as number,
      args[1](s, env, params[1] === 'I' ? 10 : 7) as number,
    );
  }
  if (ret === 10) {
    const base = inner;
    inner = (s, env, t) => (base(s, env, t) as number) | 0;
  }
  return wrap(inner, ret, target);
}

function compileAssign(n: Extract<Node, { k: 'assign' }>, ctx: Ctx, target: number): C {
  const { vt, locals } = ctx;
  const m = n.exps.length;
  // codeGenAssignExp 时序：① 逐 RHS codegen（嵌套赋值在此就地定型，
  // 与 Java 一致；读名字解析当前已定型的局部）② 逆序 store（首次 store
  // 定型 = addLocalVar；名字矩阵对标量 RHS → can't deconstruction number）
  const rhs = n.exps.map((e) => compileNode(e, ctx, -1));
  const types: number[] = new Array(m);
  for (let i = 0; i < m; i++) {
    let t = st(n.exps[i], vt);
    if (t === -1 || t === 0) t = simulate(n.exps[i], vt);
    types[i] = t;
  }
  for (let i = m - 1; i >= 0; i--) {
    const v = n.vars[i];
    if (v.k === 'namemat' && (types[i] !== 12 && types[i] !== 13)) {
      throw new ExprError("can't deconstruction number: " + types[i]);
    }
  }
  // store 定型（逆序，复刻 addLocalVar 注册次序）
  for (let i = m - 1; i >= 0; i--) {
    const v = n.vars[i];
    if (v.k === 'name') {
      if (!isField(v.name) && v.name !== 'PI' && v.name !== 'E') {
        pin(locals, v.name, types[i]);
        if (!vt.has(v.name)) vt.set(v.name, types[i]);
      }
    } else {
      const elT = types[i] === 12 ? 10 : 7;
      for (const row of v.names) for (const nm of row) {
        if (!isField(nm) && nm !== 'PI' && nm !== 'E') {
          pin(locals, nm, elT);
          if (!vt.has(nm)) vt.set(nm, elT);
        }
      }
    }
  }
  const needReturn = target !== 0;
  const lastT = types[m - 1];
  const core: C = (s, env) => {
    const vals: V[] = new Array(m);
    for (let i = 0; i < m; i++) vals[i] = rhs[i](s, env, -1);
    // 逆序 store（字节码次序；__RETURN = vals[m-1] 的 dup，无副作用）
    for (let i = m - 1; i >= 0; i--) {
      const v = n.vars[i];
      if (v.k === 'name') {
        storeName(s, env, locals, v.name, types[i], vals[i]);
      } else {
        destructure(s, env, locals, v.names, types[i] === 12, vals[i] as Mat);
      }
    }
    return needReturn ? (vals[m - 1] as V) : 0;
  };
  return wrap(core, lastT, target);
}

// codeGenStore：字段 → transform(7) + putfield；局部 → transform(定型) + store
function storeName(s: ParticleStruct, env: Env, locals: Locals, name: string, srcT: number, v: V): void {
  if (isField(name)) {
    (s as unknown as Record<string, number>)[name] = coerce(srcT, v, 7) as number;
    return;
  }
  const t = locals.type.get(name) as number;
  const idx = locals.slot.get(name) as number;
  if (t === 7) env.dblLoc[idx] = coerce(srcT, v, 7) as number;
  else if (t === 10) env.intLoc[idx] = coerce(srcT, v, 10) as number;
  else if (t === 12) env.matLoc[idx] = coerce(srcT, v, 12) as Mat;
  else if (t === 13) env.matLoc[idx] = coerce(srcT, v, 13) as Mat;
  else throw new ExprError('bad type: ' + t);
}

// 名字矩阵解构：逐行逐列 元素 → __TEMP → store 目标
// （字节码的 this 残留/VerifyError 由 index.ts verifyBlock 的 define 期检查覆盖）
function destructure(s: ParticleStruct, env: Env, locals: Locals, names: string[][], isInt: boolean, mat: Mat): void {
  const elT = isInt ? 10 : 7; // __TEMP 域
  const D = mat.d as unknown as number[];
  const C = names[0].length;
  for (let j = 0; j < names.length; j++) {
    for (let k = 0; k < C; k++) {
      const nm = names[j][k];
      const val = D[j * C + k];
      if (isField(nm)) {
        // 字段目标：transform(elT→7) + putfield（PI/E → IllegalAccessError
        // 已在 verifyBlock ③ 拦截，正常字段在此写入）
        (s as unknown as Record<string, number>)[nm] = coerce(elT, val, 7) as number;
        continue;
      }
      const t = locals.type.get(nm) as number;
      const idx = locals.slot.get(nm) as number;
      if (t === 7) env.dblLoc[idx] = coerce(elT, val, 7) as number;
      else if (t === 10) env.intLoc[idx] = coerce(elT, val, 10) as number;
      else if (t === 12) env.matLoc[idx] = coerce(elT, val, 12) as Mat;
      else if (t === 13) env.matLoc[idx] = coerce(elT, val, 13) as Mat;
      else throw new ExprError('bad type: ' + t);
    }
  }
}
