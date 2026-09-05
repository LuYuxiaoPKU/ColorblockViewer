// 矩阵：1:1 复刻 MatrixUtil。行主序平坦数组。
// int 矩阵元素运算走 int32 回绕（|0）；double 矩阵走 IEEE754。
// 注意：matMul(int,int) 的中间累加也是 int 回绕（Java int[] 逐元素 +=）。

import { IntDivByZeroError, AioobeError } from './types';

export interface Mat {
  isInt: boolean;
  r: number; // 行数
  c: number; // 列数
  d: Int32Array | Float64Array;
}

// ---- 元素级标量运算（与 JS 语义一致的部分）----

export function intDiv(a: number, b: number): number {
  if (b === 0) throw new IntDivByZeroError();
  return Math.trunc(a / b) | 0;
}

/** Java int 取模：余数，符号随被除数（a - trunc(a/b)*b），b==0 抛错 */
export function intMod(a: number, b: number): number {
  if (b === 0) throw new IntDivByZeroError();
  return (a - Math.trunc(a / b) * b) | 0;
}

export function iadd(a: number, b: number): number {
  return (a + b) | 0;
}
export function isub(a: number, b: number): number {
  return (a - b) | 0;
}
export function imul(a: number, b: number): number {
  // Math.imul = 精确 32 位有符号乘法（JS number 在 2^53 外不精确，不能用 a*b|0）
  return Math.imul(a | 0, b | 0);
}

// double 取模 = JS %（IEEE 余数，与 Java double % 一致）
export function dmod(a: number, b: number): number {
  return a % b;
}

// ---- Java (int)double 窄化（饱和；NaN→0；±Inf→±INT_MAX）----
export function d2i(v: number): number {
  if (isNaN(v)) return 0;
  if (v >= 2147483647) return 2147483647;
  if (v < -2147483648) return -2147483648;
  return Math.trunc(v) | 0;
}

// ---- 构造 ----

export function scalarMat(isInt: boolean, v: number): Mat {
  const d = isInt ? new Int32Array(1) : new Float64Array(1);
  d[0] = isInt ? (v | 0) : v;
  return { isInt, r: 1, c: 1, d };
}

// ---- 元素级标量运算（矩阵 ±/* / % 标量；标量在右）----

export function matAddS(m: Mat, v: number): Mat {
  const n = m.r * m.c;
  const d = m.isInt ? new Int32Array(n) : new Float64Array(n);
  if (m.isInt) {
    const iv = v | 0;
    for (let i = 0; i < n; i++) d[i] = iadd((m.d as Int32Array)[i], iv);
  } else {
    for (let i = 0; i < n; i++) d[i] = (m.d as Float64Array)[i] + v;
  }
  return { isInt: m.isInt, r: m.r, c: m.c, d };
}

export function matSubS(m: Mat, v: number): Mat {
  const n = m.r * m.c;
  const d = m.isInt ? new Int32Array(n) : new Float64Array(n);
  if (m.isInt) {
    const iv = v | 0;
    for (let i = 0; i < n; i++) d[i] = isub((m.d as Int32Array)[i], iv);
  } else {
    for (let i = 0; i < n; i++) d[i] = (m.d as Float64Array)[i] - v;
  }
  return { isInt: m.isInt, r: m.r, c: m.c, d };
}

export function matMulS(m: Mat, v: number): Mat {
  const n = m.r * m.c;
  const d = m.isInt ? new Int32Array(n) : new Float64Array(n);
  if (m.isInt) {
    const iv = v | 0;
    for (let i = 0; i < n; i++) d[i] = imul((m.d as Int32Array)[i], iv);
  } else {
    for (let i = 0; i < n; i++) d[i] = (m.d as Float64Array)[i] * v;
  }
  return { isInt: m.isInt, r: m.r, c: m.c, d };
}

export function matDivS(m: Mat, v: number): Mat {
  const n = m.r * m.c;
  const d = m.isInt ? new Int32Array(n) : new Float64Array(n);
  if (m.isInt) {
    const iv = v | 0;
    for (let i = 0; i < n; i++) d[i] = intDiv((m.d as Int32Array)[i], iv);
  } else {
    for (let i = 0; i < n; i++) d[i] = (m.d as Float64Array)[i] / v;
  }
  return { isInt: m.isInt, r: m.r, c: m.c, d };
}

export function matModS(m: Mat, v: number): Mat {
  const n = m.r * m.c;
  const d = m.isInt ? new Int32Array(n) : new Float64Array(n);
  if (m.isInt) {
    const iv = v | 0;
    for (let i = 0; i < n; i++) d[i] = intMod((m.d as Int32Array)[i], iv);
  } else {
    for (let i = 0; i < n; i++) d[i] = dmod((m.d as Float64Array)[i], v);
  }
  return { isInt: m.isInt, r: m.r, c: m.c, d };
}

// ---- 矩阵 × 矩阵（标准乘法；int 版累加走 int 回绕，混合/double 版走 double）----

export function matMulM(a: Mat, b: Mat): Mat {
  // Java matMul(int[][] l, int[][] r)：内层 rMat[k][j] 的 k 只到 a.c-1，
  // r 的行数 < a.c 时 r[k] 越界 → AIOOBE "Index b.r out of bounds for length b.r"
  // （1×4 × 1×4 → "Index 1 ... length 1"；2×3 的 M^2 在 M*M 步 → "Index 2 ... length 2"）。
  if (a.c > b.r) throw new AioobeError(b.r, b.r);
  const outInt = a.isInt && b.isInt;
  const n = a.r * b.c;
  const d = outInt ? new Int32Array(n) : new Float64Array(n);
  const A = a.d as unknown as number[];
  const B = b.d as unknown as number[];
  if (outInt) {
    for (let i = 0; i < a.r; i++) {
      for (let j = 0; j < b.c; j++) {
        let acc = 0;
        for (let k = 0; k < a.c; k++) {
          acc = iadd(acc, imul(A[i * a.c + k], B[k * b.c + j]));
        }
        d[i * b.c + j] = acc;
      }
    }
  } else {
    for (let i = 0; i < a.r; i++) {
      for (let j = 0; j < b.c; j++) {
        let acc = 0;
        for (let k = 0; k < a.c; k++) {
          acc += A[i * a.c + k] * B[k * b.c + j];
        }
        d[i * b.c + j] = acc;
      }
    }
  }
  return { isInt: outInt, r: a.r, c: b.c, d };
}

// ---- 矩阵 ± 矩阵（同形状；混合时升 double）----

export function matAddM(a: Mat, b: Mat): Mat {
  // 形状必须相同（Java rMat[i][j] 越界 → AIOOBE "Index a.c out of bounds for length b.c"）
  if (a.c !== b.c || a.r !== b.r) throw new AioobeError(a.c, b.c);
  const n = a.r * a.c;
  const outInt = a.isInt && b.isInt;
  const d = outInt ? new Int32Array(n) : new Float64Array(n);
  const A = a.d as unknown as number[];
  const B = b.d as unknown as number[];
  if (outInt) {
    for (let i = 0; i < n; i++) d[i] = iadd(A[i], B[i]);
  } else {
    for (let i = 0; i < n; i++) d[i] = A[i] + B[i];
  }
  return { isInt: outInt, r: a.r, c: a.c, d };
}

export function matSubM(a: Mat, b: Mat): Mat {
  // 形状必须相同（Java rMat[i][j] 越界 → AIOOBE "Index a.c out of bounds for length b.c"）
  if (a.c !== b.c || a.r !== b.r) throw new AioobeError(a.c, b.c);
  const n = a.r * a.c;
  const outInt = a.isInt && b.isInt;
  const d = outInt ? new Int32Array(n) : new Float64Array(n);
  const A = a.d as unknown as number[];
  const B = b.d as unknown as number[];
  if (outInt) {
    for (let i = 0; i < n; i++) d[i] = isub(A[i], B[i]);
  } else {
    for (let i = 0; i < n; i++) d[i] = A[i] - B[i];
  }
  return { isInt: outInt, r: a.r, c: a.c, d };
}

// ---- 矩阵 ^ int（快速幂，从单位矩阵，k>>>=1 无符号右移；复刻 matPow）----
// Java 从 n×n 单位矩阵开始（n = mat.length），k 为 32 位无符号移位循环。

export function matPowM(m: Mat, k: number): Mat {
  const n = m.r;
  let result: Mat = {
    isInt: m.isInt,
    r: n,
    c: n,
    d: m.isInt ? new Int32Array(n * n) : new Float64Array(n * n),
  };
  const rd = result.d as unknown as number[];
  for (let i = 0; i < n; i++) rd[i * n + i] = 1;
  let base = m;
  let kk = k >>> 0;
  while (kk !== 0) {
    if (kk & 1) result = matMulM(result, base);
    base = matMulM(base, base);
    kk = kk >>> 1;
  }
  return result;
}

// ---- 负矩阵 ----

export function matNeg(m: Mat): Mat {
  const n = m.r * m.c;
  const d = m.isInt ? new Int32Array(n) : new Float64Array(n);
  const A = m.d as unknown as number[];
  if (m.isInt) {
    for (let i = 0; i < n; i++) d[i] = isub(0, A[i]);
  } else {
    for (let i = 0; i < n; i++) d[i] = -A[i];
  }
  return { isInt: m.isInt, r: m.r, c: m.c, d };
}

// ---- int矩阵 ↔ double矩阵（matToMat：double→int 逐元素截断）----

export function matToD(m: Mat): Mat {
  const n = m.r * m.c;
  const d = new Float64Array(n);
  const A = m.d as unknown as number[];
  for (let i = 0; i < n; i++) d[i] = A[i];
  return { isInt: false, r: m.r, c: m.c, d };
}

export function matToI(m: Mat): Mat {
  const n = m.r * m.c;
  const d = new Int32Array(n);
  const A = m.d as unknown as number[];
  for (let i = 0; i < n; i++) d[i] = d2i(A[i]);
  return { isInt: true, r: m.r, c: m.c, d };
}

// ---- 矩阵 → 标量（行列式；非方阵→0；int 版累加/相乘都走 int 回绕）----

function cofactor(m: Mat, row: number, col: number): Mat {
  const n = m.r - 1;
  const d = m.isInt ? new Int32Array(n * n) : new Float64Array(n * n);
  const A = m.d as unknown as number[];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const sr = i < row - 1 ? i : i + 1;
      const sc = j < col - 1 ? j : j + 1;
      d[i * n + j] = A[sr * m.c + sc];
    }
  }
  return { isInt: m.isInt, r: n, c: n, d };
}

export function toNumber(m: Mat): number {
  const n = m.r;
  if (n !== m.c) return m.isInt ? 0 : 0.0;
  if (n === 1) return m.isInt ? (m.d as Int32Array)[0] : (m.d as Float64Array)[0];
  if (n === 2) {
    if (m.isInt) {
      const A = m.d as Int32Array;
      return (Math.imul(A[0], A[3]) - Math.imul(A[1], A[2])) | 0;
    }
    const D = m.d as Float64Array;
    return D[0] * D[3] - D[1] * D[2];
  }
  if (m.isInt) {
    let result = 0;
    for (let i = 0; i < n; i++) {
      const t = toNumber(cofactor(m, 1, i + 1)) as number;
      const prod = imul((m.d as Int32Array)[i], t);
      result = i % 2 === 0 ? iadd(result, prod) : isub(result, prod);
    }
    return result;
  }
  let result = 0;
  for (let i = 0; i < n; i++) {
    const t = toNumber(cofactor(m, 1, i + 1));
    const prod = (m.d as Float64Array)[i] * t;
    result += i % 2 === 0 ? prod : -prod;
  }
  return result;
}
