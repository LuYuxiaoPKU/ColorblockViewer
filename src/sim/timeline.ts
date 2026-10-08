// 播放时间线（帧缓冲）：播放循环每 tick 记录一份场景快照（tick + 活粒子 +
// 丢弃计数 + 末帧标记），供进度条拖拽回放、上一帧/下一帧导航。
//
// 内存策略（前端无 1:1 约束，文档化近似）：**总粒子拷贝预算**
// （1M 份，JS 对象实测 ~400B/份 ≈ 400MB）——按每帧**实际**粒子数累计，
// 累计超预算时从头部丢最旧帧（最旧即最早经过的状态，价值最低）。
// 小场景（12 粒子）可回放 ~8 万帧（≈70 分钟）；1M 满帧场景只容 1 帧
// （单帧即 400MB，大场景回放只覆盖最后时刻，拖条前段为空是如实行为）。
// 按实际粒子数而非粒子上限定容：上限是「可能」，回放预算约束的是「实际」。

import type { SimParticle } from './types';

export interface FrameMeta {
  /** 该帧记录后的引擎 tick（与 HUD 一致） */
  tick: number;
  count: number;
  dropped: number;
  /** 记录后引擎无活工作（粒子清零且无排队生成器）：末帧 —— 播放到此自动
   *  停止并停在这一帧。末帧恒在缓冲最末（丢最旧只从头部丢）。 */
  end: boolean;
}

export interface SceneFrame extends FrameMeta {
  particles: Record<string, number | string>[];
}

/** 全部帧的粒子拷贝总份数上限（≈400MB 真实内存；回放时长的实际约束）。
 *  Viewport 用它估算条右端（总时长），须与 push 的丢帧判据同口径。 */
export const TOTAL_COPY_BUDGET = 1000000;
/** 单帧粒子上限：1M（引擎活池上限同口径） */
const MAX_PARTICLES_PER_FRAME = 1000000;

/** 粒子 → 可序列化浅拷贝（仅数值/字符串字段；exe/struct/exeStruct 不存）。
 *  渲染层只读 13 个字段（x/y/z/r/g/b/a/name/age/lifetime/vanilla/nbtTint/
 *  colorFrom/colorTo/sizeMul），回放时按 id 从**当前活池**取回真粒子对象；
 *  已死粒子（回放时刻不存在）用本拷贝补 —— 拷贝缺运动学字段（gf/ff 等）
 *  无影响：渲染不读它们。另存 trail/vibration 的 target（绝对坐标，不可
 *  从活池恢复：命令执行后真粒子对象上还在，但帧拷贝粒子没有）——seek 时
 *  增量 lerp 型粒子须回出生点重放（见 App.seek）。
 *  字段清单（测试锁齐全）：id/name/x/y/z/vx/vy/vz/r/g/b/a/age/lifetime +
 *  vanilla/nbtTint（布尔→1/0）；条件字段另存（colorFrom→cfR/cfG/cfB、
 *  colorTo→ctR/ctG/ctB、sizeMul、trailTarget→ttX/ttY/ttZ、
 *  vibrationTarget→vtX/vtY/vtZ）。
 *  性能（1M 粒子探针 2026-10-09）：对象字面量 + 静态属性访问（JIT 同态
 *  快路径），替换原「{} + 字段循环动态属性读写」（16 次动态读写 ≈ 3×
 *  慢：动态属性读写阻止 JIT 内联与同态优化）。 */
function copyParticle(p: SimParticle): Record<string, number | string> {
  const o: Record<string, number | string> = {
    id: p.id, name: p.name,
    x: p.x, y: p.y, z: p.z,
    vx: p.vx, vy: p.vy, vz: p.vz,
    r: p.r, g: p.g, b: p.b, a: p.a,
    age: p.age, lifetime: p.lifetime,
    vanilla: p.vanilla ? 1 : 0,
    nbtTint: p.nbtTint ? 1 : 0,
  };
  if (p.colorFrom) {
    o['cfR'] = p.colorFrom.r; o['cfG'] = p.colorFrom.g; o['cfB'] = p.colorFrom.b;
  }
  if (p.colorTo) {
    o['ctR'] = p.colorTo.r; o['ctG'] = p.colorTo.g; o['ctB'] = p.colorTo.b;
  }
  if (p.sizeMul !== undefined) o['sizeMul'] = p.sizeMul;
  if (p.trailTarget) {
    o['ttX'] = p.trailTarget.x; o['ttY'] = p.trailTarget.y; o['ttZ'] = p.trailTarget.z;
  }
  if (p.vibrationTarget) {
    o['vtX'] = p.vibrationTarget.x; o['vtY'] = p.vibrationTarget.y; o['vtZ'] = p.vibrationTarget.z;
  }
  return o;
}

export class Timeline {
  private frames: SceneFrame[] = [];
  /** 缓冲内粒子拷贝总份数（丢帧判据，摊销 O(1)） */
  private copies = 0;

  constructor(private maxParticles: number) {}

  /** 上限变更（设置抽屉运行期调整）：帧内截断按**当前**上限判；
   *  缓冲里的旧大帧仍按旧截断保留（回放是历史，不重采样）。 */
  setMaxParticles(v: number): void {
    this.maxParticles = v;
  }

  get length(): number {
    return this.frames.length;
  }

  /** 缓冲内粒子拷贝总份数（Viewport 估算条右端用） */
  get totalCopies(): number {
    return this.copies;
  }

  /** 第 i 帧（App 热路径读；越界返回 null） */
  at(i: number): SceneFrame | null {
    return this.frames[i] ?? null;
  }

  /** 当前末帧的 tick（无帧 = -1） */
  get endTick(): number {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1].tick : -1;
  }

  /** 最旧帧的 tick（无帧 = 0；◀ 可用判据：playhead tick > oldestTick） */
  get oldestTick(): number {
    return this.frames.length > 0 ? this.frames[0].tick : 0;
  }

  /** 找对应 tick 的帧（seek 用）：最后一帧 tick ≤ t（帧 tick 严格递增、
   *  每 tick 至多一帧 → 二分）。t 早于最旧帧（被丢）→ null。 */
  findFrame(t: number): SceneFrame | null {
    let lo = 0;
    let hi = this.frames.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid].tick <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans >= 0 ? this.frames[ans] : null;
  }

  /** 记录一帧：活粒子池 + pending（与 engine.snapshot 同序），粒子按
   *  min(上限, 单帧上限) 截断（与点云缓冲/2D 视图同口径）。累计拷贝超
   *  预算 → 丢最旧帧（至少保留 1 帧：极端大帧单帧即超预算，帧不可拆分）。
   *  只由 App 播放循环调用（命令期不记录 —— 时间线是「播放历史」）。 */
  push(snapshot: SimParticle[], tick: number, dropped: number, end: boolean): void {
    const n = Math.min(snapshot.length, this.maxParticles, MAX_PARTICLES_PER_FRAME);
    const particles: Record<string, number | string>[] = new Array(n);
    for (let i = 0; i < n; i++) particles[i] = copyParticle(snapshot[i]);
    this.frames.push({ tick, count: n, dropped, end, particles });
    this.copies += n;
    while (this.copies > TOTAL_COPY_BUDGET && this.frames.length > 1) {
      const old = this.frames.shift()!;
      this.copies -= old.count;
    }
  }

  /** 清空（回放重置 / 命令执行时由 App 调用） */
  clear(): void {
    this.frames.length = 0;
    this.copies = 0;
  }
}

/** seek 回退（前端近似，非 1:1）：trail/vibration 是**增量式** lerp（每
 *  tick 基于本 tick 起点推进 x += (target−x)·1/(lifetime−age)），直接 seek
 *  后从当前 x 再 lerp 会越过历史位置（画面「未能回退」）。该递推有闭式解
 *  x(a) = x₀ + (target−x₀)·a/(lifetime−1)（x₀ = 出生点 = 命令位置 c*；
 *  vanilla 生成 x 初值 = cx；末 tick a=lifetime−1 恰好落 target，与引擎
 *  逐 tick double lerp 数值一致至 ~1e-15）。只重写**活池真粒子**（当前 x
 *  是最新值）；帧拷贝不动（其 x 本就是目标帧的历史值）。target 只在真
 *  粒子对象上（帧拷贝由 copyParticle 存的 ttX/ttY/ttZ / vtX/vtY/vtZ 兜
 *  底——活池里的真粒子必然有 target，此兜底对当前调用形态不生效，仅为
 *  防御）。 */
export function rewindLiveParticles(
  copies: Record<string, number | string>[],
  live: Map<number, SimParticle>,
): void {
  type V3 = { x: number; y: number; z: number };
  const fromCopy = (c: Record<string, number | string>, keys: [string, string, string]): V3 | undefined => {
    const [kx, ky, kz] = keys;
    const x = c[kx], y = c[ky], z = c[kz];
    return x !== undefined && y !== undefined && z !== undefined
      ? { x: x as number, y: y as number, z: z as number }
      : undefined;
  };
  for (const c of copies) {
    const p = live.get(c.id as number);
    if (!p || p.lifetime <= 1) continue; // 帧拷贝不动；lifetime=1 的粒子无位移
    const a = c.age as number; // 目标帧的 age（真粒子可能已演进到更晚）
    // 按真粒子**实际**字段选 kind（trail 优先），帧拷贝字段只作兜底
    let target: V3 | undefined;
    if (p.trailTarget) target = p.trailTarget;
    else if (p.vibrationTarget) target = p.vibrationTarget;
    else target = fromCopy(c, ['ttX', 'ttY', 'ttZ']) ?? fromCopy(c, ['vtX', 'vtY', 'vtZ']);
    if (!target) continue;
    const k = a / (p.lifetime - 1);
    p.x = p.cx + (target.x - p.cx) * k;
    p.y = p.cy + (target.y - p.cy) * k;
    p.z = p.cz + (target.z - p.cz) * k;
  }
}
