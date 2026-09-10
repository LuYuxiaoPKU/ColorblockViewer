import { describe, expect, it } from 'vitest';
import { parse, evalForTest } from '../../src/engine';
import { ParseDepthError } from '../../src/engine/types';
import { SimEngine } from '../../src/sim/engine';
import type { SimConfig } from '../../src/sim/types';

// #44 运行时防护 + 显式提示（用户拍板「运行时防护 + 显式提示」，语义层 1:1 不变）：
// ① 深嵌套括号：1:1 解析器的 snapshot/recovery 回溯指数爆炸（Java 原版同样
//    挂死——Probe25 对真实 Java 源码实锤 12 外包层 ~65ms / 16 外包层 ~0.7s /
//    20 外包层挂死）。防护：同时开启括号数 > 13（= 12 外包层）中止 + 明确
//    提示，而非冻结标签页。
// ② 浮点步长死循环：t+step===t（定点不收敛）或 begin/end 极端（~1e16 量级）
//    时 Java 游戏内 = 命令队列冻结；预览显式中止 + 提示。

function cfg(over: Partial<SimConfig> = {}): SimConfig {
  return {
    playerPos: { x: 0, y: 0, z: 0 },
    defaultLifetime: 20,
    maxParticles: 20000,
    seed: 1,
    mcVersion: '26.2',
    gridSize: 10,
    gridVisible: true,
    nativeKinematics: false,
    ...over,
  };
}

// 外包 d 层：depthStr(3) = '(((1+2)))'（同时开启括号数 = d+1）
function depthStr(d: number): string {
  return '(' .repeat(d) + '(1+2)' + ')' .repeat(d);
}

describe('深嵌套括号防护', () => {
  it('≤12 外包层正常解析（12 外包层 ~65ms 量级，允许）', () => {
    for (const d of [1, 3, 5, 8, 10, 12]) {
      const v = evalForTest(depthStr(d));
      expect(v).toBe(3);
    }
  });

  it('13 外包层 → ParseDepthError（中文提示：Java 会卡死）', () => {
    expect(() => parse(depthStr(13))).toThrow(ParseDepthError);
    expect(() => parse(depthStr(13))).toThrow(/括号嵌套过深/);
    expect(() => parse(depthStr(13))).toThrow(/Java 原版/);
    expect(() => parse(depthStr(13))).toThrow(/浅层/);
  });

  it('20 外包层（Java 挂死量级）同样快速中止', () => {
    const t0 = Date.now();
    expect(() => parse(depthStr(20))).toThrow(ParseDepthError);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('回滚重试不泄漏深度：先失败表达式、后合法浅层括号仍可通过', () => {
    expect(() => evalForTest('x,=1')).toThrow();
    expect(evalForTest('((1+2))*3')).toBe(9);
  });
});

describe('浮点步长死循环防护', () => {
  const eng = (over: Partial<SimConfig> = {}) => new SimEngine(cfg(over));

  it('定点不收敛（begin=end=2^53, step=0.5：t+step===t）→ 显式中止', () => {
    // 2^53 处 ulp=2：t+0.5 四舍五入回 t（round-to-even）——Java 版同输入
    // = for 循环永不前进 = 命令队列冻结。第一步即触发。
    const e = eng();
    const cmd = {
      kind: 'parameter', name: 'flame', polar: false, tick: false, rgba: false,
      pos: { x: { v: 0, rel: false }, y: { v: 0, rel: false }, z: { v: 0, rel: false } },
      color: { r: 1, g: 1, b: 1, a: 1 },
      speed: { x: 0, y: 0, z: 0 },
      begin: 9007199254740992, end: 9007199254740992,
      expression: 'x=t', step: 0.5, cpt: 10, age: 0,
      speedExpression: null, speedStep: 1, group: null,
    } as const;
    expect(() => e.runCommand(cmd)).toThrow(/浮点步长不收敛/);
    expect(() => e.runCommand(cmd)).toThrow(/Java 版/);
  });

  it('begin/end 极端（0..1.1e16, step 1：~1e16 次迭代）→ 迭代超限中止', () => {
    const e = eng();
    const cmd = {
      kind: 'parameter', name: 'flame', polar: false, tick: false, rgba: false,
      pos: { x: { v: 0, rel: false }, y: { v: 0, rel: false }, z: { v: 0, rel: false } },
      color: { r: 1, g: 1, b: 1, a: 1 },
      speed: { x: 0, y: 0, z: 0 },
      begin: 0, end: 1.1e16,
      expression: 'x=t', step: 1, cpt: 10, age: 0,
      speedExpression: null, speedStep: 1, group: null,
    } as const;
    expect(() => e.runCommand(cmd)).toThrow(/迭代次数超限/);
  });

  it('常规量级不受影响（range 10/step 0.1 = 201 点）', () => {
    const e = eng();
    e.runCommand({
      kind: 'conditional', name: 'flame',
      pos: { x: { v: 0, rel: false }, y: { v: 0, rel: false }, z: { v: 0, rel: false } },
      color: { r: 1, g: 1, b: 1, a: 1 },
      speed: { x: 0, y: 0, z: 0 },
      range: { x: 10, y: 0, z: 0 },
      expression: 'null', step: 0.1, age: 0,
      speedExpression: null, speedStep: 1, group: null,
    } as const);
    expect(e.snapshot().length).toBe(201);
  });
});
