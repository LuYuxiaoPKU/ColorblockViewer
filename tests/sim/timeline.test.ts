// 播放时间线（帧缓冲）单测：push / 帧满丢最旧 / findFrame / 容量与上限 / clear。
// 双预算定容：256MB 字节预算（理论口径，每帧成本 = 32B 头 + 36B/粒子）
// + 1M 总粒子拷贝（JS 对象实测 ~400B/份，小场景回放时长的实际约束）。
// 1M 粒子上限 → 容量 2；小上限 → 上千帧。

import { describe, expect, it } from 'vitest';
import { Timeline } from '../../src/sim/timeline';
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
  });

  it('帧满丢最旧：1M 上限 → 容量 2，push 4 帧后只剩后 2 帧', () => {
    const tl = new Timeline(1000000); // 1M 份 / 每帧上限 → 1 帧 → 下限容量 2
    expect(tl.capacity).toBe(2);
    tl.push(snap(2), 1, 0, false);
    tl.push(snap(2), 2, 0, false);
    tl.push(snap(2), 3, 0, false);
    tl.push(snap(2), 4, 0, true);
    expect(tl.length).toBe(2);
    expect(tl.oldestTick).toBe(3);
    expect(tl.endTick).toBe(4);
    expect(tl.at(0)!.tick).toBe(3);
    expect(tl.at(1)!.end).toBe(true); // 末帧恒在缓冲最末
  });

  it('findFrame：最后一帧 tick ≤ t（二分）；t 早于最旧帧（被丢）→ null', () => {
    const tl = new Timeline(1000); // 容量 = 1M 份 / 1000 = 1000 帧，足够装 10 帧
    for (let t = 1; t <= 10; t++) tl.push(snap(1), t, 0, t === 10);
    expect(tl.findFrame(0)).toBeNull();
    expect(tl.findFrame(1)!.tick).toBe(1);
    expect(tl.findFrame(7)!.tick).toBe(7);
    expect(tl.findFrame(999)!.tick).toBe(10); // 超末帧 → 取末帧

    const small = new Timeline(1000000); // 容量 2
    small.push(snap(1), 1, 0, false);
    small.push(snap(1), 2, 0, false);
    small.push(snap(1), 3, 0, false);
    expect(small.findFrame(1)).toBeNull(); // 最旧帧已被丢
    expect(small.findFrame(2)!.tick).toBe(2);
  });

  it('容量 = min(字节预算, 1M 总拷贝 / 每帧粒子数)；setMaxParticles 运行期重算', () => {
    const tl = new Timeline(1000);
    expect(tl.capacity).toBe(1000); // 1M 份 / 1000（字节预算可容 7449 帧，拷贝预算更紧）
    tl.setMaxParticles(1000000);
    expect(tl.capacity).toBe(2); // 满帧 1M 份 → 只够 1 帧 → 下限 2
    tl.setMaxParticles(200000);
    expect(tl.capacity).toBe(5);
    tl.setMaxParticles(200);
    expect(tl.capacity).toBe(5000);

    const t2 = new Timeline(100);
    t2.push(snap(50), 1, 0, false);
    t2.setMaxParticles(40);
    t2.push(snap(50), 2, 0, false); // 新帧按**当前**上限截断
    expect(t2.at(1)!.count).toBe(40);
    expect(t2.at(0)!.count).toBe(50); // 旧帧不重采样（回放是历史）
  });

  it('clear：清空后 endTick = -1、oldestTick = 0', () => {
    const tl = new Timeline(1000);
    tl.push(snap(1), 1, 0, true);
    tl.clear();
    expect(tl.length).toBe(0);
    expect(tl.endTick).toBe(-1);
    expect(tl.oldestTick).toBe(0);
    expect(tl.findFrame(1)).toBeNull();
  });
});
