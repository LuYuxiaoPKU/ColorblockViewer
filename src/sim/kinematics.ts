// 原版粒子的类型专属运动学（1.21.1 反编译 Yarn 镜像逐字核对，
// 见 docs/技术路线.md §10 证据清单）。
//
// 设计：引擎默认**不做**类型专属运动（1:1 复刻模组，模组不覆写
// velocityMultiplier/gravityStrength）。「原版运动学」设置开启后，本表列出
// 的类型套用原版常量；未列出的类型保持模组行为（匀速直线）——当前证据仅
// 覆盖 end_rod，不臆测其他类型的参数。
//
// end_rod 的三条常量（来源）：
//  - friction 0.91/tick：AnimatedParticle（Yarn 名 SimpleAnimatedParticle）
//    覆写 velocityMultiplier = 0.91F，Particle.tick 每 tick velocity *= 0.91
//    （总位移 ≈ 11×v₀，指数衰减）；
//  - gravity −5×10⁻⁴/tick²：EndRodParticle 覆写 gravityStrength = 0.0125F，
//    Particle.tick 先 velocityY -= 0.04 × gravityStrength 再做位移；
//  - 无世界碰撞：EndRodParticle 覆写 move() 只平移不检测（模组粒子本来就
//    不受碰撞，无需处理）。

export interface NativeKinematics {
  /** 每 tick 速度乘法衰减（friction；velocity *= friction 在位移**之后**） */
  friction: number;
  /** 每 tick 先于位移施加的 y 方向加速度（blocks/tick²，负值 = 重力） */
  gravityY: number;
}

/** 有反编译证据的原版运动学类型（按版本分区，与贴图/类型表同构）。
 *  未收录类型 → undefined（不套用）。 */
export const NATIVE_KINEMATICS: Record<string, Record<string, NativeKinematics>> = {
  '1.21.11': {
    end_rod: { friction: 0.91, gravityY: -0.0005 },
  },
  '26.2': {
    end_rod: { friction: 0.91, gravityY: -0.0005 },
  },
};

/** 粒子名归一化：小写 + 去 `minecraft:` 命名空间前缀。 */
function normKey(name: string): string {
  let key = name.toLowerCase();
  const i = key.indexOf(':');
  if (i >= 0) key = key.slice(i + 1);
  return key;
}

/** 粒子名 → 原版运动学参数（小写 + 去 `minecraft:` 前缀；未收录 → null）。 */
export function nativeSpecFor(name: string, version = '26.2'): NativeKinematics | null {
  return NATIVE_KINEMATICS[version]?.[normKey(name)] ?? null;
}

/** 该类型的原版随机寿命（EndRodParticle 构造器 maxAge = 60 + random.nextInt(12)，
 *  1.21.1 反编译；模组只在命令 age>0 / -1 时调 setLifetime 覆写，age=0 保持原版
 *  → 仅命令 age=0 时本表生效，显式 age 优先，忠实模组调用顺序）。
 *  返回 null = 该类型无原版随机寿命（按命令/默认寿命路径）。 */
export const NATIVE_LIFETIME: Record<string, Record<string, { min: number; extra: number }>> = {
  '1.21.11': { end_rod: { min: 60, extra: 12 } },
  '26.2': { end_rod: { min: 60, extra: 12 } },
};

export function nativeLifetimeFor(name: string, version = '26.2'): { min: number; extra: number } | null {
  return NATIVE_LIFETIME[version]?.[normKey(name)] ?? null;
}
