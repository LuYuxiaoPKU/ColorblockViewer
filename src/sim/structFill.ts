// struct 填充逻辑（1:1 复刻各处 ParticleStruct 赋值）。
//
// 关键语义：Java 侧 struct 是**每 exe 实例一个、跨 invoke 不清零**的常驻对象
// （ClassExpression.struct 字段）。这里对应到两个载体：
//  - 粒子速度表达式 → 粒子自己的 exeStruct（跨 tick 不清零，残留值 = Java 行为）；
//  - 命令填充（conditional/parameter/group）→ 命令持有的一次性 struct（同一
//    命令内跨循环不清零，Java 侧同一次 parse 的 struct 也是常驻的）。
// 因此这里只做「Java 逐字赋值的字段」的写入，绝不整体清零 —— 清零会丢失
// 跨调用残留（表达式未写的字段保留上次值），与 Java 不一致。

import type { ParticleStruct } from '../engine/struct';
import type { SimParticle, TickGenerator } from './types';

/** customMove 的 moveT==0 首帧块（ParticleMixin.customMove 前半段，逐行照搬）。
 *  注意此时 pos 已含本 tick 原生位移（非零原生速度下 ≠ 纯出生偏移，忠实照做）。 */
export function fillFirstMove(s: ParticleStruct, p: SimParticle): void {
  s.cx = p.cx;
  s.cy = p.cy;
  s.cz = p.cz;
  const dx = p.x - p.cx;
  const dy = p.y - p.cy;
  const dz = p.z - p.cz;
  s.dx = dx;
  s.dy = dy;
  s.dz = dz;
  s.ddis = Math.sqrt(dx * dx + dy * dy + dz * dz);
  s.ds1 = Math.atan2(dz, dx);
  s.ds2 = Math.atan2(dy, Math.hypot(dx, dz));
}

/** customMove 的每帧块（哨兵 + 当前值 + moveT 递增）。
 *  返回值 = 调用前的 moveT（即已写入 s.t 的值）。 */
export function fillPerTick(s: ParticleStruct, p: SimParticle): number {
  const t = p.moveT;
  s.vx = Number.NaN;
  s.vy = Number.NaN;
  s.vz = Number.NaN;
  s.x = p.x - p.cx;
  s.y = p.y - p.cy;
  s.z = p.z - p.cz;
  s.cr = p.r;
  s.cg = p.g;
  s.cb = p.b;
  s.alpha = p.a;
  const dx = p.x - p.cx;
  const dy = p.y - p.cy;
  const dz = p.z - p.cz;
  s.dis = Math.sqrt(dx * dx + dy * dy + dz * dz);
  s.s1 = Math.atan2(dz, dx);
  s.s2 = Math.atan2(dy, Math.hypot(dx, dz));
  s.t = t;
  // age 在此路径从不赋值 → 恒 0（模组已知缺陷，忠实复刻）
  return t;
}

/** conditional 三重扫描的单点填充（ClientNetworkHandler.conditional，逐行照搬）。
 *  注意 Java 只写 x,y,z,s1,s2,dis —— 不写 age/t，残留依赖调用方 struct 状态。 */
export function fillConditionalPoint(s: ParticleStruct, cx: number, cy: number, cz: number): void {
  s.x = cx;
  s.y = cy;
  s.z = cz;
  s.s1 = Math.atan2(cz, cx);
  s.s2 = Math.atan2(cy, Math.hypot(cx, cz));
  s.dis = Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/** parameter（非 tick）与 TickParticleTask.run 的单步填充。
 *  与 conditional 的差异：只写 t（Java 两处都只写 t，其余字段全靠表达式自己写）。
 *  polar 坐标转换在 spawn.ts 内做（Java 侧读 data.x/s1/s2/dis 在 invoke 之后）。 */
export function fillParameterPoint(s: ParticleStruct, t: number): void {
  s.t = t;
}

/** group remove / group change 条件过滤的填充（GroupUtil.remove 与
 *  ClientNetworkHandler.groupChange 的 cexe 块，逐行照搬）。
 *  注意：remove 路径**额外**写 age = 粒子已存活 tick、t = age；
 *  groupChange 的 cexe 路径**不写** age/t（Java 原文如此 —— 与 remove 不同）。 */
export function fillGroupRelative(
  s: ParticleStruct,
  px: number,
  py: number,
  pz: number,
  refX: number,
  refY: number,
  refZ: number,
  setAge: number,
): void {
  const dx = px - refX;
  const dy = py - refY;
  const dz = pz - refZ;
  s.x = dx;
  s.y = dy;
  s.z = dz;
  s.s1 = Math.atan2(dz, dx);
  s.s2 = Math.atan2(dy, Math.hypot(dx, dz));
  s.dis = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (setAge >= 0) {
    s.age = setAge;
    s.t = setAge;
  }
}

/** group change parameter 的主表达式填充（case 0 块，逐行照搬）。 */
export function fillGroupChangeParam(
  s: ParticleStruct,
  p: SimParticle,
  refX: number,
  refY: number,
  refZ: number,
): void {
  s.x = p.x - refX;
  s.y = p.y - refY;
  s.z = p.z - refZ;
  s.vx = p.vx;
  s.vy = p.vy;
  s.vz = p.vz;
  s.cx = p.cx;
  s.cy = p.cy;
  s.cz = p.cz;
  // 预览统一按 billboard 渲染（所有粒子都是单四边形），取当前渲染色
  s.cr = p.r;
  s.cg = p.g;
  s.cb = p.b;
  s.alpha = p.a;
}

/** 从 TickGenerator 计算单步偏移（polar/xyz 与颜色/速度选择），
 *  返回 spawn 用的 (dx,dy,dz,color,vel)。Java 侧：
 *  - polar：x=dis·cos(s2)·cos(s1), y=dis·sin(s2), z=dis·cos(s2)·sin(s1)
 *  - 非 polar：data.x/y/z
 *  - rgba：颜色 data.cr/cg/cb/alpha、速度 data.vx/vy/vz
 *  - 非 rgba：颜色/速度 = 命令值（TickParticleTask 构造时已固化）。 */
export interface SpawnStep {
  dx: number;
  dy: number;
  dz: number;
  color: { r: number; g: number; b: number; a: number } | null;
  vel: { vx: number; vy: number; vz: number } | null;
}

export function computeSpawnStep(g: TickGenerator): SpawnStep {
  const s = g.struct;
  let dx: number;
  let dy: number;
  let dz: number;
  if (g.polar) {
    dx = s.dis * Math.cos(s.s2) * Math.cos(s.s1);
    dy = s.dis * Math.sin(s.s2);
    dz = s.dis * Math.cos(s.s2) * Math.sin(s.s1);
  } else {
    dx = s.x;
    dy = s.y;
    dz = s.z;
  }
  if (g.color === null) {
    // rgba 变体：颜色/速度来自表达式
    return {
      dx, dy, dz,
      color: { r: s.cr, g: s.cg, b: s.cb, a: s.alpha },
      vel: { vx: s.vx, vy: s.vy, vz: s.vz },
    };
  }
  return {
    dx, dy, dz,
    color: g.color,
    vel: g.cmdVel,
  };
}
