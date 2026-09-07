// PRNG 对拍（golden：JDK 21 Probe33 实测输出，2026-09-04）。
// SimRandom 必须与 java.util.Random 同种子 → 同序列（位级一致），
// 否则 normal 的高斯偏移布局与游戏内不一致。

import { describe, expect, it } from 'vitest';
import { SimRandom } from '../../src/sim/rng';

describe('SimRandom（对拍 java.util.Random，JDK 21）', () => {
  it('seed=12345 的 nextDouble 序列 bit-exact', () => {
    const r = new SimRandom(12345);
    const d = [r.nextDouble(), r.nextDouble(), r.nextDouble(), r.nextDouble()];
    expect(d).toEqual([0.3618031071604718, 0.932993485288541, 0.8330913489710237, 0.32647575623792624]);
  });

  it('seed=12345 的 nextGaussian 序列 bit-exact（含暂存第二次取值）', () => {
    const r = new SimRandom(12345);
    const g: number[] = [];
    for (let i = 0; i < 8; i++) g.push(r.nextGaussian());
    expect(g).toEqual([
      -0.187808989658912,
      0.5884363051154796,
      0.9488047804400426,
      -0.49428072062604445,
      -1.223411937180115,
      -0.6979609783968826,
      -0.7772248954648805,
      2.0680086995267,
    ]);
  });

  it('seed=0 的 nextGaussian 序列 bit-exact', () => {
    const r = new SimRandom(0);
    const g: number[] = [];
    for (let i = 0; i < 4; i++) g.push(r.nextGaussian());
    expect(g).toEqual([0.8025330637390305, -0.9015460884175122, 2.080920790428163, 0.7637707684364894]);
  });

  it('同种子可复现，异种子不同序', () => {
    const a = new SimRandom(7);
    const b = new SimRandom(7);
    const c = new SimRandom(8);
    for (let i = 0; i < 5; i++) {
      expect(a.nextGaussian()).toBe(b.nextGaussian());
    }
    expect(new SimRandom(7).nextGaussian()).not.toBe(c.nextGaussian());
  });

  it('nextInt(bound) 序列 bit-exact（JDK 21 ProbeInt，2026-09-08 实测）', () => {
    expect(seq((r) => r.nextInt(12), 1, 8)).toEqual([9, 4, 7, 9, 2, 4, 2, 10]);
    // bound=16 是 2 的幂 → 位提取分支（非取模）
    expect(seq((r) => r.nextInt(16), 7, 6)).toEqual([11, 10, 11, 0, 5, 7]);
    expect(seq((r) => r.nextInt(3), 42, 10)).toEqual([2, 0, 0, 2, 0, 1, 2, 2, 1, 2]);
    expect(seq((r) => r.nextInt(1000), 42, 5)).toEqual([130, 763, 248, 884, 970]);
  });

  it('nextInt 值域 [0, bound)', () => {
    const r = new SimRandom(3);
    for (let i = 0; i < 200; i++) {
      const v = r.nextInt(17);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(17);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextInt 非法 bound → 抛错', () => {
    const r = new SimRandom(3);
    expect(() => r.nextInt(0)).toThrow();
    expect(() => r.nextInt(-5)).toThrow();
  });
});

function seq(f: (r: SimRandom) => number, seed: number, n: number): number[] {
  const r = new SimRandom(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(f(r));
  return out;
}
