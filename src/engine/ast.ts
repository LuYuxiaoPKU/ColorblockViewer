// AST 节点：对齐 Java Expression 子类的形态与 returnType 语义。
import { TypeTag, Op } from './types';

export type Node =
  | { k: 'int'; line: number; v: number; rt: TypeTag }
  | { k: 'float'; line: number; v: number; rt: TypeTag }
  | { k: 'name'; line: number; name: string; rt: TypeTag }
  | { k: 'un'; line: number; op: 'NEG' | 'NOT'; e: Node; rt: TypeTag }
  | { k: 'bin'; line: number; op: Op | 'AND' | 'OR'; l: Node; r: Node; rt: TypeTag }
  | { k: 'call'; line: number; name: string; args: Node[]; rt: TypeTag }
  // 矩阵字面量：运行时求元素（double 或 int 视元素而定）
  | { k: 'mat'; line: number; rows: Node[][]; rt: TypeTag }
  // 常量矩阵（解析期折叠后）
  | { k: 'imat'; line: number; r: number; c: number; d: Int32Array; rt: TypeTag }
  | { k: 'fmat'; line: number; r: number; c: number; d: Float64Array; rt: TypeTag }
  // 赋值：vars 只能是 name 或 namemat
  | { k: 'assign'; line: number; vars: AssignTarget[]; exps: Node[]; rt: TypeTag }
  // 名字矩阵（只出现在赋值左侧）
  | { k: 'namemat'; line: number; names: string[][]; rt: TypeTag };

// 赋值目标：标识符（parseVar 返回 {k:'name'}）或名字矩阵（namemat）
export type AssignTarget =
  | { k: 'name'; line: number; name: string; rt: TypeTag }
  | { k: 'namemat'; line: number; names: string[][]; rt: TypeTag };

// ---- 解析期静态类型推断（对齐 Expression 构造器的 returnType 计算）----
// 返回 -1 表示「需运行期/模拟求值才能确定」（名称、函数调用、动态矩阵等）。

/** 字面量/常量节点的静态类型 */
export function litType(n: Node): TypeTag | null {
  switch (n.k) {
    case 'int': return 10;
    case 'float': return 7;
    case 'imat': return 12;
    case 'fmat': return 13;
    case 'un': return n.rt;
    default: return null;
  }
}

/**
 * 二元运算的静态 returnType（对齐 Expression.BinOpExp 构造器）：
 *  - AND/OR → 10
 *  - 两侧已知：
 *      10,10 → POW?7:10
 *      混合 10/7 或双 7 → 7
 *      双矩阵：int 组合→12（除非含 13→13）
 *      其它组合（矩阵×标量等）→ 保持 -1（运行期决定）
 */
export function binReturnType(op: string, lt: TypeTag | null, rt: TypeTag | null): TypeTag {
  if (op === 'AND' || op === 'OR') return 10;
  if (lt === null || rt === null || lt === -1 || rt === -1) return -1;
  if (lt === 10 && rt === 10) return op === 'POW' ? 7 : 10;
  // (lt!=10||rt!=7)&&(lt!=7||rt!=10)&&(lt!=7||rt!=7) → 非 10/7 混合（双矩阵/矩阵×标量等）
  if ((lt !== 10 || rt !== 7) && (lt !== 7 || rt !== 10) && (lt !== 7 || rt !== 7)) {
    // Java: lt!=12 || (rt!=10 && rt!=12) → 13；否则 12
    // 即仅当 lt==12 且 rt∈{10,12} 时 → 12，其余 → 13
    if (lt === 12 && (rt === 10 || rt === 12)) return 12;
    return 13;
  }
  return 7;
}
