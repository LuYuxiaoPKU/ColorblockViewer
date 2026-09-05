// 引擎可见的 java.lang.Math 函数名（与 src/engine/mathfuncs.ts 注册表一致；
// ExprField 高亮与「可用函数」提示用）。新增函数时两处同步。

export const MATH_FUNC_NAMES = [
  'random',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'toRadians', 'toDegrees',
  'exp', 'log', 'log10', 'log1p', 'expm1',
  'sqrt', 'cbrt', 'sinh', 'cosh', 'tanh',
  'ulp', 'nextUp', 'nextDown', 'signum',
  'abs', 'incrementExact', 'decrementExact', 'negateExact',
  'atan2', 'pow', 'hypot', 'nextAfter', 'copySign',
  'max', 'min', 'ceil', 'floor', 'floorDiv', 'floorMod',
  'addExact', 'subtractExact', 'multiplyExact', 'scalb',
  'getExponent', 'round',
] as const;
