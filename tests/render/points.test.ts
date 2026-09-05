// M4 渲染层 headless 单测：缓冲映射 / 类型微调 / 色相旋转 / drawRange。
// BufferGeometry 不依赖 WebGL 上下文，可直接构造。

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BASE_SIZE,
  createPointsLayer,
  shiftHue,
  syncToPoints,
  tweakFor,
  type RenderParticle,
} from '../../src/render/points';

function mkPart(over: Partial<RenderParticle> = {}): RenderParticle {
  return { x: 1, y: 2, z: 3, r: 1, g: 0.5, b: 0.25, a: 0.8, name: 'flame', ...over };
}

describe('syncToPoints 缓冲映射', () => {
  it('按序写入 position/color/size，返回写入数', () => {
    const layer = createPointsLayer(4);
    const pts = [mkPart({ x: 1, y: 2, z: 3 }), mkPart({ x: 4, y: 5, z: 6, name: 'smoke' })];
    const n = syncToPoints(layer, pts, 2, 0.5);
    expect(n).toBe(2);
    expect(Array.from(layer.pos.slice(0, 6))).toEqual([1, 2, 3, 4, 5, 6]);
    // flame：hue 0 → 原色；alpha = 0.8 * 0.9(flame) * 0.5 = 0.36
    expect(layer.color[0]).toBe(1);
    expect(layer.color[1]).toBe(0.5);
    expect(layer.color[2]).toBe(0.25);
    expect(layer.color[3]).toBeCloseTo(0.36, 6); // 0.8*0.9*0.5，float32 存储有 ulp 偏差
    // smoke：size 1.3 → BASE*1.3*2
    expect(layer.size[0]).toBeCloseTo(BASE_SIZE * 1 * 2, 10);
    expect(layer.size[1]).toBeCloseTo(BASE_SIZE * 1.3 * 2, 10);
  });

  it('空快照 → 0（drawRange 清零）', () => {
    const layer = createPointsLayer(4);
    expect(syncToPoints(layer, [])).toBe(0);
  });

  it('快照超缓冲上限 → 截断不越界', () => {
    const layer = createPointsLayer(2);
    const n = syncToPoints(layer, [mkPart(), mkPart(), mkPart()]);
    expect(n).toBe(2);
  });
});

describe('tweakFor 类型微调', () => {
  it('未知类型 → 默认 (1,1,0)', () => {
    expect(tweakFor('not_a_real_particle')).toEqual({ size: 1, alpha: 1, hue: 0 });
  });

  it('大小写不敏感 + minecraft: 前缀', () => {
    expect(tweakFor('FLAME')).toEqual(tweakFor('flame'));
    expect(tweakFor('minecraft:Flame')).toEqual(tweakFor('flame'));
  });
});

describe('shiftHue', () => {
  it('0 度 / 灰白色系 → 原色', () => {
    expect(shiftHue(1, 0.5, 0.25, 0)).toEqual([1, 0.5, 0.25]);
    expect(shiftHue(0.5, 0.5, 0.5, 90)).toEqual([0.5, 0.5, 0.5]);
  });

  it('红 → 绿（+120°）近似', () => {
    const [r, g, b] = shiftHue(1, 0, 0, 120);
    expect(g).toBeGreaterThan(0.9);
    expect(r).toBeLessThan(0.1);
    expect(b).toBeLessThan(0.1);
  });

  it('360° 一周回到原色', () => {
    const [r, g, b] = shiftHue(0.8, 0.3, 0.6, 360);
    expect(r).toBeCloseTo(0.8, 10);
    expect(g).toBeCloseTo(0.3, 10);
    expect(b).toBeCloseTo(0.6, 10);
  });
});

describe('createPointsLayer 几何', () => {
  it('缓冲尺寸 + 属性 + drawRange 默认 0', () => {
    const layer = createPointsLayer(3);
    expect(layer.pos.length).toBe(9);
    expect(layer.color.length).toBe(12);
    expect(layer.size.length).toBe(3);
    const geo = layer.points.geometry;
    expect(geo.getAttribute('position').itemSize).toBe(3);
    expect(geo.getAttribute('color').itemSize).toBe(4);
    // 默认 drawRange 未启用（count=Infinity）；调用方按 syncToPoints 返回值 setDrawRange
    expect(geo.drawRange.count).toBe(Infinity);
    geo.setDrawRange(0, 2);
    expect(geo.drawRange.count).toBe(2);
    const mat = layer.points.material as THREE.ShaderMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    layer.dispose();
  });
});

describe('性能：2 万粒子 sync（计划 §八 60fps 预算的 CPU 侧）', () => {
  it('N=20000 全量重写 < 2ms', () => {
    const N = 20000;
    const parts: RenderParticle[] = new Array(N);
    for (let i = 0; i < N; i++) {
      parts[i] = { x: i * 0.01, y: 0, z: 0, r: 1, g: 0.5, b: 0.25, a: 0.8, name: 'flame' };
    }
    const layer = createPointsLayer(N);
    // 预热（类型表查找/色相分支 JIT）
    syncToPoints(layer, parts, 1, 1);
    const t0 = performance.now();
    const runs = 20;
    for (let i = 0; i < runs; i++) syncToPoints(layer, parts, 1, 1);
    const ms = (performance.now() - t0) / runs;
    expect(ms).toBeLessThan(2);
  });
});
