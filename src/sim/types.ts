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
  /** 命令位置 = 中心 */
  cx: number; cy: number; cz: number;
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
