// 运行时求值核心（闭包编译后端共用）：类型转换 + 无闭包状态的热路径原语。
// 编译产物见 compiler.ts：每个 AST 节点编译成小闭包（静态类型已知时类型分派在
// 编译期消除），本文件只提供闭包内调用的原语，保证与 Java 字节码语义逐字一致。
//
// 值表示（V）：number = int(10)/double(7)；Mat = int矩阵(12)/double矩阵(13)。
// 与 Java 栈上的值一一对应；rt 只在闭包签名层面（静态）出现，热路径不传 {rt,v}。

import { ExprError } from './types';
import {
  Mat, matAddS, matSubS, matMulS, matDivS, matModS, matPowM,
  matAddM, matSubM, matMulM, toNumber, scalarMat, matToD, matToI, d2i,
} from './matrix';

export type V = number | Mat;

/**
 * 复刻 codeGenTypeTransform(target→source 的转换链)。
 * target = 期望类型（Java 字节码 codeGenTypeTransform 的第二参）；
 * -1 = 不转换（Java 对 rt==-1 的转换请求是 no-op）；0 = POP（求值后丢弃）；
 * 7/10/12/13 = 类型转换。
 * srcRt = -1（源类型静态不可知）时按值的实际表示分派（coerceByValue）：
 * number 视 10/7 均可（10→7 精确、7→10 饱和 d2i 与 Java 一致），Mat 视 12/13。
 * 错误消息与解释器/Java 逐字一致。
 */
export function coerce(srcRt: number, v: V, target: number): V {
  if (target === -1 || srcRt === target) return v;
  if (target === 0) return 0; // POP
  if (srcRt === -1) return coerceByValue(v, target);
  const s = v;
  switch (target) {
    case 7: {
      if (srcRt === 10) return s as number;
      if (srcRt === 12 || srcRt === 13) return toNumber(s as Mat);
      throw new ExprError('bad type: ' + target);
    }
    case 10: {
      if (srcRt === 7) return d2i(s as number);
      if (srcRt === 12) return toNumber(s as Mat);
      if (srcRt === 13) return d2i(toNumber(s as Mat));
      throw new ExprError('bad type: ' + target);
    }
    case 12: {
      if (srcRt === 7) return scalarMat(true, d2i(s as number));
      if (srcRt === 10) return scalarMat(true, s as number);
      if (srcRt === 13) return matToI(s as Mat);
      throw new ExprError('bad type: ' + target);
    }
    case 13: {
      if (srcRt === 7) return scalarMat(false, s as number);
      if (srcRt === 10) return scalarMat(false, s as number);
      if (srcRt === 12) return matToD(s as Mat);
      throw new ExprError('bad type: ' + target);
    }
  }
  throw new ExprError('bad type: ' + target);
}

function isMat(v: V): v is Mat {
  return typeof v !== 'number';
}

// srcRt 不可知（-1）时按值分派：number 按 7（double）处理（10→7 精确、
// 7→10 = d2i 饱和，与 Java 对 int/double 值的 (int) 窄化一致）；Mat 按 13。
function coerceByValue(v: V, target: number): V {
  return typeof v === 'number' ? coerce(7, v, target) : coerce(13, v, target);
}

// 矩阵 矩阵 / 矩阵 标量 运算（op ∈ + - * / % ^）
export function opMat(op: string, lm: Mat, rv: V): Mat {
  if (isMat(rv)) {
    const rm = rv;
    const a = lm.isInt && !rm.isInt ? matToD(lm) : lm;
    const b = !lm.isInt && rm.isInt ? matToD(rm) : rm;
    switch (op) {
      case '+': return matAddM(a, b);
      case '-': return matSubM(a, b);
      case '*': return matMulM(a, b);
    }
    throw new ExprError('bad operator: ' + op);
  }
  const v = rv as number;
  switch (op) {
    case '+': return matAddS(lm, v);
    case '-': return matSubS(lm, v);
    case '*': return matMulS(lm, v);
    case '/': return matDivS(lm, v);
    case '%': return matModS(lm, v);
    case '^': return matPowM(lm, v); // 编译端已静态确认右为 int（^ 右操作数 rt==10）
  }
  throw new ExprError('bad operator: ' + op);
}
