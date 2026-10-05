// 播放时间线（帧缓冲）：播放循环每 tick 记录一份场景快照（tick + 活粒子 +
// 丢弃计数 + 末帧标记），供进度条拖拽回放、上一帧/下一帧导航。
//
// 内存策略（前端无 1:1 约束，文档化近似）：双预算定容——
//   ① 字节预算（约 256MB）：每帧成本 = 32B 头 + 36B/粒子（理论口径）；
//   ② 总粒子拷贝预算（1M 份）：JS 对象实测 ~400B/份，1M 份 ≈ 400MB——
//      典型小场景（200 粒子）可回放 ~5000 帧（≈4 分钟），1M 满帧场景只容
//      2 帧（大场景回放只覆盖最后几帧，拖条前段为空是如实行为，非 bug）。
// 帧满时**丢最旧帧**（最旧即播放最早经过的状态，价值最低；保留最近回放）。

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

const FRAME_BASE_BYTES = 32;
const PARTICLE_BYTES = 36;
const BUDGET_BYTES = 256 * 1024 * 1024;
/** 全部帧的粒子拷贝总份数上限（JS 对象实测 ~400B/份 → ≈400MB；
 *  小场景回放时长的真正约束） */
const TOTAL_PARTICLE_BUDGET = 1000000;
/** 单帧粒子上限：1M（引擎活池上限同口径） */
const MAX_PARTICLES_PER_FRAME = 1000000;
/** 容量下限（防止预算/成本算出 <2 的退化值） */
const MIN_CAPACITY = 2;

const FIELDS = [
  'id', 'name', 'x', 'y', 'z', 'vx', 'vy', 'vz',
  'r', 'g', 'b', 'a', 'age', 'lifetime',
] as const;

/** 粒子 → 可序列化浅拷贝（仅数值/字符串字段；exe/struct/exeStruct 不存）。
 *  渲染层只读 13 个字段（x/y/z/r/g/b/a/name/age/lifetime/vanilla/nbtTint/
 *  colorFrom/colorTo/sizeMul），回放时按 id 从**当前活池**取回真粒子对象；
 *  已死粒子（回放时刻不存在）用本拷贝补 —— 拷贝缺运动学字段（gf/ff 等）
 *  无影响：渲染不读它们。 */
function copyParticle(p: SimParticle): Record<string, number | string> {
  const o: Record<string, number | string> = {};
  for (const f of FIELDS) o[f] = p[f];
  o['vanilla'] = p.vanilla ? 1 : 0;
  o['nbtTint'] = p.nbtTint ? 1 : 0;
  if (p.colorFrom) {
    o['cfR'] = p.colorFrom.r; o['cfG'] = p.colorFrom.g; o['cfB'] = p.colorFrom.b;
  }
  if (p.colorTo) {
    o['ctR'] = p.colorTo.r; o['ctG'] = p.colorTo.g; o['ctB'] = p.colorTo.b;
  }
  if (p.sizeMul !== undefined) o['sizeMul'] = p.sizeMul;
  return o;
}

export class Timeline {
  private frames: SceneFrame[] = [];
  private cap: number;

  constructor(private maxParticles: number) {
    this.cap = this.calcCapacity(maxParticles);
  }

  /** 上限变更（设置抽屉运行期调整）：重算容量（帧内截断按**当前**上限判；
   *  上限调小后缓冲里的旧大帧仍按旧截断保留 —— 回放是历史，不重采样）。 */
  setMaxParticles(v: number): void {
    this.maxParticles = v;
    this.cap = this.calcCapacity(v);
  }

  private calcCapacity(max: number): number {
    const perFrame = Math.min(max, MAX_PARTICLES_PER_FRAME);
    const byBytes = Math.floor(BUDGET_BYTES / (FRAME_BASE_BYTES + perFrame * PARTICLE_BYTES));
    const byParticles = Math.floor(TOTAL_PARTICLE_BUDGET / perFrame);
    return Math.max(MIN_CAPACITY, Math.min(byBytes, byParticles));
  }

  get length(): number {
    return this.frames.length;
  }

  /** 第 i 帧（App 热路径读；越界返回 null） */
  at(i: number): SceneFrame | null {
    return this.frames[i] ?? null;
  }

  /** 当前末帧的 tick（无帧 = -1；拖动滑条右端用） */
  get endTick(): number {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1].tick : -1;
  }

  /** 最旧帧的 tick（无帧 = 0；◀ 可用判据：playhead tick > oldestTick） */
  get oldestTick(): number {
    return this.frames.length > 0 ? this.frames[0].tick : 0;
  }

  get capacity(): number {
    return this.cap;
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
   *  min(上限, 单帧上限) 截断（与点云缓冲/2D 视图同口径）。帧满 → 丢最旧。
   *  只由 App 播放循环调用（命令期不记录 —— 时间线是「播放历史」）。 */
  push(snapshot: SimParticle[], tick: number, dropped: number, end: boolean): void {
    const n = Math.min(snapshot.length, this.maxParticles, MAX_PARTICLES_PER_FRAME);
    const particles: Record<string, number | string>[] = new Array(n);
    for (let i = 0; i < n; i++) particles[i] = copyParticle(snapshot[i]);
    this.frames.push({ tick, count: n, dropped, end, particles });
    if (this.frames.length > this.cap) this.frames.shift();
  }

  /** 清空（回放重置 / 命令执行时由 App 调用） */
  clear(): void {
    this.frames.length = 0;
  }
}
