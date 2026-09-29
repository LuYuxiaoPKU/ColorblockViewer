// CSP 回退路径测试：new Function 不可用（CSP 环境）时 codegenBlock 返回 null，
// parse 层（index.ts）回退闭包后端——本测试用 vi.mock 把 codegenBlock 恒定
// 替换为 null 模拟该环境，锁「回退接线存在且数值/错误与闭包后端一致」。
// 正常环境（new Function 可用）下 codegen 主路径由 codegenParity 对拍覆盖。

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/engine/codegen', () => ({ codegenBlock: (): null => null }));

import { parse } from '../../src/engine/index';
import { compileBlock } from '../../src/engine/compiler';
import { Lexer } from '../../src/engine/lexer';
import { Parser } from '../../src/engine/parser';
import { ParticleStruct } from '../../src/engine/struct';

// 与 codegenParity 同形态的语料（双值初值，避免 0 掩盖转换差异）
const SRCS = [
  'a=1.5;sin(a*t)+max(x,y)',
  '(1,2)*(2,1)+3',
  '0&(1/0)', // 短路
  '1/0', // 运行期 int 除零
  'a=(b=3);a+b', // 嵌套赋值
  'abs(-2147483648)', // int 回绕
  'x+q', // 运行期 undefine var
  'a=1;a<2', // 定型 int 比较
  'a=1.5;a>=1.0', // 定型 double 比较
  '(1,2;3,4)^2', // 矩阵幂
  '(1,2;3,4)*(1,2)', // 运行期 AIOOBE
];

function ref(src: string): { v: number; msg?: string } {
  try {
    return { v: compileBlock(new Parser(new Lexer(src)).parseBlock())(new ParticleStruct()) };
  } catch (e) {
    return { v: 0, msg: (e as Error).message };
  }
}

describe('CSP 回退（codegen 不可用 → 闭包后端）', () => {
  it('parse 不抛（回退接线存在）且结果与闭包后端一致', () => {
    for (const src of SRCS) {
      const r = ref(src);
      let got: { v: number; msg?: string };
      try {
        got = { v: parse(src).run(new ParticleStruct()) };
      } catch (e) {
        got = { v: 0, msg: (e as Error).message };
      }
      expect(got.msg ?? null).toBe(r.msg ?? null);
      if (r.msg === undefined) expect(Object.is(got.v, r.v)).toBe(true);
    }
  });
});
