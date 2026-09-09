// 原版粒子的类型专属运动学与寿命（MC 26.2 client.jar 混淆版 javap 逐字节码核对，
// 见 docs/技术路线.md §10 证据清单）。
//
// 设计：引擎默认**不做**类型专属运动（1:1 复刻模组，模组不覆写
// velocityMultiplier/gravityStrength）。「原版运动学」设置开启后，本表列出
// 的类型套用原版常量；未列出的类型保持模组行为（匀速直线）。
//
// 通用管道（Particle.tick，26.2 字节码）：
//   save pre → age++ → age>=lifetime 死亡 → yd −= 0.04d×f2d(gravity:F) →
//   move(xd,yd,zd) → [speedUpWhenYMotionIsBlocked && 碰撞]（预览无碰撞，不建模）
//   → 三轴 ×= f2d(friction:F) → [onGround ×= 0.7]（预览不建模）。
// 表值约定：friction/gravityY 均为 Java float 字段 f2d 加宽后的精确 double
//   （friction = fround(十进制字面量)；base 管道 gravityY = −0.04d×fround(gravity)
//   在 double 域先乘后减；自管 tick = 其 tick 里的实际 yd 增量）。
//   例外：SuspendedTown 系 friction 是字节码里的 double 常量 0.99d（非 f2d）。
//
// 自管 tick 的类型（不复用通用管道）：
//   - water_drop/splash：WaterDrop.tick —— yd −= gravity（直接，无 0.04 系数）、
//     move 后三轴 ×0.98、lifetime--（≡ age++）。无碰撞/落地分支（预览无世界）。
//   - suspended_town 系：SuspendedTown.tick —— move 后三轴 ×0.99，无重力。
//   - snowflake：super.tick() 后追加 per-axis 阻尼（xd×0.95f, yd×0.9f, zd×0.95f）。
//   - campfire_*：CampfireSmoke.tick —— 三轴无摩擦、yd −= 3.0E-6f（直接）、
//     每 tick F/5000± 漂移（预览不建模，量级 2e-4/tick 可忽略）、
//     出生初速 yd = cmdVy + 500.0f/F（FLOAT 除法；预览在 spawn 时消费
//     vanillaRand 一个 nextFloat 近似 —— Java 侧是粒子私有随机，不可复现）。
//   - portal：位置绝对式 x = xStart + xd·e(t) 等（e = 3t²−2t³ 的浮点计算，
//     t = age/lifetime，fdiv）；y 另加 (1−t)。xStart = 命令位置。
//   - reverse_portal：位置增量式 每 tick x += xd·t（t = age/lifetime，fdiv）。
//
// 构造器随机消费约定（与 end_rod 先例一致）：预览共享 vanillaRand 只消费
// 「寿命公式本身」的随机数（+ campfire 的初速 float）。构造器里寿命公式之前的
// 随机（粒子私有 RandomSource.create()，种子不可复现）不消费 —— 与 Java 的
// 绝对值不同，但分布一致，且同种子可复现。
//
// 未建模（文档化为近似）：speedUpWhenYMotionIsBlocked（需碰撞）、onGround、
// 每 tick 的随机（lava 烟生成、campfire 漂移、rain 落地 50% 移除）、
// 构造器位置抖动（flame/soul 6F）、逐粒子随机种子。
//
// 版本分区：本表证据仅来自 26.2 字节码 → 新类型只进 '26.2'；'1.21.11' 保留
// end_rod（1.21.1 反编译核对）。1.21.1 未逐类型核对，不臆测（八荣八耻 #1）。

export type MotionKind = 'base' | 'portal' | 'reverse_portal';

export interface NativeKinematics {
  /** 运动模型：base = 通用管道；portal/reverse_portal = 自管位置式（无摩擦/重力） */
  motion?: MotionKind;
  /** 每 tick 速度乘法衰减（friction；位移**之后**；motion != base 时忽略） */
  friction: number;
  /** 每 tick 先于位移施加的 y 方向加速度（blocks/tick²；motion != base 时忽略） */
  gravityY: number;
  /** super.tick() 摩擦步之后的逐轴附加阻尼（snowflake：0.95/0.9/0.95，float→double） */
  postFriction?: [number, number, number];
  /** spawn 时叠加出生初速 yd += fround(500/F)（campfire；F = 下一个 vanillaRand nextFloat） */
  campfireRise?: boolean;
}

export const NATIVE_KINEMATICS: Record<string, Record<string, NativeKinematics>> = {
  '1.21.11': {
    end_rod: { friction: 0.9100000262260437, gravityY: -0.0005000000074505806 },
  },
  '26.2': {
    // 常量来源（26.2 javap）：
    //  friction 字段 putfield 值 / gravity 字段 putfield 值 / 自管 tick 常量。
    //  friction/gravityY = f2d 加宽后的精确 double（见文件头约定）；
    //  base 管道 gravityY = −0.04d×fround(gravity)，在 double 域先乘后减。
    end_rod: { friction: 0.9100000262260437, gravityY: -0.0005000000074505806 }, // SimpleAnimated fround(0.91f)；EndRod fround(0.0125f)
    totem_of_undying: { friction: 0.6000000238418579, gravityY: -0.05 }, // Totem：friction 0.6f；gravityY = −0.04d×fround(1.25f)（恰精确）
    heart: { friction: 0.8600000143051147, gravityY: 0 }, // Heart：friction 0.86f；无 gravity 覆写（默认 0）
    angry_villager: { friction: 0.8600000143051147, gravityY: 0 }, // Heart$AngryVillagerProvider
    note: { friction: 0.6600000262260437, gravityY: 0 }, // Note：friction 0.66f
    snowflake: {
      friction: 1.0, // Snowflake：friction fconst_1
      gravityY: -0.008999999761581421, // −0.04d×fround(0.225f)
      postFriction: [0.949999988079071, 0.8999999761581421, 0.949999988079071], // 0.95f/0.9f/0.95f → double
    },
    glow: { friction: 0.9599999785423279, gravityY: 0 }, // Glow：friction 0.96f
    flame: { friction: 0.9599999785423279, gravityY: 0 }, // Rising：friction 0.96f
    small_flame: { friction: 0.9599999785423279, gravityY: 0 },
    copper_fire_flame: { friction: 0.9599999785423279, gravityY: 0 },
    soul_fire_flame: { friction: 0.9599999785423279, gravityY: 0 },
    soul: { friction: 0.9599999785423279, gravityY: 0 }, // Soul→Rising
    sculk_soul: { friction: 0.9599999785423279, gravityY: 0 },
    effect: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 }, // Spell：−0.04d×fround(−0.1f)
    instant_effect: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 },
    witch: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 },
    entity_effect: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 },
    infested: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 },
    raid_omen: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 },
    trial_omen: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 },
    lava: { friction: 0.9990000128746033, gravityY: -0.03 }, // Lava：friction 0.999f；gravityY = −0.04d×fround(0.75f)（恰精确）
    rain: { friction: 0.9800000190734863, gravityY: -0.05999999865889549 }, // WaterDrop 自管 tick：yd −= f2d(gravity)，gravity fround(0.06f)
    splash: { friction: 0.9800000190734863, gravityY: -0.03999999910593033 }, // Splash 覆写 gravity fround(0.04f)
    underwater: { friction: 1.0, gravityY: 0 }, // Suspended：friction fconst_1
    spore_blossom_air: { friction: 1.0, gravityY: 0 },
    crimson_spore: { friction: 1.0, gravityY: 0 },
    warped_spore: { friction: 1.0, gravityY: 0 },
    composter: { friction: 0.99, gravityY: 0 }, // SuspendedTown 自管 tick：×0.99d
    dolphin: { friction: 0.99, gravityY: 0 },
    happy_villager: { friction: 0.99, gravityY: 0 },
    egg_crack: { friction: 0.99, gravityY: 0 },
    mycelium: { friction: 0.99, gravityY: 0 },
    smoke: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 }, // BaseAshSmoke：gravity 参数 −0.1f
    white_smoke: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 },
    large_smoke: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 },
    ash: { friction: 0.9599999785423279, gravityY: -0.004000000059604645 }, // Ash：gravity 参数 +0.1f
    white_ash: { friction: 0.9599999785423279, gravityY: -0.004000000059604645 },
    item: { friction: 0.9800000190734863, gravityY: -0.04 }, // Base 默认 friction 0.98f；gravityY = −0.04d×fround(1.0f)（恰精确）
    item_slime: { friction: 0.9800000190734863, gravityY: -0.04 },
    item_cobweb: { friction: 0.9800000190734863, gravityY: -0.04 },
    item_snowball: { friction: 0.9800000190734863, gravityY: -0.04 },
    sulfur_cube_goo: { friction: 0.9800000190734863, gravityY: -0.04 },
    shriek: { friction: 0.9800000190734863, gravityY: 0 }, // Shriek：无覆写（Base 0.98f）；gravity fconst_0
    squid_ink: { friction: 0.9200000166893005, gravityY: 0 }, // SquidInk：friction 0.92f
    glow_squid_ink: { friction: 0.9200000166893005, gravityY: 0 },
    portal: { motion: 'portal', friction: 1, gravityY: 0 },
    reverse_portal: { motion: 'reverse_portal', friction: 1, gravityY: 0 },
    campfire_cosy_smoke: { friction: 1.0, gravityY: -0.000003000000106112566, campfireRise: true }, // yd −= f2d(gravity)，gravity 3.0E-6f
    campfire_signal_smoke: { friction: 1.0, gravityY: -0.000003000000106112566, campfireRise: true },
    // water_current_down 未收录：tick 含水流块检查（移除/速度分支依赖世界状态）。
  },
};

// ---------- 寿命公式（构造器字节码逐式复刻；F = 下一个 nextFloat，I(n) = 下一个 nextInt(n)）----------

/**
 * 公式求值：返回 (r) => ticks。消费顺序 = 字节码里的调用顺序（公式内单次 F 只消费一次）。
 * 精度逐字复刻：double 常量用 double 运算；float 常量先 Math.fround；
 * (int) = Math.trunc（Java 浮点转 int 截断向零）。
 */
export type NativeLifetimeFormula = (r: { nextFloat(): number; nextInt(bound: number): number }) => number;
type RngLike = { nextFloat(): number; nextInt(bound: number): number };

const L = {
  /** (int)(N/(F·0.8d+0.2d)) —— double 家族（lava/water_drop/suspended/town/scale 基底）。
   *  字节码顺序 nextFloat→f2d→0.8d dmul→0.2d dadd→ddiv：F 先乘 0.8（曾误写成
   *  N/(0.8+0.2F)，分母被压窄，2026-09-08 审查后按 javap 更正，ProbeLifetime2 实测） */
  div: (n: number) => (r: RngLike) => Math.trunc(n / (r.nextFloat() * 0.8 + 0.2)),
  /** (int)(6.0d/(F·0.8d+0.6d)) —— crit（同 div 顺序，crit 用 0.6d） */
  crit: (r: RngLike) => Math.max(Math.trunc(6.0 / (r.nextFloat() * 0.8 + 0.6)), 1),
  /** max((int)((N/(F·0.8d+0.2d))·f2d(scale)),1) —— BaseAshSmoke（javap 1:1：
   *  除法结果为 double，乘 f2d(float scale)，**末尾单次** d2i 截断） */
  ashScale: (n: number, scale: number) => (r: RngLike) =>
    Math.max(Math.trunc((n / (r.nextFloat() * 0.8 + 0.2)) * Math.fround(scale)), 1),
  /** (int)(N/(F·0.8d+0.2d)) + K —— snowflake(+2) / flame(+4) */
  divPlus: (n: number, k: number) => (r: RngLike) => Math.trunc(n / (r.nextFloat() * 0.8 + 0.2)) + k,
  /** (int)(4.0f/(0.9f·F+0.1f)) —— BaseParticle 默认（item/glow；全程 float，
   *  每步 Java 浮点运算都舍入：fmul→fround(0.9f·F)（0.9f 用 fround 取精确
   *  float 值，0.9d≠0.9f）、fadd→fround(·+0.1f)、fdiv→fround；(int) 截断。
   *  全 2^24 域直方图与 JDK21 逐桶一致（ProbeScan） */
  base: (r: RngLike) => Math.trunc(Math.fround(4.0 / Math.fround(Math.fround(Math.fround(0.9) * r.nextFloat()) + Math.fround(0.1)))),
  /** (int)((12.0f·0.5f)/(0.8f·F+0.2f)) —— SquidInk（同 base 的 float 链；
   *  12.0f·0.5f=6.0f 精确） */
  squid: (r: RngLike) => Math.trunc(Math.fround(6.0 / Math.fround(Math.fround(Math.fround(0.8) * r.nextFloat()) + Math.fround(0.2)))),
  /** 40 + (int)(10.0f·F) —— portal */
  portal: (r: RngLike) => 40 + Math.trunc(Math.fround(10.0 * r.nextFloat())),
  /** 60 + (int)(2.0f·F) —— reverse_portal：F<0.5→60、F≥0.5→61（各半；
   *  曾误读为 2·(int)F 恒 60，2026-09-08 按 javap `fmul fconst_2 → f2i` 更正） */
  reversePortal: (r: RngLike) => 60 + Math.trunc(Math.fround(2.0 * r.nextFloat())),
  /** min + nextInt(extra) —— end_rod/totem/campfire */
  int: (min: number, extra: number) => (r: RngLike) => min + r.nextInt(extra),
  /** 常量 —— heart 16 / note 6 / shriek 30 */
  const: (n: number) => () => n,
};

export const NATIVE_LIFETIME: Record<string, Record<string, NativeLifetimeFormula>> = {
  '1.21.11': {
    end_rod: L.int(60, 12),
  },
  '26.2': {
    end_rod: L.int(60, 12), // EndRod：60 + I(12)
    totem_of_undying: L.int(60, 12), // Totem：60 + I(12)（后缀 I(4)+颜色 F 不消费）
    crit: L.crit,
    heart: L.const(16),
    angry_villager: L.const(16),
    note: L.const(6),
    snowflake: L.divPlus(16, 2),
    glow: L.base,
    flame: L.divPlus(8, 4), // Rising：(int)(8.0d/(0.8d·F+0.2d)) + 4
    small_flame: L.divPlus(8, 4),
    copper_fire_flame: L.divPlus(8, 4),
    soul_fire_flame: L.divPlus(8, 4),
    soul: L.divPlus(8, 4),
    sculk_soul: L.divPlus(8, 4),
    effect: L.div(8), // Spell：(int)(8.0d/(0.8d·F+0.2d))
    instant_effect: L.div(8),
    witch: L.div(8),
    entity_effect: L.div(8),
    infested: L.div(8),
    raid_omen: L.div(8),
    trial_omen: L.div(8),
    lava: L.div(16),
    rain: L.div(8), // WaterDrop：(int)(8.0d/(0.8d·F+0.2d))
    splash: L.div(8),
    underwater: L.div(16), // Suspended
    spore_blossom_air: L.div(16),
    crimson_spore: L.div(16),
    warped_spore: L.div(16),
    composter: L.div(20), // SuspendedTown
    dolphin: L.div(20),
    happy_villager: L.div(20),
    egg_crack: L.div(20),
    mycelium: L.div(20),
    smoke: L.ashScale(8, 0.3),
    white_smoke: L.ashScale(8, 0.3),
    large_smoke: L.ashScale(8, 2.5), // LargeSmoke：scale 参数 2.5f
    ash: L.ashScale(20, 0.5), // Ash：N=20（bipush 20）
    white_ash: L.ashScale(20, 0.0125), // WhiteAsh：scale 0.0125f
    item: L.base,
    item_slime: L.base,
    item_cobweb: L.base,
    item_snowball: L.base,
    sulfur_cube_goo: L.base,
    shriek: L.const(30),
    squid_ink: L.squid, // (int)(6.0f/(0.8f·F+0.2f))
    glow_squid_ink: L.squid,
    portal: L.portal,
    reverse_portal: L.reversePortal,
    campfire_cosy_smoke: L.int(280, 50),
    campfire_signal_smoke: L.int(80, 50),
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

/** 该类型的原版寿命公式（模组只在命令 age>0 / -1 时 setLifetime 覆写，age=0 保持
 *  构造器默认 → 仅命令 age=0 时生效，显式 age 优先，忠实模组调用顺序）。
 *  返回 null = 该类型无原版寿命表项（走命令/默认寿命路径）。 */
export function nativeLifetimeFor(name: string, version = '26.2'): NativeLifetimeFormula | null {
  return NATIVE_LIFETIME[version]?.[normKey(name)] ?? null;
}
