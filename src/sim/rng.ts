// 可注入 PRNG（normal 高斯偏移用）。算法 1:1 复刻 java.util.Random：
// 64 位线性同余（seed = seed*0x5DEECE66D + 0xB）+ nextGaussian 的 Marsaglia
// 极坐标法（含「第二个高斯值暂存」haveNextNextGaussian 语义 —— 连续两次
// nextGaussian() 的调用序列与 Java 一致）。
// 种子由 SimConfig.seed 注入，保证预览可复现；Java 原版 new Random() 用时间
// 种子，故绝对序列与 MC 实例无关，仅保证「同种子 → 同序列」。

const MASK64 = (1n << 64n) - 1n;
const MULT = 0x5deECE66Dn;
const ADD = 0xBn;

export class SimRandom {
  private seed: bigint;
  private haveNextNextGaussian = false;
  private nextNextGaussian = 0;

  constructor(seed: number) {
    // java.util.Random(long seed)：this.seed = (seed ^ 0x5DEECE66D) & mask
    this.seed = (BigInt(Math.trunc(seed)) ^ MULT) & MASK64;
  }

  /** java.util.Random.next(bits)：返回 [0, 2^bits) 的均匀整数
   *  （Java 原文：(int)((seed >>> (48 - bits)) & ((1L << bits) - 1))） */
  private next(bits: number): number {
    this.seed = (this.seed * MULT + ADD) & MASK64;
    return Number((this.seed >> BigInt(48 - bits)) & ((1n << BigInt(bits)) - 1n));
  }

  /**
   * nextDouble()（**JDK 21 实现**，javap 反编译确认）：
   * ((next(26) << 27) + next(27)) * 2^-53 —— 两次 next 调用。
   * （旧 JDK ≤20 的 next(53)*2^-53 单调用版本在 MC 目标环境不存在：
   *  MC 1.20.5+ 强制 Java 21，mod 支持 1.21~26.2 全走新实现。）
   * 值域 [0, 1)；两次调用均 < 2^53，JS number 精确。
   */
  nextDouble(): number {
    return (this.next(26) * 2 ** 27 + this.next(27)) * 1.1102230246251565e-16;
  }

  /**
   * java.util.Random.nextGaussian()：Marsaglia 极坐标法。
   * 注意 Java 原实现的暂存顺序：先算 multiplier，暂存 v2*multiplier，
   * 返回 v1*multiplier（第二次调用拿 v2 那份）。
   */
  nextGaussian(): number {
    if (this.haveNextNextGaussian) {
      this.haveNextNextGaussian = false;
      return this.nextNextGaussian;
    }
    let v1 = 0;
    let v2 = 0;
    let s = 0;
    do {
      v1 = 2 * this.nextDouble() - 1;
      v2 = 2 * this.nextDouble() - 1;
      s = v1 * v1 + v2 * v2;
    } while (s >= 1 || s === 0);
    const multiplier = Math.sqrt((-2 * Math.log(s)) / s);
    this.nextNextGaussian = v2 * multiplier;
    this.haveNextNextGaussian = true;
    return v1 * multiplier;
  }

  /** java.util.Random.nextInt(bound)（bound > 0；JDK 21 javap 逐行核对）：
   *  bound 为 2 的幂 → next(31) >>> (31-log2(bound))；否则 next(31) % bound
   *  （负结果补 bound）。本地 JDK 21 探针逐值验证（12/16/3/1000 等 bound）。
   *  用于原版粒子的逐 tick 随机寿命（end_rod = 60 + nextInt(12)）。 */
  nextInt(bound: number): number {
    if (bound <= 0) throw new Error('bound must be positive');
    if ((bound & (bound - 1)) === 0) {
      const bits = Math.log2(bound);
      return (this.next(31) >>> (31 - bits)) & (bound - 1);
    }
    let r = this.next(31);
    r %= bound;
    if (r < 0) r += bound;
    return r;
  }
}
