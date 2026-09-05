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
});
