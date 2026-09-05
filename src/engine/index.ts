// 编译入口：parse(src) → CompiledBlock（带缓存，对应 Java ClassExpression 静态 CACHE）。
// CompiledBlock.run(struct) → int（块返回 = 最后一条语句截断为 int）。
//
// 两阶段模型（与 Java 对齐）：
//  - parse 期 = CodeGen + defineHiddenClass 类验证：矩阵×矩阵/±×矩阵 维度检查
//    （AIOOBE，仅常量矩阵可静态判定）、名字矩阵解构（可验证时合法、运行期
//    越界才 AIOOBE，不可验证形态 → VerifyError）、PI/E 赋值（IllegalAccessError）、
//    以及 parse 本身抛的解析期错误；空/null 源 → NPE（ExpressionUtil 返回 null）。
//  - run 期 = 方法执行：运行期错误（/ by zero、undefine var、bad type、AIOOBE 等）。
//  错误消息逐字复刻（java.lang.XxxException: msg），错误阶段差异对 UI 透明。

import { Lexer } from './lexer';
import { Parser } from './parser';
import { Node, AssignTarget } from './ast';
import { ParticleStruct, isField } from './struct';
import { compileBlock } from './compiler';
import { hasMathFunc, selectMathSig } from './mathfuncs';
import { AioobeError, ExprError, TypeTag } from './types';

export interface CompiledBlock {
  block: Node[];
  /** 执行一次：struct 为粒子字段载体；局部变量按单次 invoke 作用域（内部新建，
   *  与 Java 每实例独立 struct + 每方法局部一致） */
  run(struct: ParticleStruct): number;
}

const CACHE = new Map<string, CompiledBlock>();

export function parse(source: string): CompiledBlock {
  // ExpressionUtil.parse：null/空/"null" → 返回 null → 调用方 invoke 时 NPE
  // （消息为 JDK 16+ 的 helpful NPE 形式）
  if (source === '' || source === 'null') {
    throw new Error(
      'java.lang.NullPointerException: Cannot invoke "com.noone.particleex.util.IExecutable.invoke()" because "ex" is null',
    );
  }
  const hit = CACHE.get(source);
  if (hit) return hit;
  const block = new Parser(new Lexer(source)).parseBlock();
  verifyBlock(block); // CodeGen + 类验证阶段的静态错误
  let run: (s: ParticleStruct) => number;
  try {
    run = compileBlock(block); // 闭包编译（codegen 期错误在此抛出）
  } catch (e) {
    CACHE.set(source, {
      block,
      run(): number { throw e; },
    });
    return CACHE.get(source) as CompiledBlock;
  }
  const compiled: CompiledBlock = {
    block,
    run(struct: ParticleStruct): number {
      // 空块（纯空白）：CodeGen.codeGenBlock 的 block[block.length-1] → AIOOBE(-1, 0)
      if (block.length === 0) {
        throw new AioobeError(-1, 0);
      }
      return run(struct);
    },
  };
  CACHE.set(source, compiled);
  return compiled;
}

// ---- 静态验证（复刻 CodeGen 字节码 + JVMTI 类验证）----

/** 静态可知的矩阵维数（字面量常量矩阵 / 全 int 字面量元素的动态矩阵） */
function matOf(n: Node): { r: number; c: number; isInt: boolean } | null {
  if (n.k === 'imat') return { r: n.r, c: n.c, isInt: true };
  if (n.k === 'fmat') return { r: n.r, c: n.c, isInt: false };
  if (n.k === 'mat') {
    // 折叠失败（如 `,,` 空元素）的动态矩阵：运行期才炸，静态不可知
    for (const row of n.rows) for (const e of row) if (e.k !== 'int') return null;
    return { r: n.rows.length, c: n.rows[0].length, isInt: false };
  }
  return null;
}

function verifyBlock(block: Node[]): void {
  // 局部变量静态类型表：复刻 CodeGen.localVars —— 变量在「首次 store 时定型」
  // （addLocalVar 只在 !localVars.containsKey(name) 时注册，之后 codeGenStore
  // 按已定型转换），同一块内后续语句可据此解析名字的类型（未出现 → -1）。
  const varTypes = new Map<string, number>();
  // ① codegen 期（整块语句顺序）：每条语句先子表达式定型（可抛 codegen 错：
  //   仿真 "bad type: 0" / "undefine var" 等），再逆序 store（名字矩阵对标量 RHS
  //   → "can't deconstruction number: N"）。所有 codegen 错误先于 define 期错误。
  // 记录每条 assign 语句的 (vars, sts) 供 ②③ 按整方法字节码顺序复查。
  const assigns: { vars: AssignTarget[]; sts: number[] }[] = [];
  for (const stmt of block) {
    verifyNode(stmt, varTypes);
    if (stmt.k !== 'assign') continue;
    const m = stmt.exps.length;
    const sts: number[] = new Array(m);
    for (let i = 0; i < m; i++) {
      let st = staticTypeOf(stmt.exps[i], varTypes);
      if (st === -1 || st === 0) st = simulateType(stmt.exps[i], varTypes);
      sts[i] = st;
    }
    for (let i = m - 1; i >= 0; i--) {
      const v = stmt.vars[i];
      if (v.k === 'namemat' && (sts[i] !== 12 && sts[i] !== 13)) {
        throw new ExprError("can't deconstruction number: " + sts[i]);
      }
    }
    // 首次 store 定型（addLocalVar 语义；字段写不进表）
    for (let j = 0; j < stmt.vars.length; j++) {
      const v = stmt.vars[j];
      if (v.k === 'name' && !isField(v.name) && !varTypes.has(v.name)) {
        varTypes.set(v.name, sts[j]);
      }
    }
    assigns.push({ vars: stmt.vars, sts });
  }
  // ② define 期·数据流验证（defineHiddenClass，整方法一次，先于字段访问检查 ——
  //   Probe20: `M=(1,2);PI=1;(a,b)=M;7` 虽 putfield 地址在前仍报 VerifyError）。
  //   分解字节码（Probe22/23/24 实测）：每元素 store 前 aload_0 压 this，
  //   元素写「字段」→ PUTFIELD 吃掉 this（干净）；元素写「局部变量」→ ISTORE/ASTORE
  //   残留 this。残留使下一条吃栈顶的指令非法：同行下一元素的 elemLoad（12→iaload
  //   / 13→daload），或下一行的 aaload（行 dup 复制的是残留 this 而非矩阵）。
  //   末元素（R-1,C-1）的残留无害（其后无同类指令；方法尾残留 JDK 验证器容忍，
  //   Probe24: `(x,a)=(1,2);a` 正常运行）。
  //   故：任一「非末元素」是局部变量名 → VerifyError，报首个（字节码顺序 =
  //   语句序 × 语句内逆序 pair × 行主序元素）命中处。
  for (const a of assigns) {
    for (let i = a.vars.length - 1; i >= 0; i--) {
      const v = a.vars[i];
      if (v.k !== 'namemat') continue;
      const R = v.names.length, C = v.names[0].length;
      for (let j = 0; j < R; j++) {
        for (let k = 0; k < C; k++) {
          if (j === R - 1 && k === C - 1) continue;
          const name = v.names[j][k];
          if (isField(name) || name === 'PI' || name === 'E') continue;
          const load = k < C - 1 ? (a.sts[i] === 13 ? 'daload' : 'iaload') : 'aaload';
          throw new Error('java.lang.VerifyError: Bad type on operand stack in ' + load);
        }
      }
    }
  }
  // ③ define 期·字段访问检查（数据流全过后）：写 final 字段 PI/E →
  //   IllegalAccessError，报字节码地址最靠前的 putfield（语句序 × 逆序 pair ×
  //   行主序元素；PI=1;E=1 报 PI，E=1;PI=1 报 E，Probe20 实测）。
  for (const a of assigns) {
    for (let i = a.vars.length - 1; i >= 0; i--) {
      const v = a.vars[i];
      if (v.k === 'name') {
        if (v.name === 'PI' || v.name === 'E') throw illegalAccess(v.name);
      } else {
        for (const row of v.names) for (const name of row) {
          if (name === 'PI' || name === 'E') throw illegalAccess(name);
        }
      }
    }
  }
}

function illegalAccess(name: string): Error {
  return new Error(
    'java.lang.IllegalAccessError: Update to non-static final field com.noone.particleex.util.ParticleStruct.' + name,
  );
}

function verifyNode(n: Node, varTypes: Map<string, number>): void {
  switch (n.k) {
    case 'bin':
      verifyNode(n.l, varTypes);
      verifyNode(n.r, varTypes);
      verifyBin(n);
      break;
    case 'un': verifyNode(n.e, varTypes); break;
    case 'call': verifyCall(n, varTypes); break;
    case 'mat': n.rows.flat().forEach((e) => verifyNode(e, varTypes)); break;
    case 'assign':
      // 赋值语句的 store/define 检查在 verifyBlock 的 ①②③ 阶段做
      n.exps.forEach((e) => verifyNode(e, varTypes));
      break;
    default: break;
  }
}

// 调用节点验证（复刻 codeGenFunctionCallExp 的 codegen 时序，错误在 parse 期抛出）：
// ① 名字+实参个数筛选（空 → "function not found: name"，先于一切实参处理）
// ② 实参类型解析：静态 rt（namemat → 0，不仿真）；rt==-1 → 仿真（codegen 错误
//    在此按实参顺序抛出，如 "undefine var"）
// ③ 相似度打分：实参类型 ∉{7,10,12,13}（如 namemat 的 0）→ "bad type: N"
// ④ 选中后 codegen 全部实参（codegen 错误按实参顺序抛出）
function verifyCall(n: Extract<Node, { k: 'call' }>, varTypes: Map<string, number>): void {
  if (!hasMathFunc(n.name, n.args.length)) {
    throw new ExprError('function not found: ' + n.name);
  }
  const resolved = n.args.map((a): TypeTag => {
    if (a.k === 'namemat') return 0; // 静态 rt 0 → 打分 "bad type: 0"，不仿真
    const st = staticTypeOf(a, varTypes);
    return st === -1 ? (simulateType(a, varTypes) as TypeTag) : (st as TypeTag);
  });
  const sig = selectMathSig(n.name, resolved);
  if (!sig) throw new ExprError('function not found: ' + n.name);
  for (const a of n.args) verifyNode(a, varTypes);
}

// 矩阵×矩阵 / 矩阵±矩阵 / 矩阵^ 的静态维度检查（复刻 matMul/matAdd/matSub/matPow
// 的数组越界）。仅当操作数是「字面量常量矩阵」时可静态判定（变量矩阵在运行期才炸，
// 由 runtime matMulM/matPowM 抛同样的 AioobeError）。
function verifyBin(n: Node): void {
  if (n.k !== 'bin') return;
  const L = matOf(n.l), R = matOf(n.r);
  if (L && R) {
    if (n.op === '*') {
      // matMul(l, r)：内层 rMat[k][j]，k 到 a.c-1 → r 行数 < a.c 时 AIOOBE(r.r, r.r)
      if (L.c > R.r) throw new AioobeError(R.r, R.r);
    } else if (n.op === '+' || n.op === '-') {
      if (L.c !== R.c || L.r !== R.r) throw new AioobeError(L.c, R.c);
    } else if (n.op === '^') {
      // matPow：每轮循环必有一次 mat=matMul(mat,mat)，非方阵且 c>r 时 AIOOBE(r,r)；
      // 指数为 0 时循环不执行 → 单位矩阵，无错。c≤r 的非方阵（如 2×1）不越界。
      const kZero = n.r.k === 'int' && (n.r as { v: number }).v === 0;
      if (L.r !== L.c && L.c > L.r && !kZero) throw new AioobeError(L.r, L.r);
    }
  }
}

// 赋值语句的验证拆在 verifyBlock 的 ①②③ 三阶段（codegen 期逆序 store 错误
// 逐语句抛出；define 期错误跨语句按字节码顺序复查），见 verifyBlock 注释。

/**
 * 节点的静态 returnType（-1 = 不可知；与 Expression 构造器一致）。
 * bin：复刻 BinOpExp 构造器（op 为 token 文本，'-' 映射到 SUB 不影响类型；
 *      10^10 → 7；10/7 混合 → 7；矩阵组合 → 12/13）
 * name：字段恒 7；局部变量取本块内首次赋值时定型的类型（CodeGen.localVars 语义）
 */
function staticTypeOf(n: Node, varTypes: Map<string, number> = new Map()): number {
  if (n.k === 'int') return 10;
  if (n.k === 'float') return 7;
  if (n.k === 'imat') return 12;
  if (n.k === 'fmat') return 13;
  if (n.k === 'mat') return 13;
  if (n.k === 'namemat') return 13; // codeGenLoadMatrix 恒产出 [[D（NameMatrixExp 静态 rt 0 的占位在此上下文不适用）
  if (n.k === 'bin') {
    // Java BinOpExp 构造器：AND/OR 恒 10（先于操作数类型判断）
    if (n.op === 'AND' || n.op === 'OR') return 10;
    const lt = staticTypeOf(n.l, varTypes);
    const rt = staticTypeOf(n.r, varTypes);
    if (lt === -1 || rt === -1) return -1;
    if (lt === 10 && rt === 10) return n.op === '^' ? 7 : 10;
    if ((lt !== 10 || rt !== 7) && (lt !== 7 || rt !== 10) && (lt !== 7 || rt !== 7)) {
      return lt === 12 && (rt === 10 || rt === 12) ? 12 : 13;
    }
    return 7;
  }
  if (n.k === 'name') {
    if (isField(n.name) || n.name === 'PI' || n.name === 'E') return 7;
    return varTypes.get(n.name) ?? -1;
  }
  // UnOpExp rt = 内层 rt；AssignExp rt = 最后 RHS 的 rt（Expression 构造器）
  if (n.k === 'un') return staticTypeOf(n.e, varTypes);
  if (n.k === 'assign') return staticTypeOf(n.exps[n.exps.length - 1], varTypes);
  return -1; // call（FunctionCallExp 恒 -1）
}

/**
 * CodeGen.startSimulation 复刻：对静态类型不可知的表达式做仿真求值以确定实际类型。
 * 类型与值无关（仅 NaN 传播例外，这里按「不改变类型」简化），但运行时错误可能先行
 * 抛出 —— 与 Java 一致：仿真在 codeGenExp 内求值，错误在 parse 期以 rootMsg 形式抛出。
 */
function simulateType(n: Node, varTypes: Map<string, number>): number {
  if (n.k === 'int') return 10;
  if (n.k === 'float') return 7;
  if (n.k === 'imat') return 12;
  if (n.k === 'fmat') return 13;
  if (n.k === 'mat') return 13;
  if (n.k === 'namemat') return 13;
  if (n.k === 'bin') {
    const lt = simulateType(n.l, varTypes);
    const rt = simulateType(n.r, varTypes);
    // 复刻 upwardType：max≤0 → "bad type"；(10,10)→10；10/7 混合或 (7,7)→7
    if (Math.max(lt, rt) <= 0) throw new ExprError('bad type');
    if (lt === 10 && rt === 10) return 10;
    return (lt !== 10 || rt !== 7) && (lt !== 7 || rt !== 10) && (lt !== 7 || rt !== 7) ? -1 : 7;
  }
  if (n.k === 'un') {
    const t = simulateType(n.e, varTypes);
    // 复刻 codeGenUnopExp：NEG 接受 7/10/12/13（类型不变）；NOT 仅接受 7/10，其余 "bad type"
    if (n.op === 'NOT' && (t === 12 || t === 13)) throw new ExprError('bad type');
    if (t === 12 || t === 13 || t === 7 || t === 10) return t;
    throw new ExprError('bad type');
  }
  if (n.k === 'call') {
    // 仿真内的调用：与 verifyCall 同序（名字+个数筛选 → 逐实参定类型 → 打分）
    if (!hasMathFunc(n.name, n.args.length)) throw new ExprError('function not found: ' + n.name);
    const argTypes = n.args.map((a) => {
      if (a.k === 'namemat') return 0 as TypeTag; // 静态 rt 0 → 打分 "bad type: 0"，不仿真
      return simulateType(a, varTypes) as TypeTag;
    });
    const sig = selectMathSig(n.name, argTypes);
    if (!sig) throw new ExprError('function not found: ' + n.name);
    return sig.ret;
  }
  if (n.k === 'name') {
    if (isField(n.name) || n.name === 'PI' || n.name === 'E') return 7;
    const t = varTypes.get(n.name);
    if (t === undefined) throw new ExprError('undefine var: ' + n.name); // 仿真时查不到 → 运行期错误先抛
    return t;
  }
  // 赋值仿真值 = 最后 RHS（codeGenAssignExp 的 types[expList.length-1]）
  if (n.k === 'assign') return simulateType(n.exps[n.exps.length - 1], varTypes);
  return -1;
}

/** 测试/CLI 用：默认 struct 求值 */
export function evalForTest(src: string): number {
  return parse(src).run(new ParticleStruct());
}
