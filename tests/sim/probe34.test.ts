import { describe, expect, it } from 'vitest';
import { evalForTest } from '../../src/engine';

// 与 Java Probe34 对拍（src 相同，错误消息相同）。
// 注意：Java 反射边界（ClassExpression.invoke 的 method.invoke）会把运行期异常
// 包成 RuntimeException(InvocationTargetException)，root cause 是真实异常；
// 本引擎按 golden 对拍惯例（GoldenMain.rootMsg）抛 **root** 消息。
const CASES: [string, string][] = [
  ['vy=1/0', 'java.lang.RuntimeException: need matrix, function call, assign expression, var, number'],
  ['x=1/0', 'java.lang.RuntimeException: need matrix, function call, assign expression, var, number'],
  ['a=1/0', 'java.lang.RuntimeException: need matrix, function call, assign expression, var, number'],
  ['destroy=1/(a-a)', 'java.lang.RuntimeException: undefine var: a'],
  // Java 外层 ITE；root = ArithmeticException
  ['1/0', 'java.lang.ArithmeticException: / by zero'],
  ['a=1;destroy=1/(a-a)', 'java.lang.ArithmeticException: / by zero'],
];
const OK: [string, number][] = [
  ['vy=1/2-1', -1.0],
  ['vy=1.0/0', 2147483647], // Java: 2.147483647E9
];

describe('probe34 对拍', () => {
  it.each(CASES)('%s', (src, want) => {
    expect(() => evalForTest(src)).toThrow(want);
  });
  it.each(OK)('%s', (src, want) => {
    expect(evalForTest(src)).toBe(want);
  });
});
