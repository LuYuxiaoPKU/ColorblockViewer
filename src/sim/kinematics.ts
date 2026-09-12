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
// 自管 tick 的类型（不复用通用管道，表内值 = 其 tick 的逐 tick 实际效果）：
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
//   - vibration：VibrationSignalParticle.tick —— 构造器零速 + lifetime =
//     arrival_in_ticks（NBT 直传）；age++/死亡判定 → target 空 remove →
//     t = 1.0d/(lifetime−age)（int 差 i2d 后纯 double 除法，无 float 舍入）→
//     x = Mth.lerp(t, x, target.x) 三轴（= x + (target−x)·t，末 tick 恰好落点）
//     → rot/pitch 每 tick 重算（纯渲染）。tick 不调 super。预览 target =
//     destination 的 block 中心（+0.5 各轴；SAFE_POSITION_SOURCE 已排除
//     entity 源）；stop 回滚与 trail 同门（模组 customTick 在 tick() 后回滚）。
//   - dripping_*（hang 系）：DripHang.tick —— lifetime--（≡ age++）、
//     yd −= f2d(gravity)（直接）、move、postMoveUpdate 三轴 ×0.02d（drip 悬挂
//     的黏滞）、三轴 ×0.9800000190734863d（DripParticle.tick 尾部恒有）。
//     ≡ 引擎 base 管道（friction=0.02 + postFriction=[0.98×3]，顺序一致）。
//   - falling_* / landing_*：Drip 系 tick 同 dripping_* 但无 postMove 0.02d
//     （FallAndLand.postMoveUpdate = onGround 移除 + 落地粒子，预览无世界）。
//   - bubble / bubble_column_up / bubble_pop / dragon_breath / fishing /
//     crit 系 / explosion / sonic_boom / gust / spit / poof：自管 tick，但
//     逐 tick 增量与 base 管道同构（或 = 常量 friction），表内值即逐 tick
//     实际效果；差异分支（气泡出水平移、dragon_breath 落地弹跳、crit 构造器
//     末尾多 tick() 一次的 off-by-one、gust 系自管 age++/sprite）预览不建模。
//
// 出生初速（spawn 时一次性应用；预览共享 vanillaRand 可复现）：
//   - spawnVelocityMul：Java 构造器里无条件的 v *= 常量（dust 0.1d、crit 0.4d、
//     bubble 0.2d、scrape/wax 0.01d、spark 0.25d；Java 侧先 ×常量 再 ±抖动/
//     加 cmdV —— 常量因子与加法可交换，预览对模组 cmdV 整体 ×常量，见下方
//     近似清单）。0 = Java 侧零速构造：explosion/sonic_boom/flash/gust 系、
//     falling_dust（3 参 SingleQuadParticle(level,x,y,z,sprite) 不带速度参数、
//     provider 也不传命令速度 → 命令速度被丢弃）。
//   - 判定口径（2026-09-12 第五轮稽核，逐类改查 super 调用）：常量因子只作用于
//     **命令速度**时才写 spawnVelocityMul。Java 侧 6 参 Particle 构造器先
//     `xd = 命令速度 + (2F−1)·0.4f 抖动`，随后任何 `xd *= k` 同时缩放两者
//     （dust/crit/bubble/bubble_column_up/glow 属此类 → 写法成立）；而在**零速**
//     super 之后 `xd *= k … xd += 命令速度` 的顺序里，k 只作用于抖动
//     （BaseAshSmoke 的 r/g/b 三参即此语义 → 一律不写 spawnVelocityMul）。
//   - spawnVel：provider/构造器侧的精确初速表达式（无随机消费；与 spawnVelocityMul
//     互斥）—— damage_indicator 的 Provider 传 (cmdVx, cmdVy+1.0d, cmdVz)、
//     CritParticle 再统一 ×0.4d → y = (cmdVy+1)·0.4d（多出 +0.4d 项）。
//   - spawnVelOffsetY：SimpleVertical 构造器 yd += up?0.03d:−0.03d（确定性）。
//   - campfireRise：见上。
//   - falling_dust：自管 tick（SingleQuadParticle 无默认 tick 实现；FallingDust
//     本体 = save pre → age++/死亡 → setSpriteFromAge/roll 渲染更新 →
//     move(xd,yd,zd) → yd −= 0.003d → yd = max(yd, −0.14d)）—— ≡ 引擎 base
//     管道 friction=1.0 + gravityY=−0.003d（**位移后**施加，gravityPost）+
//     terminalVy=−0.14d（顺序一致：先位移、再减重力、再终端速度钳制；
//     无摩擦/碰撞分支）。
//
// 构造器随机消费约定（与 end_rod 先例一致）：预览共享 vanillaRand 只消费
// 「寿命公式本身」的随机数（+ campfire 的初速 float）。构造器里寿命公式之前的
// 随机（粒子私有 RandomSource.create()，种子不可复现）不消费 —— 与 Java 的
// 绝对值不同，但分布一致，且同种子可复现。例：noxious_gas 公式前的 3 个
// nextFloat（基类 quadSize + BaseAshSmoke 颜色 + 第一寿命）、falling_dust
// 公式前的 1 个（基类 quadSize）均不消费。
//
// 出生初速的近似（构造器里的 per-particle 随机/选项依赖抖动，预览不消费、不建模）：
//   - dust/dust_color_transition：Java ×0.1d 后无附加（精确）；颜色 F 抖动不建模。
//   - glow：Java 速度 = (0.5−D, cmdVy, 0.5−D)（D = nextDouble×2 次）+ 条件
//     x/z×0.1d（仅 cmdVx==0 && cmdVz==0）+ yd×0.2d —— 预览只近似 yd×0.2d
//     （spawnVelocityMul）；x/z 的 (0.5−D) 替换与条件缩放不建模。
//   - crit 系：Java = cmdV×0.4d + 0.1d（构造器先零速 super 再叠加 —— 预览
//     对模组 cmdV ×0.4d，缺 +0.1d 常数项，量级小）。
//   - bubble / bubble_column_up：Java = cmdV×0.2d + (2F−1)×0.02f 三轴抖动。
//   - spit / poof：Java = cmdV + (2F−1)×0.05f 三轴抖动。
//   - wax_on：x/z 轴 cmdV×0.01d/2.0d（÷2 不建模）；wax_off：x、z 同 ÷2。
//   - fishing：Java 构造器对 cmdV 直接赋值后 yd = f2d(F·0.2f+0.1f) 覆写 ——
//     预览 y 初速 = cmdVy（分布近似）。
//   - cloud/sneeze：Java 零速构造，无初速。
//
// 未建模（文档化为近似）：speedUpWhenYMotionIsBlocked（需碰撞）、onGround、
// 每 tick 的随机（lava 烟生成、campfire 漂移、rain 落地 50% 移除）、
// 构造器位置抖动（flame/soul 6F）、逐粒子随机种子、geyser_base 寿命用的
// 流体 level 随机（世界状态）。
//
// 近似收录（注册表内、无干净模型）：
// cherry/pale_oak/tinted_leaves（自管 tick 的 wind/swirl/flowAway 曲线 +
// 落地分支 + 构造器随机消费）、current_down（水流块检查）、dust_pillar
// （provider 速度走 nextGaussian）、explosion_emitter/geyser 系/
// gust_emitter_*（NoRender 发射器种子粒子；geyser_base 寿命用 level 随机）、
// firefly（构造器三轴 ×0.8d 后每 tick 随机位置抖动）、
// sulfur_bubbles
// （自管 tick：yEnd 目标式 + 逐 tick 随机漂移/碰撞分支 + 出生随机消费）、
// noxious_gas_cloud（NoRender 发射器，tick 每 2 tick 用 level 随机向可达
// sulfur 方块吐 gas，世界状态依赖）。
// 2026-09-12 第五轮核对入表：dust_plume（DustPlumeParticle.tick 的
// gravity *= 0.88f / friction *= 0.92f —— 每 tick 起点**常量**衰减，与世界无关，
// 用 gravityF + gravityDecay + frictionDecay 精确建模；此前的「变参数管道」
// 判定过严：该管道只比 base 多两个确定性乘子）。
// 2026-09-11 本轮核对后从近似升级入表的类型：vibration（motion='vibration'
// 绝对式 lerp 归位，destination 为 block 时 = 方块中心）、trail（既有）。
// 2026-09-12 第二轮核对入表：noxious_gas（BaseAshSmoke base 管道 +
// 寿命公式 gas）、falling_dust（自管 tick ≡ base 管道
// friction=1.0 + 位移后 −0.003d + 终端速度钳制 −0.14d + 寿命公式 fallingDust）。
// 2026-09-12 第五轮稽核**更正**第二轮的两处出生初速误读（其余管道值不变）：
// ① noxious_gas 曾记 spawnVelocityMul 0.1f —— BaseAshSmoke 的 r/g/b 三参在
//    零速 super 之后作用于 `xd *= r; xd += 命令速度`，即只缩放构造器抖动，
//    命令速度不被缩放（与 smoke/ash 同族写法一致，引擎 smoke 条目亦无乘法）；
// ② falling_dust 曾记 spawnVelocityMul 0.1f（误取构造器 rotSpeed 的 0.1f）——
//    实际走 3 参 SingleQuadParticle(level,x,y,z,sprite)，provider 只传
//    level/x/y/z/color，命令速度被丢弃 → 零速构造（0 初速 + 自管 tick 下落）。
// 2026-09-12 第三轮核对入表（静态类型：零速构造 + 恒定寿命 + tick 无位移）：
// sweep_attack（SingleQuadParticle 零速构造 dconst_0×3、iconst_4 寿命、tick 只
// 记录 pre + age++/死亡 + setSpriteFromAge —— 不调 move，位置恒定）、
// block_marker（位置型构造器（provider 只传 level/x/y/z/blockState）、gravity 0f、
// lifetime 80、hasPhysics=false、继承 Particle.tick 但速度恒 0 → 位置恒定）、
// elder_guardian（Particle(level,x,y,z) 零速构造、gravity 0f、lifetime 30、
// 继承 Particle.tick 但速度恒 0 → 位置恒定；实体模型渲染差异见 §10）。
// 2026-09-12 第四轮核对入表：Terrain 方块族 block/block_crumble（friction
// 0.98f + gravity 1.0f → −0.04、寿命走基类公式）与位置式飞行曲线
// enchant/nautilus/vault_connection（motion='fly_towards'，y 带 f2⁴·1.2f 下坠）、
// ominous_spawning（motion='fly_straight'）—— 出生位置 = 命令位置 + 速度矢量。
// ambient_entity_effect：粒子数据表里有名字，但 26.2 注册表未注册（type map
// 无条目）——命令用它会走模组报错路径，不进本表。
//
// 版本分区：本表证据仅来自 26.2 字节码 → 新类型只进 '26.2'；'1.21.11' 保留
// end_rod（1.21.1 反编译核对）。1.21.1 未逐类型核对，不臆测（八荣八耻 #1）。

export type MotionKind = 'base' | 'portal' | 'reverse_portal' | 'vibration' | 'fly_straight' | 'fly_towards';

export interface NativeKinematics {
  /** 运动模型：base = 通用管道；portal/reverse_portal = 自管位置式（无摩擦/重力） */
  motion?: MotionKind;
  /** 每 tick 速度乘法衰减（friction；位移**之后**；motion != base 时忽略） */
  friction: number;
  /** 每 tick 先于位移施加的 y 方向加速度（blocks/tick²；motion != base 时忽略） */
  gravityY: number;
  /** super.tick() 摩擦步之后的逐轴附加阻尼（snowflake 0.95/0.9/0.95、dripping 0.98×3） */
  postFriction?: [number, number, number];
  /** spawn 时叠加出生初速 yd += fround(500/F)（campfire；F = 下一个 vanillaRand nextFloat） */
  campfireRise?: boolean;
  /** spawn 时三轴初速 ×= 常量（Java 构造器无条件乘法因子，见文件头） */
  spawnVelocityMul?: number;
  /** spawn 时三轴初速由表达式给出（provider/构造器侧的精确式子；**无随机消费**）。
   *  求值点与 spawnVelocityMul 同处（互斥，优先于 mul/offset）。
   *  damage_indicator：Provider 传 (cmdVx, cmdVy+1.0d, cmdVz) → CritParticle 再
   *  ×0.4d，即 y = (cmdVy+1)·0.4d（Java 乘法在加法**之后**，写成 mul+offset
   *  会在非整数 cmdVy 上差 ≤1 ULP，故用表达式）。 */
  spawnVel?: (cmd: { x: number; y: number; z: number }) => { x: number; y: number; z: number };
  /** spawn 时 y 初速 += 常量（SimpleVertical：pause −0.03 / reset +0.03） */
  spawnVelOffsetY?: number;
  /** 位移后的 y 终端速度钳制：vy = max(vy, terminalVy)（falling_dust：
   *  move 后 yd −= 0.003d 再 yd = max(yd, −0.14d)） */
  terminalVy?: number;
  /** true = gravityY 在位移**之后**施加（falling_dust 自管 tick：move →
   *  yd −= 0.003d → max(yd, −0.14d)；默认 = base 管道的位移之前） */
  gravityPost?: boolean;
  /** 每 tick 起点（super.tick 之前）的 float gravity 字段初值（dust_plume 0.5f）。
   *  与 gravityDecay 配合：gravityY 不再固定，逐 tick 用 −0.04d×(double)g 计算。 */
  gravityF?: number;
  /** 每 tick 起点 float gravity 衰减乘子（dust_plume：`gravity *= 0.88f`）——
   *  float 域逐步 Math.fround，不能合并成幂次（迭代舍入 ≠ 一次舍入）。 */
  gravityDecay?: number;
  /** 每 tick 起点 float friction 衰减乘子（dust_plume：`friction *= 0.92f`） */
  frictionDecay?: number;
  /** provider 在构造器之后覆写初速/寿命（Java：`setParticleSpeed` + `setLifetime`；
   *  内部随机消费顺序逐字节码）。求值点 = 构造器默认寿命公式之后，且仅在命令 age /
   *  NBT 寿命未显式覆写时（与 campfireRise 同门；Java 侧显式 age 时 provider 仍会
   *  消费随机 → 该场景为已知近似）。
   *  dust_pillar：`DustPillarProvider` 三次 `nextGaussian` 后 `nextInt(20)`；
   *  x/z 命令速度被 setParticleSpeed **赋值覆写**、y 保留命令速度再叠加 g2/2。 */
  providerSpawn?: (
    r: RngLike,
    cmd: { x: number; y: number; z: number },
  ) => { x: number; y: number; z: number; lifetime: number };
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
    glow: { friction: 0.9599999785423279, gravityY: 0, spawnVelocityMul: 0.20000000298023224 }, // GlowParticle：friction 0.96f；GlowSquidProvider yd×0.2d
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
    // —— dust 系（DustParticleBase：friction 0.96f、无重力、spawn 三轴 ×0.1d）——
    dust: { friction: 0.9599999785423279, gravityY: 0, spawnVelocityMul: 0.10000000149011612 },
    dust_color_transition: { friction: 0.9599999785423279, gravityY: 0, spawnVelocityMul: 0.10000000149011612 }, // 同 Base
    // —— firework 系 ——
    // firework：Spark 构造器先 SimpleAnimated(0.1f 重力) 再 cmdV 覆盖；Flash = Overlay（零速、寿命 4）
    firework: { friction: 0.9100000262260437, gravityY: -0.004000000059604645 }, // SimpleAnimated：friction 0.91f；gravity 0.1f
    flash: { friction: 1.0, gravityY: 0, spawnVelocityMul: 0 }, // Overlay：无速度覆写、无摩擦/重力
    // —— crit 系（CritParticle：friction 0.7f、gravity 0.5f；构造器末尾 tick() 一次 = off-by-one 不建模）——
    crit: { friction: 0.699999988079071, gravityY: -0.02, spawnVelocityMul: 0.4 }, // cmdV×0.4d（+0.1d 常数项见近似清单）
    damage_indicator: {
      friction: 0.699999988079071,
      gravityY: -0.02,
      // Provider 传 (cmdVx, cmdVy+1.0d, cmdVz)；CritParticle 对三个参数统一 ×0.4d
      spawnVel: (c) => ({ x: c.x * 0.4, y: (c.y + 1) * 0.4, z: c.z * 0.4 }),
    },
    enchanted_hit: { friction: 0.699999988079071, gravityY: -0.02, spawnVelocityMul: 0.4 }, // MagicProvider：cmdV
    // —— bubble 系（自管 tick：yd += 0.002d / −f2d(gravity) / +f2d(0.005d)；×0.85d 或无摩擦）——
    bubble: { friction: 0.8500000238418579, gravityY: 0.002, spawnVelocityMul: 0.20000000298023224 }, // 自管 yd += 0.002d、×0.85d
    bubble_column_up: { friction: 0.8500000238418579, gravityY: 0.005, spawnVelocityMul: 0.20000000298023224 }, // base 管道：−0.04d×fround(−0.125f)
    bubble_pop: { friction: 1.0, gravityY: -0.00800000037997961 }, // 自管 yd −= f2d(0.008f)、无摩擦
    // —— Drip 系（DripParticle 自管 tick；hang = postMove ×0.02d + 恒 ×0.98d）——
    falling_lava: { friction: 0.9800000190734863, gravityY: -0.05999999865889549 }, // 默认 gravity 0.06f
    falling_water: { friction: 0.9800000190734863, gravityY: -0.05999999865889549 },
    falling_dripstone_water: { friction: 0.9800000190734863, gravityY: -0.05999999865889549 },
    falling_dripstone_lava: { friction: 0.9800000190734863, gravityY: -0.05999999865889549 },
    falling_honey: { friction: 0.9800000190734863, gravityY: -0.009999999776482582 }, // 0.01f
    falling_obsidian_tear: { friction: 0.9800000190734863, gravityY: -0.009999999776482582 },
    falling_nectar: { friction: 0.9800000190734863, gravityY: -0.007000000216066837 }, // 0.007f
    falling_spore_blossom: { friction: 0.9800000190734863, gravityY: -0.004999999888241291 }, // 0.005f
    dripping_lava: { friction: 0.02, gravityY: -0.0011999999405816197, postFriction: [0.9800000190734863, 0.9800000190734863, 0.9800000190734863] }, // hang：gravity·0.02f（0.06f 链）
    dripping_dripstone_lava: { friction: 0.02, gravityY: -0.0011999999405816197, postFriction: [0.9800000190734863, 0.9800000190734863, 0.9800000190734863] },
    dripping_dripstone_water: { friction: 0.02, gravityY: -0.0011999999405816197, postFriction: [0.9800000190734863, 0.9800000190734863, 0.9800000190734863] },
    dripping_water: { friction: 0.02, gravityY: -0.0011999999405816197, postFriction: [0.9800000190734863, 0.9800000190734863, 0.9800000190734863] }, // WaterHang→DripHang
    dripping_honey: { friction: 0.02, gravityY: -0.000011999999514955562, postFriction: [0.9800000190734863, 0.9800000190734863, 0.9800000190734863] }, // hang：0.01f 基 ×0.01f
    dripping_obsidian_tear: { friction: 0.02, gravityY: -0.000011999999514955562, postFriction: [0.9800000190734863, 0.9800000190734863, 0.9800000190734863] },
    landing_lava: { friction: 0.9800000190734863, gravityY: -0.05999999865889549 }, // DripLand
    landing_honey: { friction: 0.9800000190734863, gravityY: -0.05999999865889549 },
    landing_obsidian_tear: { friction: 0.9800000190734863, gravityY: -0.05999999865889549 },
    // —— 其余可干净建模 ——
    sculk_charge: { friction: 0.9599999785423279, gravityY: 0 }, // friction 0.96f；无 gravity 覆写
    sculk_charge_pop: { friction: 0.9599999785423279, gravityY: 0 },
    cloud: { friction: 0.9599999785423279, gravityY: 0 }, // PlayerCloud：friction 0.96f；零速构造
    sneeze: { friction: 0.9599999785423279, gravityY: 0 }, // SneezeProvider→PlayerCloud
    fishing: { friction: 0.9800000190734863, gravityY: 0 }, // Wake 自管：gravity 0f、×0.98d
    trial_spawner_detection: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 }, // gravity −0.1f
    trial_spawner_detection_ominous: { friction: 0.9599999785423279, gravityY: 0.004000000059604645 },
    dragon_breath: { friction: 1.0, gravityY: 0, postFriction: [0.9599999785423279, 1.0, 0.9599999785423279] }, // 自管 tick：x/z ×f2d(0.96f)、y 无摩擦（落地分支不建模）
    scrape: { friction: 0.9599999785423279, gravityY: 0, spawnVelocityMul: 0.01 }, // ScrapeProvider：cmdV×0.01d
    wax_on: { friction: 0.9599999785423279, gravityY: 0, spawnVelocityMul: 0.01 }, // x/z ÷2.0d 不建模
    wax_off: { friction: 0.9599999785423279, gravityY: 0, spawnVelocityMul: 0.01 },
    electric_spark: { friction: 0.9599999785423279, gravityY: 0, spawnVelocityMul: 0.25 }, // cmdV×0.25d
    explosion: { friction: 1.0, gravityY: 0, spawnVelocityMul: 0 }, // HugeExplosion：零速自管 tick
    sonic_boom: { friction: 1.0, gravityY: 0, spawnVelocityMul: 0 }, // →HugeExplosion（无速度覆写）
    gust: { friction: 1.0, gravityY: 0, spawnVelocityMul: 0 }, // GustParticle：零速自管 tick
    small_gust: { friction: 1.0, gravityY: 0, spawnVelocityMul: 0 }, // SmallProvider → 同构造器
    spit: { friction: 0.8999999761581421, gravityY: -0.02 }, // Explode(−0.1f/0.9f) 再覆写 gravity 0.5f；±0.05f 抖动见近似清单
    poof: { friction: 0.8999999761581421, gravityY: 0.004000000059604645 }, // Explode 原样
    pause_mob_growth: { friction: 0.9800000190734863, gravityY: 0, spawnVelOffsetY: -0.03 }, // SimpleVertical up=false
    reset_mob_growth: { friction: 0.9800000190734863, gravityY: 0, spawnVelOffsetY: 0.03 }, // SimpleVertical up=true
    // —— 绝对式 lerp 归位（2026-09-11 核对）——
    vibration: { motion: 'vibration', friction: 1, gravityY: 0 }, // VibrationSignalParticle：零速构造，
      // 构造器 lifetime = arrival_in_ticks（NBT，Provider 直传，无公式 → age=0 走命令/默认寿命）；
      // tick（逐字节码）：age++ → 达寿命 remove → target.getPosition 为空 remove →
      // t = 1.0d/(lifetime−age)（double 域 i2d 纯除法）→ x = Mth.lerp(t, x, tx) 三轴，
      // 末 tick 恰好落到波源中心。preview：destination 校验仅 block 源（entity 源
      // 解析层已拒绝）→ target = 方块中心（+0.5, +0.5, +0.5，BlockPos 相对命令位置
      // 可正可负）；每 tick 位置式推进后 p.stop 回滚被撤销（零速构造 stop 恒 true
      // → 自定义 lerp 放在 !stop 门外，见 engine.animate）。
    // water_current_down 未收录：tick 含水流块检查（移除/速度分支依赖世界状态）。
    // —— 第二轮核对（2026-09-12，JDK21 ProbeAsh/ProbeTerminal golden）——
    noxious_gas: {
      friction: 0.9599999785423279, // BaseAshSmoke：friction fround(0.96f)
      gravityY: 0.0007999999821186066, // gravity 参数 −0.02f（smoke 同传）→ −0.04d×fround(−0.02f)（烟雾微升）
      // 出生初速 = 命令速度原样（无 spawnVelocityMul）：BaseAshSmoke 的 r/g/b
      // 三参 (0.1f) 只乘零速 super 留下的抖动 → `xd = 抖动·0.1f + 命令速度`，
      // 见文件头「判定口径」。第五轮更正（此前误记 ×0.1f）。
    },
    falling_dust: {
      friction: 1.0, // 自管 tick 无摩擦步
      gravityY: -0.003000000026077032, // move 后 yd −= 0.003d（逐 tick 实际效果）
      gravityPost: true, // 字节码顺序：move → −=0.003d → max（区别于 base 管道先减后移）
      terminalVy: -0.14000000059604645, // yd = max(yd, −0.14d) 终端速度钳制
      spawnVelocityMul: 0, // 零速构造：3 参 SingleQuadParticle(level,x,y,z,sprite) +
      // provider 不传速度（FallingDustParticle 构造器签名无速度参数）→ 命令速度被丢弃
    },
    // —— 第五轮核对（2026-09-12，逐 tick 常量衰减管道 + provider 初速覆写）——
    dust_plume: {
      friction: 0.9599999785423279, // BaseAshSmoke：friction fround(0.96f)
      gravityY: -0.02, // 首 tick **衰减前**的 −0.04d×fround(0.5f)（0.5 精确）；之后由 gravityF/gravityDecay 逐 tick 计算
      gravityF: 0.5, // BaseAshSmoke 构造器第 21 槽（DustPlume 传 ldc 0.5f）
      gravityDecay: 0.8799999952316284, // DustPlumeParticle.tick：gravity *= 0.88f（super.tick 之前）
      frictionDecay: 0.9200000166893005, // 同处 tick 开头：friction *= 0.92f
      spawnVelOffsetY: 0.15000000596046448, // DustPlume 把 (cmdVy + 0.15d) 传给 BaseAshSmoke（确定性加法）
    },
    dust_pillar: {
      friction: 0.9800000190734863, // TerrainParticle → Particle 构造器 fround(0.98f)
      gravityY: -0.04, // TerrainParticle 基类 gravity 1.0f → −0.04d×1.0f（恰精确）
      // Provider 覆写（构造器之后）：setParticleSpeed(g1/30.0d, cmdVy + g2/2.0d, g3/30.0d)
      // → setLifetime(20 + I(20))。x/z 命令速度被赋值覆写（setParticleSpeed 语义）。
      providerSpawn: (r, c) => {
        const g1 = r.nextGaussian(); // 抽取顺序逐字节码：g1 → g2 → g3 → I(20)
        const g2 = r.nextGaussian();
        const g3 = r.nextGaussian();
        return { x: g1 / 30, y: c.y + g2 / 2, z: g3 / 30, lifetime: 20 + r.nextInt(20) };
      },
    },
    // —— 第三轮核对（2026-09-12，静态类型：零速构造 + 恒定寿命 + tick 无位移）——
    // 判定共同点：① 构造器速度参数为 dconst_0（或位置型构造器不带速度）；
    // ② 基类 Particle 构造器不赋值 gravity（字段默认 0f）且子类无覆写；
    // ③ tick 不调 move（AttackSweep 自管 tick / 其余继承 Particle.tick 但速度为 0）
    // → 位置恒定，命令速度被忽略（模组侧 cmdV 只进 provider，Java 构造器丢弃）。
    sweep_attack: {
      friction: 0.9800000190734863, // 基类 Particle 构造器 fround(0.98f)，本类无覆写
      gravityY: 0, // 基类未赋值 gravity（字段默认 0f）；本类无覆写
      spawnVelocityMul: 0, // 零速构造：SingleQuadParticle(level,x,y,z,dconst_0×3,sprite)
    },
    block_marker: {
      friction: 0.9800000190734863, // 基类 Particle 构造器 fround(0.98f)，本类无覆写
      gravityY: 0, // 构造器 fconst_0 → gravity 0f
      spawnVelocityMul: 0, // 零速构造：位置型构造器（provider 只传 level/x/y/z/blockState）
    },
    elder_guardian: {
      friction: 0.9800000190734863, // 基类 Particle 构造器 fround(0.98f)，本类无覆写
      gravityY: 0, // 构造器 fconst_0 → gravity 0f
      spawnVelocityMul: 0, // 零速构造：Particle(level,x,y,z) 位置型（provider 只传 level/x/y/z）
    },
    // —— 第四轮核对（2026-09-12，位置式飞行曲线 + Terrain 方块族）——
    block: {
      friction: 0.9800000190734863, // 基类 Particle 构造器 fround(0.98f)，TerrainParticle 无覆写
      gravityY: -0.04, // TerrainParticle 构造器 fconst_1 → gravity 1.0f → −0.04d×fround(1.0f)（恰精确）
    },
    block_crumble: {
      friction: 0.9800000190734863, // 同 TerrainParticle（CrumblingProvider → createTerrainParticle）
      gravityY: -0.04,
    },
    // 位置式飞行（FlyStraightTowards / FlyTowardsPosition 系）：构造器零速 super 后
    // 直接写 xd/yd/zd = 命令速度、xStart/yStart/zStart = 命令位置，位置 = xStart+vd
    // （出生即偏移一个速度矢量）；tick = save pre → age++/死亡 → t = fdiv(age,lifetime)
    // → f1 = 1−t(float) → 三轴 xStart + vd·f2d(f1)（FlyTowards 另有 y −= f2d(f2⁴·1.2f)，
    // f2 = 1−f1 平方两次）；**不调 move** → 无摩擦/重力。
    ominous_spawning: { motion: 'fly_straight', friction: 1, gravityY: 0 },
    enchant: { motion: 'fly_towards', friction: 1, gravityY: 0 },
    nautilus: { motion: 'fly_towards', friction: 1, gravityY: 0 },
    vault_connection: { motion: 'fly_towards', friction: 1, gravityY: 0 },
  },
};

// ---------- 寿命公式（构造器字节码逐式复刻；F = 下一个 nextFloat，I(n) = 下一个 nextInt(n)）----------

/**
 * 公式求值上下文：scale = 该粒子的 sizeMul（dust 系 NBT Scale；缺省 1）。
 * Java 构造器里 scale 来自 options.getScale() —— 预览按同值传入。
 */
export interface NativeLifetimeContext {
  scale: number;
}

/**
 * 公式求值：返回 (r, ctx) => ticks。消费顺序 = 字节码里的调用顺序（公式内
 * 单次 F/D 只消费一次）。精度逐字复刻：double 常量用 double 运算；
 * float 常量先 Math.fround；(int) = Math.trunc（Java 浮点转 int 截断向零）。
 */
export type NativeLifetimeFormula = (r: RngLike, ctx: NativeLifetimeContext) => number;
type RngLike = {
  nextFloat(): number;
  nextDouble(): number;
  nextInt(bound: number): number;
  /** Jupiter/LegacyRandomSource.nextGaussian（Marsaglia 极坐标 + 暂存第二值；
   *  dust_pillar 的 provider 初速用；`SimRandom` 已实现同一序列） */
  nextGaussian(): number;
};

const L = {
  /** (int)(N/(F·0.8d+0.2d)) —— double 家族（lava/water_drop/suspended/town/scale 基底）。
   *  字节码顺序 nextFloat→f2d→0.8d dmul→0.2d dadd→ddiv：F 先乘 0.8（曾误写成
   *  N/(0.8+0.2F)，分母被压窄，2026-09-08 审查后按 javap 更正，ProbeLifetime2 实测） */
  div: (n: number) => (r: RngLike, _c: NativeLifetimeContext) => Math.trunc(n / (r.nextFloat() * 0.8 + 0.2)),
  /** (int)(N/(D·0.8d+0.2d)) —— double 家族 nextDouble 变体（glow 26.2） */
  doubleDiv: (n: number) => (r: RngLike, _c: NativeLifetimeContext) => Math.trunc(n / (r.nextDouble() * 0.8 + 0.2)),
  /** (int)max(f32((int)(N/(D·0.8d+0.2d)))·scale, 1.0f) —— dust 系
   *  （DustParticleBase 字节码：d2i→i2f→fmul scale→fmax 1.0f→f2i；
   *  scale = options.getScale()，预览 = ctx.scale） */
  dust: (n: number) => (r: RngLike, c: NativeLifetimeContext) =>
    Math.trunc(Math.max(Math.fround(Math.trunc(n / (r.nextDouble() * 0.8 + 0.2)) * Math.fround(c.scale)), 1.0)),
  /** (int)(6.0d/(F·0.8d+0.6d)) —— crit（同 div 顺序，crit 用 0.6d） */
  crit: (r: RngLike, _c: NativeLifetimeContext) => Math.max(Math.trunc(6.0 / (r.nextFloat() * 0.8 + 0.6)), 1),
  /** max((int)((N/(F·0.8d+0.2d))·f2d(scale)),1) —— BaseAshSmoke（javap 1:1：
   *  除法结果为 double，乘 f2d(float scale)，**末尾单次** d2i 截断） */
  ashScale: (n: number, scale: number) => (r: RngLike, _c: NativeLifetimeContext) =>
    Math.max(Math.trunc((n / (r.nextFloat() * 0.8 + 0.2)) * Math.fround(scale)), 1),
  /** (int)(N/(F·0.8d+0.2d)) + K —— snowflake(+2) / flame(+4) / explode(+2) */
  divPlus: (n: number, k: number) => (r: RngLike, _c: NativeLifetimeContext) => Math.trunc(n / (r.nextFloat() * 0.8 + 0.2)) + k,
  /** (int)(4.0f/(0.9f·F+0.1f)) —— BaseParticle 默认（item 系；全程 float，
   *  每步 Java 浮点运算都舍入：fmul→fround(0.9f·F)（0.9f 用 fround 取精确
   *  float 值，0.9d≠0.9f）、fadd→fround(·+0.1f)、fdiv→fround；(int) 截断。
   *  全 2^24 域直方图与 JDK21 逐桶一致（ProbeScan） */
  base: (r: RngLike, _c: NativeLifetimeContext) => Math.trunc(Math.fround(4.0 / Math.fround(Math.fround(Math.fround(0.9) * r.nextFloat()) + Math.fround(0.1)))),
  /** (int)((12.0f·0.5f)/(0.8f·F+0.2f)) —— SquidInk（同 base 的 float 链；
   *  12.0f·0.5f=6.0f 精确） */
  squid: (r: RngLike, _c: NativeLifetimeContext) => Math.trunc(Math.fround(6.0 / Math.fround(Math.fround(Math.fround(0.8) * r.nextFloat()) + Math.fround(0.2)))),
  /** 40 + (int)(10.0f·F) —— portal */
  portal: (r: RngLike, _c: NativeLifetimeContext) => 40 + Math.trunc(Math.fround(10.0 * r.nextFloat())),
  /** 60 + (int)(2.0f·F) —— reverse_portal：F<0.5→60、F≥0.5→61（各半；
   *  曾误读为 2·(int)F 恒 60，2026-09-08 按 javap `fmul fconst_2 → f2i` 更正） */
  reversePortal: (r: RngLike, _c: NativeLifetimeContext) => 60 + Math.trunc(Math.fround(2.0 * r.nextFloat())),
  /** base + (int)(F·mul)（float 乘法后 f2i 截断）—— FlyTowards（enchant/nautilus/
   *  vault_connection：30 + f2i(F·10.0f)）与 FlyStraight（ominous_spawning：
   *  25 + f2i(F·5.0f)）共用的寿命形态。 */
  flyTo: (base: number, mul: number) => (r: RngLike, _c: NativeLifetimeContext) =>
    base + Math.trunc(Math.fround(r.nextFloat() * Math.fround(mul))),
  /** min + nextInt(extra) —— end_rod/totem/campfire/firework/scrape/spark 等 */
  int: (min: number, extra: number) => (r: RngLike, _c: NativeLifetimeContext) => min + r.nextInt(extra),
  /** 常量 —— heart 16 / note 6 / shriek 30 / flash 4 / pause 8 等 */
  const: (n: number) => () => n,
  /** (int)(64.0f/(0.9f·F+0.1f)) —— falling_spore_blossom（SporeBlossomFall
   *  provider：f2i(fdiv(64.0f, randomBetween(F, 0.1f, 0.9f))；
   *  randomBetween = fround(fround(F·0.8f)+0.1f)） */
  sporeBlossom: (r: RngLike, _c: NativeLifetimeContext) =>
    Math.trunc(Math.fround(64.0 / Math.fround(Math.fround(Math.fround(0.8) * r.nextFloat()) + Math.fround(0.1)))),
  /** (int)max(f32((int)(8.0d/(f2d(F)·0.8d+0.3d)))·2.5f, 1.0f) —— PlayerCloud
   *  （cloud/sneeze；注意分母 0.3d 非 0.2d） */
  cloud: (r: RngLike, _c: NativeLifetimeContext) =>
    Math.trunc(Math.max(Math.fround(Math.trunc(8.0 / (r.nextFloat() * 0.8 + 0.3)) * Math.fround(2.5)), 1.0)),
  /** max(f2i(fdiv(8.0f, randomBetween(F, 0.5f, 1.0f))·1.5f), 1) ——
   *  TrialSpawnerDetection（provider scale 参数 1.5f；randomBetween 逐字节码） */
  trialSpawner: (r: RngLike, _c: NativeLifetimeContext) =>
    Math.max(Math.trunc(Math.fround(Math.fround(8.0 / Math.fround(Math.fround(Math.fround(0.5) * r.nextFloat()) + Math.fround(0.5))) * Math.fround(1.5))), 1),
  /** (int)(6.0d/(f2d(F)·0.5d+0.5d)·f2d(3.0f)) —— NoxiousGas 构造器**末尾**
   *  对 BaseAshSmoke 已算寿命的覆写（provider gravityFloat = 3.0f 常量；
   *  字节码栈序：6.0d, F, f2d, 0.5d dmul, 0.5d dadd, ddiv, f2d(3.0f), dmul, d2i）。
   *  分布 = [1, 18]：F→0⁺ 时 →18，F→1⁻ 时 →(int)2.0。构造器内寿命公式之前的
   *  粒子私有随机（基类/颜色/第一寿命）按约定不消费（end_rod 先例）。 */
  gas: (r: RngLike, _c: NativeLifetimeContext) =>
    Math.trunc((6.0 / (r.nextFloat() * 0.5 + 0.5)) * Math.fround(3.0)),
  /** (int)max(f32(f32((int)(32.0d/(f2d(F)·0.8d+0.2d)))·0.9f), 1.0f) ——
   *  FallingDust 构造器（字节码栈序：32.0d, F, f2d, 0.8d dmul, 0.2d dadd,
   *  ddiv, d2i, i2f, 0.9f fmul, fmax 1.0f, f2i）。分布 = [1, 28]：F→0⁺ 时
   *  (int)32·0.9f=28，F→1⁻ 时 (int)4·0.9f=3。 */
  fallingDust: (r: RngLike, _c: NativeLifetimeContext) =>
    Math.trunc(Math.max(Math.fround(Math.fround(Math.trunc(32.0 / (r.nextFloat() * 0.8 + 0.2))) * Math.fround(0.9)), 1.0)),
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
    glow: L.doubleDiv(8), // GlowSquidProvider：(int)(8.0d/(D·0.8d+0.2d))（nextDouble；无 max）
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
    dust: L.dust(8), // DustParticleBase：nextDouble 域
    dust_color_transition: L.dust(8), // 同 Base
    firework: L.int(48, 12), // Spark：48 + I(12)
    flash: L.const(4), // Overlay：4
    damage_indicator: L.const(20), // DamageIndicatorProvider：setLifetime(20)
    enchanted_hit: L.crit, // MagicProvider 不覆写 → 构造器默认
    bubble: L.div(8), // (int)(8.0d/(f2d(F)·0.8d+0.2d))
    bubble_column_up: L.div(40), // (int)(40.0d/…)
    bubble_pop: L.const(4),
    falling_lava: L.div(64), // FallAndLand 构造器默认
    falling_water: L.div(64),
    falling_dripstone_water: L.div(64), // DripstoneFallAndLand = 纯子类
    falling_dripstone_lava: L.div(64),
    falling_honey: L.div(64), // HoneyFallAndLand
    falling_obsidian_tear: L.div(64),
    falling_nectar: L.div(16), // NectarFall provider 覆写
    falling_spore_blossom: L.sporeBlossom, // provider 覆写：float 链 64.0f/(0.9f·F+0.1f)
    dripping_lava: L.const(40), // DripHang 构造器默认
    dripping_dripstone_lava: L.const(40),
    dripping_dripstone_water: L.const(40),
    dripping_water: L.const(40),
    dripping_honey: L.const(100), // HoneyHang provider：100
    dripping_obsidian_tear: L.const(100),
    landing_lava: L.div(16), // DripLand 构造器默认
    landing_honey: L.div(128), // HoneyLand provider 覆写
    landing_obsidian_tear: L.div(28), // TearLand provider 覆写
    sculk_charge: L.int(8, 12), // Provider：8 + I(12)
    sculk_charge_pop: L.int(6, 4), // Provider：I(4) + 6
    cloud: L.cloud, // PlayerCloud 构造器
    sneeze: L.cloud,
    fishing: L.div(8), // Wake：(int)(8.0d/(f2d(F)·0.8d+0.2d))
    trial_spawner_detection: L.trialSpawner,
    trial_spawner_detection_ominous: L.trialSpawner,
    dragon_breath: L.div(20), // (int)(20.0d/(f2d(F)·0.8d+0.2d))
    scrape: L.int(10, 30), // I(30) + 10
    wax_on: L.int(10, 30),
    wax_off: L.int(10, 30),
    electric_spark: L.int(2, 2), // I(2) + 2
    explosion: L.int(6, 4), // HugeExplosion：I(4) + 6
    sonic_boom: L.const(16), // SonicBoom 覆写
    gust: L.int(12, 4), // I(4) + 12
    small_gust: L.int(12, 4),
    spit: L.divPlus(16, 2), // Explode：(int)(16.0d/(f2d(F)·0.8d+0.2d)) + 2
    poof: L.divPlus(16, 2),
    pause_mob_growth: L.const(8), // SimpleVertical：8
    reset_mob_growth: L.const(8),
    // —— 第二轮核对（2026-09-12，JDK21 ProbeAsh golden）——
    noxious_gas: L.gas, // 构造器末尾覆写：(int)(6.0d/(F·0.5d+0.5d)·f2d(3.0f))
    falling_dust: L.fallingDust, // (int)max(f32(f32((int)(32.0d/(F·0.8d+0.2d)))·0.9f),1.0f)
    // —— 第五轮核对（2026-09-12，JDK21 ProbePlume golden）——
    dust_plume: L.ashScale(7, 1), // BaseAshSmoke：max((int)(7/(F·0.8d+0.2d)·f2d(1.0f)),1)（slot20=7、slot17=1.0f）
    // —— 第三轮核对（2026-09-12，恒定寿命；构造器直接覆写，公式路径无随机消费）——
    sweep_attack: L.const(4), // AttackSweepParticle：iconst_4 覆写（颜色 nextFloat 私有随机不消费）
    block_marker: L.const(80), // BlockMarker：bipush 80 覆写
    elder_guardian: L.const(30), // ElderGuardianParticle：bipush 30 覆写
    // —— 第四轮核对（2026-09-12）——
    block: L.base, // TerrainParticle → Particle 3 参基类公式（与 item 同链）
    block_crumble: L.base,
    ominous_spawning: L.flyTo(25, 5), // FlyStraightTowards：25 + f2i(F·5.0f)
    enchant: L.flyTo(30, 10), // FlyTowardsPosition：30 + f2i(F·10.0f)
    nautilus: L.flyTo(30, 10),
    vault_connection: L.flyTo(30, 10),
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

// ---------- 保真度分级（UI「护城河可视化」：让用户看见哪些类型是字节码核对、
//  哪些是近似）——判定规则与 §10 证据边界一致 ----------

export type Fidelity = 'full' | 'approx' | 'unknown';

/** 保真度标签：✅ = 该类型在运动学表内（逐类型摩擦/重力/运动模式/初速有
 *  字节码证据）；⚠️ = 近似（注册表内但运动学未逐条核对——含仅寿命公式核对
 *  的类型与按类型名近似的 NBT 类型）；❌ = 不在该版本注册表。
 *  保守口径，宁低勿高：未收录证据的类型一律不标 ✅。 */
export function fidelityFor(
  rawName: string,
  version = '26.2',
  types: string[] = [],
): Fidelity {
  const base = rawName.replace(/\{.*$/, ''); // type{NBT}：NBT 载荷不参与分级
  const key = normKey(base);
  if (types.length > 0 && !types.includes(key)) return 'unknown';
  if (nativeSpecFor(key, version)) return 'full';
  return 'approx';
}
