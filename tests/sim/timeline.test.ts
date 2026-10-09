// 播放时间线（帧缓冲）单测：push / 累计拷贝超预算丢最旧 / findFrame /
// 帧内截断 / clear。
// 预算 = 1M 总粒子拷贝（JS 对象实测 ~400B/份 ≈ 400MB；按每帧**实际**粒子数
// 累计，与粒子上限解耦）。

import { describe, expect, it } from 'vitest';
import { RECORD_EVERY_TICK_MAX, Timeline, TOTAL_COPY_BUDGET, rewindLiveParticles } from '../../src/sim/timeline';
import type { SimParticle } from '../../src/sim/types';
import { SimEngine } from '../../src/sim/engine';
import { parseCommand } from '../../src/command/parser';

/** 最小假粒子（copyParticle 只读固定字段） */
function fp(i: number): Record<string, unknown> {
  return {
    id: i, name: 'flame', x: i, y: 1, z: 2, vx: 0, vy: 1, vz: 0,
    r: 1, g: 0, b: 0, a: 0.5, age: 3, lifetime: 20,
    vanilla: false,
  };
}
function snap(n: number): SimParticle[] {
  const out: SimParticle[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = fp(i) as unknown as SimParticle;
  return out;
}

describe('Timeline', () => {
  it('push：帧记录 + 粒子拷贝字段齐全（渲染 13 字段 + 布尔/渐变色/sizeMul）', () => {
    const tl = new Timeline(1000);
    const rich = {
      ...fp(5),
      nbtTint: true,
      colorFrom: { r: 1, g: 0, b: 0 },
      colorTo: { r: 0, g: 1, b: 0 },
      sizeMul: 2,
    } as unknown as SimParticle;
    tl.push([rich], 1, 0, false);
    tl.push([rich], 2, 3, true);
    expect(tl.length).toBe(2);
    expect(tl.endTick).toBe(2);
    expect(tl.oldestTick).toBe(1);
    expect(tl.totalCopies).toBe(2);
    const f1 = tl.at(0)!;
    expect(f1).toMatchObject({ tick: 1, count: 1, dropped: 0, end: false });
    expect(f1.particles[0]).toMatchObject({
      id: 5, name: 'flame', x: 5, y: 1, z: 2, vx: 0, vy: 1, vz: 0,
      r: 1, g: 0, b: 0, a: 0.5, age: 3, lifetime: 20,
      vanilla: 0, nbtTint: 1,
      cfR: 1, cfG: 0, cfB: 0,
      ctR: 0, ctG: 1, ctB: 0,
      sizeMul: 2,
    });
    expect(tl.at(1)!.end).toBe(true);
    expect(tl.at(5)).toBeNull(); // 越界 null
  });

  it('帧内截断：snapshot 超过上限按上限截断（与点云缓冲同口径）', () => {
    const tl = new Timeline(100);
    tl.push(snap(150), 1, 0, false);
    expect(tl.at(0)!.count).toBe(100);
    expect(tl.at(0)!.particles).toHaveLength(100);
    expect(tl.at(0)!.particles[99]).toMatchObject({ id: 99 });
    expect(tl.totalCopies).toBe(100);
  });

  it('累计拷贝超预算 → 丢最旧帧（按实际粒子数，与上限解耦）', () => {
    const tl = new Timeline(1000000);
    // 100 粒子/帧 × 10001 帧 = 1,000,100 > 预算 1M → 丢最旧直到 ≤1M
    for (let t = 1; t <= 10001; t++) tl.push(snap(100), t, 0, t === 10001);
    expect(tl.length).toBe(10000);
    expect(tl.totalCopies).toBe(TOTAL_COPY_BUDGET);
    expect(tl.oldestTick).toBe(2); // 最旧帧（tick 1）被丢
    expect(tl.endTick).toBe(10001);
    expect(tl.at(0)!.tick).toBe(2);
    expect(tl.at(tl.length - 1)!.end).toBe(true); // 末帧恒在缓冲最末
  });

  it('大帧场景：帧数少（1M 上限、每帧 5 万粒子 → 只容 20 帧）', () => {
    const tl = new Timeline(1000000);
    for (let t = 1; t <= 22; t++) tl.push(snap(50000), t, 0, false);
    expect(tl.length).toBe(20); // 20×5万 = 1M 刚好装满
    expect(tl.totalCopies).toBe(TOTAL_COPY_BUDGET);
    expect(tl.oldestTick).toBe(3);
    expect(tl.findFrame(2)).toBeNull(); // 被丢
    expect(tl.findFrame(3)!.tick).toBe(3);
  });

  it('findFrame：最后一帧 tick ≤ t（二分）；t 早于最旧帧（被丢）→ null', () => {
    const tl = new Timeline(1000);
    for (let t = 1; t <= 10; t++) tl.push(snap(1), t, 0, t === 10);
    expect(tl.findFrame(0)).toBeNull();
    expect(tl.findFrame(1)!.tick).toBe(1);
    expect(tl.findFrame(7)!.tick).toBe(7);
    expect(tl.findFrame(999)!.tick).toBe(10); // 超末帧 → 取末帧（clamp）
  });

  it('setMaxParticles 运行期变更：新帧按**当前**上限截断，旧帧不重采样', () => {
    const tl = new Timeline(100);
    tl.push(snap(50), 1, 0, false);
    tl.setMaxParticles(40);
    tl.push(snap(50), 2, 0, false);
    expect(tl.at(1)!.count).toBe(40);
    expect(tl.at(0)!.count).toBe(50); // 回放是历史
  });

  it('clear：清空后 endTick = -1、oldestTick = 0、totalCopies = 0', () => {
    const tl = new Timeline(1000);
    tl.push(snap(1), 1, 0, true);
    tl.clear();
    expect(tl.length).toBe(0);
    expect(tl.endTick).toBe(-1);
    expect(tl.oldestTick).toBe(0);
    expect(tl.totalCopies).toBe(0);
    expect(tl.findFrame(1)).toBeNull();
  });

  it('shouldRecord：count ≤ 阈值逐 tick 记录（常规场景行为不变）', () => {
    const tl = new Timeline(1000000);
    for (let t = 1; t <= 5; t++) {
      expect(tl.shouldRecord(t, RECORD_EVERY_TICK_MAX, false)).toBe(true);
      tl.push(snap(1), t, 0, false);
    }
    expect(tl.length).toBe(5);
  });

  it('shouldRecord：大场景按成本封顶降频（k = ⌈count/20万⌉，1M 满帧 k=5）', () => {
    const tl = new Timeline(1000000);
    const count = 500000; // k = ⌈500k/200k⌉ = 3
    let recorded = 0;
    for (let t = 1; t <= 10; t++) {
      if (tl.shouldRecord(t, count, false)) {
        recorded++;
        // 真实 push 太重，只推 1 粒子占位（降频判据只读 tick/count）
        tl.push(snap(1), t, 0, false);
      }
    }
    expect(recorded).toBe(4); // tick 1,4,7,10
    // 1M 满帧 → k = 5
    const tl2 = new Timeline(1000000);
    expect(tl2.shouldRecord(1, 1000000, false)).toBe(true);
    tl2.push(snap(1), 1, 0, false);
    expect(tl2.shouldRecord(2, 1000000, false)).toBe(false);
    expect(tl2.shouldRecord(6, 1000000, false)).toBe(true);
  });

  it('shouldRecord：末帧恒记录（无论降频间隔）', () => {
    const tl = new Timeline(1000000);
    const count = 500000; // k = 3
    expect(tl.shouldRecord(1, count, false)).toBe(true);
    tl.push(snap(1), 1, 0, false);
    expect(tl.shouldRecord(2, count, false)).toBe(false); // 间隔未满
    expect(tl.shouldRecord(2, count, true)).toBe(true); // end 帧恒记录
    tl.push(snap(1), 2, 0, true);
    // end 帧刷新 lastRecordedTick：之后按新起点计（tick 5 满 k=3）
    expect(tl.shouldRecord(3, count, false)).toBe(false);
    expect(tl.shouldRecord(4, count, false)).toBe(false);
    expect(tl.shouldRecord(5, count, false)).toBe(true);
  });

  it('shouldRecord：clear 后重新从下一 tick 记录', () => {
    const tl = new Timeline(1000000);
    tl.push(snap(1), 1, 0, false);
    expect(tl.shouldRecord(1, 500000, false)).toBe(false); // 距上次 0
    tl.clear();
    expect(tl.shouldRecord(1, 500000, false)).toBe(true); // clear 后视为从未记录
  });

  it('trail target 入帧拷贝（ttX/ttY/ttZ；vibration 同 vtX/vtY/vtZ）', () => {
    const tl = new Timeline(1000);
    const trailP = {
      ...fp(1),
      trailTarget: { x: 5, y: 6, z: 7 },
    } as unknown as SimParticle;
    const vibP = {
      ...fp(2),
      vibrationTarget: { x: 1, y: 2, z: 3 },
    } as unknown as SimParticle;
    tl.push([trailP, vibP], 1, 0, false);
    const [a, b] = tl.at(0)!.particles;
    expect(a).toMatchObject({ ttX: 5, ttY: 6, ttZ: 7 });
    expect(b).toMatchObject({ vtX: 1, vtY: 2, vtZ: 3 });
  });

  it('rewindLiveParticles：活池 trail/vibration 真粒子按目标帧 age 回退（闭式解）', () => {
    // 模拟 seek：引擎已演进到 age=10（x 已越过目标帧），seek 到 tick 4 的帧。
    // 活池真粒子应回落到 tick 4 的历史位置；帧拷贝的 x 本就是历史值，不动。
    const L = 20;
    const x0 = 0, tx = 10;
    const step = (x: number, a: number) => x + (tx - x) * (1 / (L - a));
    let x10 = x0;
    for (let i = 1; i <= 10; i++) x10 = step(x10, i);
    let x4 = x0;
    for (let i = 1; i <= 4; i++) x4 = step(x4, i);

    const real: Record<string, unknown> = {
      ...fp(1), age: 10, lifetime: L, x: x10, y: 0, z: 0,
      cx: x0, cy: 0, cz: 0,
      trailTarget: { x: tx, y: 0, z: 0 },
    };
    // 帧拷贝：tick 4 的历史值
    const copy = {
      ...fp(1), id: 1, age: 4, lifetime: L, x: x4, y: 0, z: 0,
      cx: x0, cy: 0, cz: 0, ttX: tx, ttY: 0, ttZ: 0,
    } as Record<string, number | string>;
    rewindLiveParticles([copy], new Map([[1, real as unknown as SimParticle]]));
    // 活池真粒子回退到 tick 4 位置（闭式解与逐步 lerp 差异 ~1e-15）
    expect((real.x as number)).toBeCloseTo(x4, 10);
    // 帧拷贝不动（历史值即目标）
    expect(copy.x).toBe(x4);

    // vibration 同路径（vt* 兜底字段）
    const vib: Record<string, unknown> = {
      ...fp(2), age: 10, lifetime: L, x: x10, y: 0, z: 0,
      cx: x0, cy: 0, cz: 0,
      vibrationTarget: { x: tx, y: 0, z: 0 },
    };
    const vibCopy = {
      ...copy, id: 2, age: 4,
    } as Record<string, number | string>;
    rewindLiveParticles([vibCopy], new Map([[2, vib as unknown as SimParticle]]));
    expect((vib.x as number)).toBeCloseTo(x4, 10);

    // 普通粒子（无 target）：位置/速度/age 回退为帧拷贝值（时光倒流语义，
    // 2026-10-10 修复：此前真粒子 age/x 停在播放到的那一帧，end_rod 动画
    // 不随进度条回溯）
    const plain: Record<string, unknown> = { ...fp(3), x: 42, y: 7, z: -3, vx: 9, vy: 8, vz: 7, age: 50 };
    const plainCopy = { ...fp(3), x: 1, y: 2, z: 3, vx: 0.5, vy: 0.25, vz: -0.5, age: 5 } as Record<string, number | string>;
    rewindLiveParticles([plainCopy], new Map([[3, plain as unknown as SimParticle]]));
    expect(plain.x).toBe(1);
    expect(plain.y).toBe(2);
    expect(plain.z).toBe(3);
    expect(plain.vx).toBe(0.5);
    expect(plain.vy).toBe(0.25);
    expect(plain.vz).toBe(-0.5);
    expect(plain.age).toBe(5);
    // 帧里有的 id 不在活池（已死）→ 跳过不报错
    rewindLiveParticles([{ id: 99, age: 2 }], new Map());
  });
});

// 端到端（2026-10-10）：真实引擎演进 50 tick 后 seek 到 tick 5 的帧，
// 池内真粒子的 age/位置/速度与目标帧历史值对齐（时光倒流修复的回归锁；
// 渲染端帧动画/FADE08 颜色/淡出均由 p.age 驱动，age 对齐 = 动画回溯）。
describe('seek 帧字段对齐（引擎级）', () => {
  it('seek 后池内真粒子 age/x/v 等于目标帧拷贝值', () => {
    const e = new SimEngine({ playerPos: { x: 0, y: 0, z: 0 }, defaultLifetime: 20, maxParticles: 1000, seed: 7, mcVersion: '26.2', gridSize: 10, gridVisible: true, nativeKinematics: true, renderMode: 'full', reference: 'none' });
    e.runCommand(parseCommand('particleex normal minecraft:end_rod 0 64 0 1 1 1 1 1 1 1 0 0 0 3'));
    const tl = new Timeline(1000);
    for (let i = 0; i < 50; i++) {
      e.tickOnce();
      tl.push(e.snapshot(), e.tick, e.dropped, false);
    }
    // 模拟 App.seek(5)（与 src/App.tsx seek 同序）
    const frame = tl.findFrame(5)!;
    const alive = e.snapshot();
    const byId = new Map(alive.map((p) => [p.id, p]));
    const resolved = frame.particles.map((c) => byId.get((c as unknown as SimParticle).id) ?? (c as unknown as SimParticle));
    for (const p of resolved) p.alive = true;
    rewindLiveParticles(frame.particles, byId);
    e.setPool(resolved);
    e.setTick(frame.tick);
    const pool = e.snapshot();
    const targetAges = frame.particles.map((c) => c.age as number);
    const targetXs = frame.particles.map((c) => c.x as number);
    expect(pool.map((p) => p.age)).toEqual(targetAges); // age 对齐 → 动画回溯
    expect(pool.map((p) => p.x)).toEqual(targetXs); // 位置对齐
    expect(pool.length).toBeGreaterThan(0);
  });
});
