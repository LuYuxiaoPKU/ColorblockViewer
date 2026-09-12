// M3 仿真引擎类型（计划 §七）。粒子池：定长数组 + swap-remove 压实
// （活粒子恒占 [0, engine.count)）；组索引 Map<组名, Set<粒子id>>（惰性清理）。

import type { CompiledBlock } from '../engine';
import type { ParticleStruct } from '../engine/struct';

export interface SimConfig {
  /** 玩家位置：`~`/`^` 相对坐标与 group 命令缺省 ref 的求值基准 */
  playerPos: { x: number; y: number; z: number };
  /** age==0（未指定寿命）的近似默认寿命（tick）；MC 中因粒子类型而异，UI 标注「近似值」 */
  defaultLifetime: number;
  /** 粒子上限：达到后跳过生成并累计 dropped */
  maxParticles: number;
  /** 可注入 PRNG 种子（normal 高斯偏移用） */
  seed: number;
  /** 游戏版本（'1.21.11' | '26.2'）：原版粒子贴图/类型表按它分区。
   *  引擎语义不读它（粒子生成与版本无关），App 据此驱动渲染图集与表单类型表。 */
  mcVersion: string;
  /** 3D 网格边长（block，1 block/格）：纯渲染层设置，引擎不读（mcVersion 先例） */
  gridSize: number;
  /** 3D 网格线显示开关：纯渲染层设置 */
  gridVisible: boolean;
  /** 「原版运动学」开关（设置面板）：开启后 sim/kinematics.ts 有证据的类型
   *  （26.2 约 50 个：end_rod/totem/crit/smoke 系/portal 系/campfire 系等，
   *  逐类型见表头证据清单）套用原版摩擦/重力/运动模型 + 原版寿命公式；
   *  关闭 = 模组原生行为（匀速直线 + 命令寿命/默认寿命）。 */
  nativeKinematics: boolean;
}

export interface SimParticle {
  id: number;
  /** 粒子类型名（粒子名参数原样；渲染层按它微调 size/alpha/色相） */
  name: string;
  x: number; y: number; z: number;
  /** 原生速度（恒定，除非 group change parameter 显式修改） */
  vx: number; vy: number; vz: number;
  /** 初始速度全 0 → true：原生 tick 后回滚位置（等效静止，忠实复刻 setStop 语义） */
  stop: boolean;
  r: number; g: number; b: number; a: number;
  age: number;
  /** age == -1 → 永久（取 intMax） */
  lifetime: number;
  /** 由原版 /particle 命令生成（渲染层：出生色恒为白，原版语义） */
  vanilla: boolean;
  /** type{NBT} 已解析出渲染色（dust 的 color）：true 时渲染层不强制出生色为白，
   *  直接用 r/g/b（= NBT 色）。取证：DustParticle 构造器把 options.getColor()
   *  写入 rCol/gCol/bCol（非 SimpleParticle 的白）。 */
  nbtTint?: boolean;
  /** 点大小倍数（dust 的 scale，默认 1；原版 quadSize = 0.75·scale，预览按相对倍数） */
  sizeMul?: number;
  /** trail{NBT} 的 target（绝对坐标终点；每 tick lerp 归位，TrailParticle.tick 字节码） */
  trailTarget?: { x: number; y: number; z: number };
  /** vibration{NBT} 的 destination block 中心（绝对坐标；每 tick
   *  x = lerp(1/(lifetime−age), x, target.x) 推进，VibrationSignalParticle.tick 字节码） */
  vibrationTarget?: { x: number; y: number; z: number };
  /** 命令位置 = 中心 */
  cx: number; cy: number; cz: number;
  /** 逐 tick 衰减的 float gravity/friction 状态（dust_plume 的
   *  `DustPlumeParticle.tick`：每 tick 起点 `gravity *= 0.88f; friction *= 0.92f`
   *  再走 base 管道；仅当表项声明 gravityDecay/frictionDecay 时存在） */
  gf?: number; ff?: number;
  /** 落叶曲线的构造器预计算量（FallingLeavesParticle：xaFlowScale/zaFlowScale/swirlPeriod，
   *  均由构造器里的一次私有 nextFloat 决定 → 预览从共享 vanillaRand 消费一次，
   *  见 kinematics.ts 表项注释） */
  leafXa?: number; leafZa?: number; leafPeriod?: number;
  /** 速度表达式（customMove 路径） */
  exe: CompiledBlock | null;
  speedStep: number;
  /** 首次运动填充判据（moveT == 0）；group change speedexpression 不重置它（逐字复刻） */
  moveT: number;
  /** 速度表达式专属 struct：Java 里每个 ClassExpression 实例持有一个 struct，
   *  跨调用不清零 → 表达式未写的字段保留上一次 invoke 的值（跨粒子残留）。
   *  每个粒子一个实例，对应 spawnParticle 里 ExpressionUtil.parse 的每次新实例。 */
  exeStruct: ParticleStruct | null;
  alive: boolean;
}

/** tick*parameter 的分 tick 生成器（复刻 TickParticleTask；t 跨 tick 持续递增） */
export interface TickGenerator {
  name: string;
  x: number; y: number; z: number;
  color: { r: number; g: number; b: number; a: number } | null; // null = rgba 变体（用 data 颜色）
  cmdVel: { vx: number; vy: number; vz: number } | null; // null = rgba 变体（用 data 速度）
  begin: number; end: number; step: number;
  cpt: number; // 每 tick 生成上限
  age: number;
  speedExpression: string | null;
  speedStep: number;
  group: string | null;
  polar: boolean;
  exe: CompiledBlock;
  /** 该生成器专属 struct（同一 TickParticleTask 的跨 tick 多次 run 共享，不清零） */
  struct: ParticleStruct;
  t: number;
}

/** 单条命令执行结果：生成/丢弃计数 + 错误列表（UI toast 用） */
export interface SimResult {
  spawned: number;
  dropped: number;
  errors: string[];
}
