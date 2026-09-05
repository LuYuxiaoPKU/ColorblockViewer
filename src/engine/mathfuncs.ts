// java.lang.Math 静态方法表（JDK 21 中可由本引擎触达的 (int|double) 组合）。
// 复刻 CodeGen 的重载选择：精确名字 + 精确参数个数，再按相似度打分取最高
// （严格 > 比较，平分时取 getMethods() 顺序中靠前者——下表顺序即模拟该顺序）。
// 相似度（按实参类型 × 形参类型）：
//   实参 7(double): 形参 I +4, 形参 D +6
//   实参 10(int):   形参 I +6, 形参 D +5
//   实参 12(int矩阵): 形参 I +3, 形参 D +2   （矩阵按行列式降为 int 传入）
//   实参 13(double矩阵): 形参 I +1, 形参 D +3 （矩阵按行列式降为 double 传入）
// 其它类型实参 → 运行期 "bad type: N"。
// 返回 long 的（round）按 int 处理（i2）。
//
// JS 的 Math 缺少 toRadians/toDegrees/ulp/nextUp/nextDown/getExponent/scalb/
// nextAfter/signum，这里按 JLS/Javadoc 语义自实现。

import { ExprError, TypeTag } from './types';
import { d2i, toNumber, Mat } from './matrix';

// int 版 floorDiv/floorMod 除零：Java 抛 ArithmeticException: / by zero
class IntDivByZero extends ExprError {
  constructor() {
    super('');
    this.message = 'java.lang.ArithmeticException: / by zero';
    this.name = 'IntDivByZero';
  }
}

// 实参：原始求值结果（矩阵保持 rt 12/13，打分用 Java 的 12/13 规则；
// 调用时才 toNumber 降标量并窄化到形参类型）
export type MathArg = { rt: TypeTag; v: number | Mat };

export interface MathSig {
  params: ('I' | 'D')[];
  fn: (a: number, b: number) => number;
  ret: 7 | 10; // 返回类型：I / long(按int) → 10，D → 7
}

const T: Map<string, MathSig[]> = new Map();

/** ret：不传时按「全 int 形参 → 10，否则 7」推断；'long' 表示 long 返回（按 int 处理） */
function reg(name: string, params: ('I' | 'D')[], fn: (a: number, b: number) => number, ret?: 7 | 10 | 'long'): void {
  let r: 7 | 10;
  if (ret === 'long') r = 10;
  else if (ret === 7 || ret === 10) r = ret;
  else r = params.length > 0 && params.every((p) => p === 'I') ? 10 : 7;
  let list = T.get(name);
  if (!list) {
    list = [];
    T.set(name, list);
  }
  list.push({ params, fn, ret: r });
}

// ---------- JLS 语义辅助 ----------

const DBL_MIN_SUBNORM = 4.9e-324; // 2^-1074
const DBL_MAX = 1.7976931348623157e308;

function copySign(x: number, y: number): number {
  // ES2015 的 Math 无 copySign：按 Javadoc 语义 x 带上 y 的符号（±0 也算符号）
  if (isNaN(x)) return NaN;
  const neg = y < 0 || Object.is(y, -0);
  return neg ? -Math.abs(x) : Math.abs(x);
}

function signum(x: number): number {
  return x > 0 ? 1.0 : x < 0 ? -1.0 : x; // 保留 ±0 / NaN
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

function nextUp(x: number): number {
  if (isNaN(x)) return NaN;
  if (x >= DBL_MAX) return x; // +Inf 或 MAX 自身（MAX 的 nextUp 是 +Inf）
  // 用位操作：非负数加 1 ulp（含 subnormal 与 ±0）
  const buf = new ArrayBuffer(8);
  const f = new Float64Array(buf);
  const u = new BigUint64Array(buf);
  f[0] = x;
  let bits = u[0];
  if (x >= 0 || x === 0) {
    bits += 1n;
  } else {
    bits -= 1n;
  }
  u[0] = bits;
  return f[0];
}

function nextDown(x: number): number {
  if (isNaN(x)) return NaN;
  if (x <= -DBL_MAX) return x;
  const buf = new ArrayBuffer(8);
  const f = new Float64Array(buf);
  const u = new BigUint64Array(buf);
  f[0] = x;
  let bits = u[0];
  if (x >= 0 || x === 0) bits -= 1n;
  else bits += 1n;
  u[0] = bits;
  return f[0];
}

function ulp(x: number): number {
  if (isNaN(x)) return NaN;
  if (!isFinite(x)) return x;
  if (x === 0) return DBL_MIN_SUBNORM;
  const buf = new ArrayBuffer(8);
  const f = new Float64Array(buf);
  const u = new BigUint64Array(buf);
  f[0] = x;
  const bits = u[0];
  const exp = Number((bits >> 52n) & 0x7ffn);
  if (exp === 0) return DBL_MIN_SUBNORM; // subnormal
  return Math.pow(2, exp - 1075);
}

function getExponent(x: number): number {
  if (isNaN(x)) return 0;
  if (!isFinite(x)) return 1024;
  if (x === 0) return -1023;
  const ax = Math.abs(x);
  if (ax < 2.2250738585072014e-308) return -1022; // subnormal
  const buf = new ArrayBuffer(8);
  const f = new Float64Array(buf);
  const u = new BigUint64Array(buf);
  f[0] = ax;
  const exp = Number((u[0] >> 52n) & 0x7ffn);
  return exp - 1023;
}

function scalb(x: number, n: number): number {
  if (isNaN(x)) return NaN;
  if (!isFinite(x)) return x; // ±Inf 保持
  n |= 0;
  if (n >= 1024) return x >= 0 ? DBL_MAX : -DBL_MAX;
  if (n <= -1075) return x; // x*0 的符号（±0）
  return x * Math.pow(2, n);
}

function nextAfter(x: number, y: number): number {
  if (isNaN(x) || isNaN(y)) return NaN;
  if (x === y) return x; // 含 -0/+0 相等情形，返回第一参（Javadoc）
  if (x === Infinity) return y === -Infinity ? DBL_MAX : Infinity;
  if (x === -Infinity) return y === Infinity ? -DBL_MAX : -Infinity;
  return y > x ? nextUp(x) : nextDown(x);
}

function jround(x: number): number {
  // Java: (long)Math.floor(x + 0.5)，再按 int 回绕
  const r = Math.floor(x + 0.5);
  if (isNaN(r)) return 0; // Java round(NaN) = 0
  if (r === Infinity) return 2147483647;
  if (r === -Infinity) return -2147483648;
  return r | 0;
}

class ExactOverflow extends ExprError {
  constructor() {
    super('');
    this.message = 'java.lang.ArithmeticException: integer overflow';
    this.name = 'ExactOverflow';
  }
}

// ---------- 注册 ----------

reg('random', [], () => Math.random());

const UN_D: [string, (a: number) => number][] = [
  ['sin', Math.sin],
  ['cos', Math.cos],
  ['tan', Math.tan],
  ['asin', Math.asin],
  ['acos', Math.acos],
  ['atan', Math.atan],
  ['toRadians', toRadians],
  ['toDegrees', toDegrees],
  ['exp', Math.exp],
  ['log', Math.log],
  ['log10', Math.log10],
  ['sqrt', Math.sqrt],
  ['cbrt', Math.cbrt],
  ['sinh', Math.sinh],
  ['cosh', Math.cosh],
  ['tanh', Math.tanh],
  ['expm1', Math.expm1],
  ['log1p', Math.log1p],
  ['ulp', ulp],
  ['nextUp', nextUp],
  ['nextDown', nextDown],
  ['signum', signum],
];
for (const [n, f] of UN_D) reg(n, ['D'], (a) => f(a));

reg('getExponent', ['D'], (a) => getExponent(a), 10); // Java 返回 int
reg('round', ['D'], (a) => jround(a), 'long'); // Java 返回 long（按 int 处理）

reg('abs', ['I'], (a) => {
  const v = a | 0;
  // Java Math.abs(int)：-v 回绕（INT_MIN → INT_MIN）
  return v < 0 ? (-v) | 0 : v;
});
reg('abs', ['D'], (a) => Math.abs(a));
reg('incrementExact', ['I'], (a) => {
  const x = d2i(a);
  const v = (x + 1) | 0;
  if (x === 2147483647) throw new ExactOverflow();
  return v;
});
reg('decrementExact', ['I'], (a) => {
  const x = d2i(a);
  const v = (x - 1) | 0;
  if (x === -2147483648) throw new ExactOverflow();
  return v;
});
reg('negateExact', ['I'], (a) => {
  const v = (-(a | 0)) | 0;
  // -INT_MIN 回绕为自身（0 的取反仍是 0，非溢出）
  if ((a | 0) === -2147483648) throw new ExactOverflow();
  return v;
});

reg('atan2', ['D', 'D'], (a, b) => Math.atan2(a, b));
reg('pow', ['D', 'D'], (a, b) => Math.pow(a, b));
reg('hypot', ['D', 'D'], (a, b) => Math.hypot(a, b));
reg('nextAfter', ['D', 'D'], (a, b) => nextAfter(a, b));
reg('copySign', ['D', 'D'], (a, b) => copySign(a, b));

// max/min/floorDiv/floorMod 的 int 版按 Java Math 语义：int 结果（floor* 是 floor 除法）
reg('max', ['I', 'I'], (a, b) => Math.max(a | 0, b | 0));
reg('max', ['D', 'D'], (a, b) => Math.max(a, b));
reg('min', ['I', 'I'], (a, b) => Math.min(a | 0, b | 0));
reg('min', ['D', 'D'], (a, b) => Math.min(a, b));
// ceil/floor 只有 (D)→D 重载（JDK21 无 int 版）；int 实参按 double 处理（i2d 精确）
reg('ceil', ['D'], (a) => Math.ceil(a));
reg('floor', ['D'], (a) => Math.floor(a));
reg('floorDiv', ['I', 'I'], (a, b) => {
  const ai = a | 0, bi = b | 0;
  if (bi === 0) throw new IntDivByZero();
  return Math.floor(ai / bi) | 0;
});
reg('floorDiv', ['D', 'D'], (a, b) => Math.floor(a / b));
reg('floorMod', ['I', 'I'], (a, b) => {
  const ai = a | 0, bi = b | 0;
  if (bi === 0) throw new IntDivByZero();
  return (ai - Math.floor(ai / bi) * bi) | 0;
});
reg('floorMod', ['D', 'D'], (a, b) => {
  const q = Math.floor(a / b);
  return a - q * b;
});
reg('addExact', ['I', 'I'], (a, b) => {
  const x = a | 0, y = b | 0;
  const v = (x + y) | 0;
  // 溢出当且仅当两操作数同号、结果符号与它们相反
  if ((x < 0) === (y < 0) && (v < 0) !== (x < 0)) throw new ExactOverflow();
  return v;
});
reg('subtractExact', ['I', 'I'], (a, b) => {
  const x = a | 0, y = b | 0;
  const v = (x - y) | 0;
  // x - y 溢出：x,y 异号且结果符号与 x 相反（等价于 (x^y)<0 && (x^v)<0）
  if ((x < 0) !== (y < 0) && (v < 0) !== (x < 0)) throw new ExactOverflow();
  return v;
});
reg('multiplyExact', ['I', 'I'], (a, b) => {
  const x = a | 0;
  const y = b | 0;
  const v = Math.imul(x, y);
  if (x !== 0 && v / x !== y) throw new ExactOverflow();
  return v;
});
reg('scalb', ['D', 'I'], (a, b) => scalb(a, b));

export function hasMathFunc(name: string, argCount?: number): boolean {
  const sigs = T.get(name);
  if (!sigs) return false;
  // 复刻 codeGenFunctionCallExp 的筛选：名字 + 精确参数个数
  return argCount === undefined || sigs.some((s) => s.params.length === argCount);
}

/**
 * 按 CodeGen 规则选重载（不执行）。
 * 实参类型合法性：仅 7/10/12/13 可打分；其它（0 = 名字矩阵静态 rt、8/9/11/-1）
 * 直接抛 "bad type: N"（Java 在相似度打分 switch 里抛，第一个非法实参先于函数查找）。
 * 相似度：7→I+4/D+6，10→I+6/D+5，12→I+3/D+2，13→I+1/D+3；严格 > 比较，
 * 并列保留先出现者；无候选 → null（调用方报 "function not found"）。
 */
export function selectMathSig(name: string, argTypes: TypeTag[]): MathSig | null {
  for (const rt of argTypes) {
    if (rt !== 7 && rt !== 10 && rt !== 12 && rt !== 13) throw new ExprError('bad type: ' + rt);
  }
  const sigs = T.get(name);
  if (!sigs || sigs.length === 0) return null;
  if (argTypes.length !== sigs[0].params.length) return null;
  let best: MathSig | null = null;
  let bestScore = 0;
  for (const sig of sigs) {
    let score = 0;
    for (let j = 0; j < argTypes.length; j++) {
      const rt = argTypes[j];
      const p = sig.params[j];
      let s: number;
      if (rt === 7) s = p === 'I' ? 4 : 6;
      else if (rt === 10) s = p === 'I' ? 6 : 5;
      else if (rt === 12) s = p === 'I' ? 3 : 2;
      else s = p === 'I' ? 1 : 3;
      score += s;
    }
    if (score > bestScore) {
      bestScore = score;
      best = sig;
    }
  }
  return best;
}

/** 选重载并执行。实参按形参窄化（I 形参：double→(int)饱和；矩阵→行列式）。 */
export function callMath(name: string, args: MathArg[]): { rt: 7 | 10; v: number } {
  const sig = selectMathSig(name, args.map((a) => a.rt));
  if (!sig) throw new ExprError('function not found: ' + name);
  const vals: number[] = [];
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (sig.params[j] === 'I') {
      // 实参窄化到 int：7→(int)double 饱和；12→toNumber 已是 int32；10 保持
      vals.push(a.rt === 7 ? d2i(a.v as number) : a.rt === 12 ? toNumber(a.v as Mat) : (a.v as number) | 0);
    } else {
      // 实参提升/降级到 double：10 精确；12/13→行列式
      vals.push(a.rt === 12 || a.rt === 13 ? toNumber(a.v as Mat) : (a.v as number));
    }
  }
  const r = sig.fn(vals[0] ?? 0, vals[1] ?? 0);
  return sig.ret === 10 ? { rt: 10 as const, v: r | 0 } : { rt: 7 as const, v: r };
}
