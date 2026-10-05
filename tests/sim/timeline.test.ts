// 播放时间线（帧缓冲）单测：push / 累计拷贝超预算丢最旧 / findFrame /
// 帧内截断 / clear。
// 预算 = 1M 总粒子拷贝（JS 对象实测 ~400B/份 ≈ 400MB；按每帧**实际**粒子数
// 累计，与粒子上限解耦）。

import { describe, expect, it } from 'vitest';
import { Timeline, TOTAL_COPY_BUDGET } from '../../src/sim/timeline';
import type { SimParticle } from '../../src/sim/types';

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
});
