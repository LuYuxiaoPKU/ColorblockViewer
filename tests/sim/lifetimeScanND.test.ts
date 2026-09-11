// 寿命公式「nextDouble 域」固定种子采样对拍：dust / glow_squid / cloud 三类
// 公式走 java.util.Random.nextDouble()（2^53 域），全量直方图不可行 → 2^26 个
// 独立 int32 种子 s 各采样一次：seed = BASE ^ (s+1)（Java int32 XOR；JS 的 ^
// 同语义，符号位一致），每个种子跑一次公式，统计 lifetime 直方图，与 JDK 21
// 探针（/tmp/jprobe/ProbeScanND.java，逐字节码操作数顺序）2026-09-10 实测
// golden 逐桶比对。
//
// 种子与探针严格一致：Java 侧 `new Random((int)(BASE ^ (s+1)))` 与 TS 侧
// `new SimRandom(seed ^ (s+1))` 产生同一条 LCG 序列（SimRandom = 1:1 移植的
// java.util.Random，JDK21 逐值对拍过）。BASE 取 int32：DUST_BASE=123456789
// （dust+glow 共用一个种子序列，两公式各取一次 nextDouble——探针同序）、
// CLOUD_BASE=987654321。
//
// 公式（与 kinematics.ts 的 L.dust / L.doubleDiv / L.cloud 逐字一致）：
//   dust(glow)：(int)max(f32(t·f32(scale)), 1.0f)，t=(int)(N/(D·0.8d+0.2d))
//   glow：      t=(int)(8.0d/(D·0.8d+0.2d))（无 max）
//   cloud：     (int)max(f32(t·2.5f), 1.0f)，t=(int)(8.0d/(f2d(F)·0.8d+0.3d))
//   注意 dust 用 nextDouble、cloud 用 nextFloat（PlayerCloud 字节码 fload 域）。
//
// 运行成本：3 公式 × 2^26 ≈ 2e8 次迭代，本地 ~8s；CI 慢时给足超时。

import { describe, it, expect } from 'vitest';
import { SimRandom } from '../../src/sim/rng';

const NSEQ = 1 << 26;
const DUST_BASE = 123456789;
const CLOUD_BASE = 987654321;
const fr = Math.fround;

// —— 与 kinematics.ts 公式逐字一致 ——
const dust = (r: SimRandom) => {
  const t = Math.trunc(8.0 / (r.nextDouble() * 0.8 + 0.2));
  return Math.trunc(Math.max(fr(t * fr(1)), 1.0));
};
const glow = (r: SimRandom) => Math.trunc(8.0 / (r.nextDouble() * 0.8 + 0.2));
const cloud = (r: SimRandom) => {
  const t = Math.trunc(8.0 / (r.nextFloat() * 0.8 + 0.3));
  return Math.trunc(Math.max(fr(t * fr(2.5)), 1.0));
};

// —— ProbeScanND golden（JDK 21 实测；BASE=123456789 与 987654321；
//  各节桶数 32/32/20、总和均 = 2^26 = NSEQ，2026-09-10 已核对）——
// dust（glow 同种子序列、同值域，桶值完全一致——glow 无 max 但 D∈[0,1) 时
// t=8/(D·0.8+0.2) ≥ 10 > max 下界 1，max 永不生效，故直方图相同）：8..39
const G_DUST: Record<number, number> = {
  8: 9321136, 9: 7456909, 10: 6101107, 11: 5084261, 12: 4302062, 13: 3687486,
  14: 3195814, 15: 2796233, 16: 2466952, 17: 2192847, 18: 1962015, 19: 1765817,
  20: 1597645, 21: 1452396, 22: 1326114, 23: 1215596, 24: 1118349, 25: 1032327,
  26: 955854, 27: 887582, 28: 826365, 29: 771310, 30: 721638, 31: 676537,
  32: 635531, 33: 598145, 34: 563971, 35: 532635, 36: 503843, 37: 477333,
  38: 452845, 39: 430209,
};
// cloud（BASE=987654321）：17..65
const G_CLOUD: Record<number, number> = {
  17: 8389026, 20: 9321134, 22: 7456910, 25: 6101110, 27: 5083910, 30: 4301351,
  32: 3686871, 35: 3195285, 37: 2795875, 40: 2466950, 42: 2192965, 45: 1962341,
  47: 1766111, 50: 1597913, 52: 1452640, 55: 1326331, 57: 1215799, 60: 1118533,
  62: 1032500, 65: 645309,
};

describe('原版运动学：nextDouble 域寿命公式固定种子采样（vs JDK21 ProbeScanND）', () => {
  it('dust / glow（同种子序列）直方图 = JDK golden', { timeout: 120000 }, () => {
    const hd = new Map<number, number>();
    const hg = new Map<number, number>();
    const inc = (m: Map<number, number>, v: number) => m.set(v, (m.get(v) ?? 0) + 1);
    for (let s = 0; s < NSEQ; s++) {
      const seed = DUST_BASE ^ (s + 1); // int32 XOR（JS ^ = int32 语义）
      inc(hd, dust(new SimRandom(seed)));
      inc(hg, glow(new SimRandom(seed)));
    }
    expect(Object.fromEntries(hd)).toEqual(G_DUST);
    expect(Object.fromEntries(hg)).toEqual(G_DUST);
  });

  it('cloud（nextFloat 域、BASE=987654321）直方图 = JDK golden', { timeout: 120000 }, () => {
    const hc = new Map<number, number>();
    for (let s = 0; s < NSEQ; s++) {
      const seed = CLOUD_BASE ^ (s + 1);
      const v = cloud(new SimRandom(seed));
      hc.set(v, (hc.get(v) ?? 0) + 1);
    }
    expect(Object.fromEntries(hc)).toEqual(G_CLOUD);
  });
});
