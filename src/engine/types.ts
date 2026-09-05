// 类型码（1:1 复刻 Java 引擎）：
// 10=int  7=double  12=int矩阵  13=double矩阵  -1=待解析  0=NameMatrix占位
export const T_INT = 10 as const;
export const T_DOUBLE = 7 as const;
export const T_IMAT = 12 as const;
export const T_DMAT = 13 as const;
export const T_UNKNOWN = -1 as const;
export const T_NAMEMAT = 0 as const;

export type TypeTag = 7 | 10 | 12 | 13 | -1 | 0;

// 运算符 token（复刻 EnumToken；MINUS/NEG/SUB 统一归一为 SUB 用于二元，NEG 用于一元）
export const enum Op {
  ADD = '+',
  SUB = '-',
  MUL = '*',
  DIV = '/',
  MOD = '%',
  POW = '^',
  NOT = '!',
  AND = '&',
  OR = '|',
  LT = '<',
  LE = '<=',
  GT = '>',
  GE = '>=',
  EQ = '==',
  NEQ = '!=',
}

// 引擎运行时错误（消息需逐字复刻 Java 根异常的 "类名: message" 形式，UI 直接显示）
export class ExprError extends Error {
  constructor(msg: string) {
    // Java 侧这些错误都是 RuntimeException（消息不含类名），golden 用
    // getClass().getName() + ":" + getMessage() 呈现，这里直接拼好
    super('java.lang.RuntimeException: ' + msg);
    this.name = 'ExprError';
  }
}

export class IntDivByZeroError extends ExprError {
  constructor() {
    super('');
    this.message = 'java.lang.ArithmeticException: / by zero';
    this.name = 'IntDivByZeroError';
  }
}

// 矩阵维度不匹配（Java 字节码对短数组取元素时抛 AIOOBE）。
export class AioobeError extends ExprError {
  constructor(idx: number, len: number) {
    super('');
    this.message = `java.lang.ArrayIndexOutOfBoundsException: Index ${idx} out of bounds for length ${len}`;
    this.name = 'AioobeError';
  }
}
