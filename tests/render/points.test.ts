// M4 渲染层 headless 单测：缓冲映射 / 类型微调 / 色相旋转 / drawRange / 帧 UV。
// BufferGeometry 不依赖 WebGL 上下文，可直接构造。

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BASE_SIZE,
  createPointsLayer,
  FRAME_MS,
  setPointsLayerAtlasKey,
  shiftHue,
  syncToPoints,
  textureFor,
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
    // smoke：size 1.3 → BASE*1.3*2（float32 存储有 ulp 偏差，6 位精度足够）
    expect(layer.size[0]).toBeCloseTo(BASE_SIZE * 1 * 2, 6);
    expect(layer.size[1]).toBeCloseTo(BASE_SIZE * 1.3 * 2, 6);
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

  it('end_rod 尺寸放大（glitter 帧 8×8 仅 4–14 可见像素，默认尺寸屏上 ~4px 不可见）', () => {
    expect(tweakFor('end_rod').size).toBeGreaterThan(1);
  });
});

describe('textureFor 帧表查询', () => {
  it('已知类型 → 帧列表（end_rod = glitter 帧、smoke = generic 帧）', () => {
    expect(textureFor('end_rod')).toEqual([
      'glitter_7', 'glitter_6', 'glitter_5', 'glitter_4', 'glitter_3', 'glitter_2', 'glitter_1', 'glitter_0',
    ]);
    expect(textureFor('smoke')?.[0]).toBe('generic_7');
    expect(textureFor('smoke')?.length).toBe(8);
  });

  it('大小写不敏感 + minecraft: 前缀；未知类型 → null（圆点回退）', () => {
    expect(textureFor('SMOKE')).toEqual(textureFor('smoke'));
    expect(textureFor('minecraft:Smoke')).toEqual(textureFor('smoke'));
    expect(textureFor('not_a_real_particle')).toBeNull();
    expect(textureFor('block')).toBeNull(); // 无 JSON 的硬编码类型（方块纹理）→ 圆点
  });
});

describe('syncToPoints 帧 UV', () => {
  it('有帧表类型按帧序写入图集格 UV；无帧表 → (0,0)', () => {
    const layer = createPointsLayer(4);
    // end_rod 帧 glitter_7..0（8 帧）；相位 t*50ms → 帧号 t % 8
    const n = syncToPoints(layer, [mkPart({ name: 'end_rod' }), mkPart({ name: 'block' })], 1, 1, 3 * FRAME_MS);
    expect(n).toBe(2);
    // 帧格 UV 落在图集内：u ∈ [0, 1]（最右列格 u=1 合法），v ∈ (0, 1]（行顶缘）
    expect(layer.uv[0]).toBeGreaterThanOrEqual(0);
    expect(layer.uv[0]).toBeLessThanOrEqual(1);
    expect(layer.uv[1]).toBeGreaterThan(0);
    expect(layer.uv[1]).toBeLessThanOrEqual(1);
    // 相位推进 → 帧切换（UV 变化）
    const u3 = layer.uv[0];
    const v3 = layer.uv[1];
    syncToPoints(layer, [mkPart({ name: 'end_rod' })], 1, 1, 4 * FRAME_MS);
    expect(layer.uv[0] === u3 && layer.uv[1] === v3).toBe(false);
    // 帧序回绕：8 帧后回到第 0 帧 UV
    syncToPoints(layer, [mkPart({ name: 'end_rod' })], 1, 1, 8 * FRAME_MS);
    const uWrap = layer.uv[0];
    const vWrap = layer.uv[1];
    syncToPoints(layer, [mkPart({ name: 'end_rod' })], 1, 1, 0);
    expect(layer.uv[0]).toBe(uWrap);
    expect(layer.uv[1]).toBe(vWrap);
    // 无帧表类型（block 无 JSON → 圆点回退）→ (0,0)
    syncToPoints(layer, [mkPart({ name: 'block' })]);
    expect(layer.uv[0]).toBe(0);
    expect(layer.uv[1]).toBe(0);
  });
});

describe('atlasKey 版本分区', () => {
  it('帧表/UV 按版本取：两版本共有类型各自命中各自图集', () => {
    const layer262 = createPointsLayer(2, '26.2');
    const layer121 = createPointsLayer(2, '1.21.11');
    const n1 = syncToPoints(layer262, [mkPart({ name: 'end_rod' })], 1, 1, 0, '26.2');
    const n2 = syncToPoints(layer121, [mkPart({ name: 'end_rod' })], 1, 1, 0, '1.21.11');
    expect(n1).toBe(1);
    expect(n2).toBe(1);
    // 两版本图集格布局不同（帧集合不同）→ UV 各自落在各自图集内（v > 0 = 有帧格）
    expect(layer262.uv[1]).toBeGreaterThan(0);
    expect(layer121.uv[1]).toBeGreaterThan(0);
    layer262.dispose();
    layer121.dispose();
  });

  it('setPointsLayerAtlasKey：复位图集状态并推进 epoch（在途旧加载判废）', () => {
    const layer = createPointsLayer(2, '26.2');
    const e0 = layer._atlasEpoch;
    setPointsLayerAtlasKey(layer, '1.21.11');
    expect(layer._atlasEpoch).toBe(e0 + 1);
    // 切换后 uHasAtlas 归零（加载完成前圆点回退）
    expect(layer.uniforms.uHasAtlas.value).toBe(0);
    expect(layer.atlasLoaded).toBe(false);
    // headless 下加载立即 resolve null → applyAtlas 不置位，保持圆点
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(layer.uniforms.uHasAtlas.value).toBe(0);
        layer.dispose();
        resolve();
      }, 20);
    });
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
    expect(layer.uv.length).toBe(6);
    const geo = layer.points.geometry;
    expect(geo.getAttribute('position').itemSize).toBe(3);
    expect(geo.getAttribute('color').itemSize).toBe(4);
    expect(geo.getAttribute('size').itemSize).toBe(1);
    expect(geo.getAttribute('uv').itemSize).toBe(2);
    // 默认 drawRange 未启用（count=Infinity）；调用方按 syncToPoints 返回值 setDrawRange
    expect(geo.drawRange.count).toBe(Infinity);
    geo.setDrawRange(0, 2);
    expect(geo.drawRange.count).toBe(2);
    const mat = layer.points.material as THREE.ShaderMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    // 图集未加载（headless）→ 圆点分支
    expect(layer.uniforms.uHasAtlas.value).toBe(0);
    expect(layer.uniforms.uCell.value.x).toBeCloseTo(1 / 12, 6);
    layer.dispose();
  });
});

describe('性能：2 万粒子 sync（计划 §八 60fps 预算的 CPU 侧）', () => {
  it('N=20000 全量重写 中位 < 15ms（CI runner 噪声抗抖动）', () => {
    const N = 20000;
    const parts: RenderParticle[] = new Array(N);
    for (let i = 0; i < N; i++) {
      parts[i] = { x: i * 0.01, y: 0, z: 0, r: 1, g: 0.5, b: 0.25, a: 0.8, name: 'flame' };
    }
    const layer = createPointsLayer(N);
    // 预热（类型表查找/色相分支 JIT）
    for (let i = 0; i < 3; i++) syncToPoints(layer, parts, 1, 1);
    // 中位数抗噪：CI ubuntu runner 噪声窗口可把单次均值拉到 5×（2026-09-06 同日
    // avg 2.33ms 与 11.4ms 两次实测），均值会被单个慢窗口拖垮 → 31 样本取中位。
    const samples: number[] = [];
    for (let i = 0; i < 31; i++) {
      const t0 = performance.now();
      syncToPoints(layer, parts, 1, 1);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const ms = samples[15];
    // 门槛 15ms：本地典型 ~0.7ms（~20× 余量，仍是回归门槛）；远低于 50ms/tick
    // 逻辑预算（bench 16ms/tick 门槛内）。
    expect(ms).toBeLessThan(15);
  });
});
