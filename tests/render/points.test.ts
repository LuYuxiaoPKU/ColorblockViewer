// M4 渲染层 headless 单测：缓冲映射 / 类型微调 / 色相旋转 / drawRange /
// age-progress 帧 UV / 原版淡出 / end_rod 颜色插值。
// BufferGeometry 不依赖 WebGL 上下文，可直接构造。

import { describe, expect, it, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  BASE_SIZE,
  createPointsLayer,
  loadAtlasTexture,
  setPointsLayerAtlasKey,
  shiftHue,
  syncToPoints,
  textureFor,
  tweakFor,
  _resetAtlasCache,
  type RenderParticle,
} from '../../src/render/points';
import { PARTICLE_DATA } from '../../src/render/particleData';

function mkPart(over: Partial<RenderParticle> = {}): RenderParticle {
  return { x: 1, y: 2, z: 3, r: 1, g: 0.5, b: 0.25, a: 0.8, name: 'flame', age: 0, lifetime: 60, vanilla: false, ...over };
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

describe('syncToPoints 原版帧动画行为（age-progress，1.21.1 反编译核对）', () => {
  it('多帧类型按寿命进度选帧：age 推进 → UV 推进、只播一遍不循环', () => {
    const layer = createPointsLayer(4);
    const L = 60;
    const uvAt = (age: number): [number, number] => {
      syncToPoints(layer, [mkPart({ name: 'end_rod', age, lifetime: L })]);
      return [layer.uv[0], layer.uv[1]];
    };
    const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
    const u0 = uvAt(0);
    // 帧格 UV 落在图集内：u ∈ [0, 1]（最右列格 u=1 合法），v ∈ (0, 1]（行顶缘）
    expect(u0[0]).toBeGreaterThanOrEqual(0);
    expect(u0[0]).toBeLessThanOrEqual(1);
    expect(u0[1]).toBeGreaterThan(0);
    expect(u0[1]).toBeLessThanOrEqual(1);
    // age=30 → 帧 floor(30*7/60)=3（glitter_4）→ UV 与首帧不同
    const u30 = uvAt(30);
    expect(same(u30, u0)).toBe(false);
    // 死亡前最后活帧 age=59 → floor(59*7/60)=6（glitter_1）；
    // 末帧 glitter_0（index 7）实际不可见（活粒子 age ≤ lifetime-1）
    const u59 = uvAt(59);
    expect(same(u59, u30)).toBe(false);
    // 不循环：age=59 的 UV ≠ age=0（旧全局相位实现里会回绕到第 0 帧）
    expect(same(u59, u0)).toBe(false);
    // 无帧表类型（block 无 JSON → 圆点回退）→ (0,0)
    syncToPoints(layer, [mkPart({ name: 'block' })]);
    expect(layer.uv[0]).toBe(0);
    expect(layer.uv[1]).toBe(0);
    layer.dispose();
  });

  it('后半程线性淡出：前 50% alpha 不变，age=lifetime-1 ≈ 0.5（非 0）', () => {
    const layer = createPointsLayer(4);
    const L = 60;
    const alphaAt = (age: number): number => {
      syncToPoints(layer, [mkPart({ name: 'end_rod', age, lifetime: L, a: 1 })]);
      return layer.color[3];
    };
    expect(alphaAt(0)).toBeCloseTo(1, 6);
    expect(alphaAt(L / 2)).toBeCloseTo(1, 6); // age ≤ lifetime/2 → 不透明
    // 1 - (L-1-L/2)/L = 0.5 + 1/L
    expect(alphaAt(L - 1)).toBeCloseTo(0.5 + 1 / L, 6);
    layer.dispose();
  });

  it('原版 /particle 粒子出生色恒白（vanilla=true）；模组粒子保留命令色', () => {
    const layer = createPointsLayer(4);
    syncToPoints(layer, [mkPart({ name: 'end_rod', vanilla: true, r: 0.2, g: 0.4, b: 0.6 })]);
    expect(layer.color[0]).toBeCloseTo(1, 6);
    expect(layer.color[1]).toBeCloseTo(1, 6);
    expect(layer.color[2]).toBeCloseTo(1, 6);
    // 模组粒子（vanilla=false）age=0 → f=1 → 命令色原样
    syncToPoints(layer, [mkPart({ name: 'end_rod', r: 0.2, g: 0.4, b: 0.6 })]);
    expect(layer.color[0]).toBeCloseTo(0.2, 6);
    expect(layer.color[1]).toBeCloseTo(0.4, 6);
    expect(layer.color[2]).toBeCloseTo(0.6, 6);
    layer.dispose();
  });

  it('end_rod 颜色向 #F2DEC9 每 tick 靠拢 20%（闭式 c = t + (c0-t)·0.8^age）', () => {
    const layer = createPointsLayer(4);
    const [tr, tg, tb] = [242 / 255, 222 / 255, 201 / 255];
    const [r0, g0, b0] = [0.2, 0.4, 0.6];
    const cAt = (age: number): [number, number, number] => {
      syncToPoints(layer, [mkPart({ name: 'end_rod', age, r: r0, g: g0, b: b0 })]);
      return [layer.color[0], layer.color[1], layer.color[2]];
    };
    // age=0 → 命令色（f=1；float32 存储有 ulp 偏差）
    const c0 = cAt(0);
    expect(c0[0]).toBeCloseTo(r0, 6);
    expect(c0[1]).toBeCloseTo(g0, 6);
    expect(c0[2]).toBeCloseTo(b0, 6);
    // age=5 → c = t + (c0 - t)·0.8^5
    const f = Math.pow(0.8, 5);
    const c5 = cAt(5);
    expect(c5[0]).toBeCloseTo(tr + (r0 - tr) * f, 6);
    expect(c5[1]).toBeCloseTo(tg + (g0 - tg) * f, 6);
    expect(c5[2]).toBeCloseTo(tb + (b0 - tb) * f, 6);
    // age=60 → 几乎完全到目标色
    const c60 = cAt(60);
    expect(c60[0]).toBeCloseTo(tr, 2);
    expect(c60[1]).toBeCloseTo(tg, 2);
    expect(c60[2]).toBeCloseTo(tb, 2);
    layer.dispose();
  });

  it('无颜色插值的类型（smoke）不向任何目标靠拢', () => {
    const layer = createPointsLayer(4);
    syncToPoints(layer, [mkPart({ name: 'smoke', age: 30, r: 0.3, g: 0.4, b: 0.5 })]);
    expect(layer.color[0]).toBeCloseTo(0.3, 6);
    expect(layer.color[1]).toBeCloseTo(0.4, 6);
    expect(layer.color[2]).toBeCloseTo(0.5, 6);
    layer.dispose();
  });

  it('dust_color_transition：渲染色随寿命进度 from→to 线性插值（lerpColors 字节码 frac=age/(lifetime+1)）', () => {
    const layer = createPointsLayer(4);
    // from = 蓝 (0,0,1)，to = 红 (1,0,0)；lifetime = 60 → 分母 61
    const part = (age: number): RenderParticle =>
      mkPart({
        name: 'dust_color_transition',
        age,
        lifetime: 60,
        nbtTint: true,
        r: 0, g: 0, b: 1, // 出生色 = from_color
        colorFrom: { r: 0, g: 0, b: 1 },
        colorTo: { r: 1, g: 0, b: 0 },
      });
    const cAt = (age: number): [number, number, number] => {
      syncToPoints(layer, [part(age)]);
      return [layer.color[0], layer.color[1], layer.color[2]];
    };
    // age=0 → frac=0 → from 原样
    expect(cAt(0)).toEqual([0, 0, 1]);
    // age=30 → frac=30/61 → r = 30/61, b = 1-30/61（JOML lerp：from+(to-from)·frac）
    const f = 30 / 61;
    const c30 = cAt(30);
    expect(c30[0]).toBeCloseTo(f, 6);
    expect(c30[1]).toBeCloseTo(0, 6);
    expect(c30[2]).toBeCloseTo(1 - f, 6);
    // 单调逼近 to：age 越大 r 越大、b 越小
    const c45 = cAt(45);
    expect(c45[0]).toBeGreaterThan(c30[0]);
    expect(c45[2]).toBeLessThan(c30[2]);
    // 未带 colorFrom/colorTo 的多帧类型不受影响（smoke 颜色原样）
    syncToPoints(layer, [mkPart({ name: 'smoke', age: 30, r: 0.3, g: 0.4, b: 0.5 })]);
    expect(layer.color[0]).toBeCloseTo(0.3, 6);
    layer.dispose();
  });

  it('dust_color_transition 渐变优先于 vanilla 出生白（nbtTint 已置位，不强制白）', () => {
    const layer = createPointsLayer(4);
    syncToPoints(layer, [
      mkPart({
        name: 'dust_color_transition',
        age: 0,
        lifetime: 60,
        vanilla: true,
        nbtTint: true,
        r: 0.5, g: 0, b: 0,
        colorFrom: { r: 0.5, g: 0, b: 0 },
        colorTo: { r: 0, g: 0, b: 0.5 },
      }),
    ]);
    // age=0 → from 原样（0.5,0,0），未被 vanilla 白覆盖
    expect(layer.color[0]).toBeCloseTo(0.5, 6);
    expect(layer.color[1]).toBeCloseTo(0, 6);
    expect(layer.color[2]).toBeCloseTo(0, 6);
    layer.dispose();
  });
});

describe('atlasKey 版本分区', () => {
  it('帧表/UV 按版本取：两版本共有类型各自命中各自图集', () => {
    const layer262 = createPointsLayer(2, '26.2');
    const layer121 = createPointsLayer(2, '1.21.11');
    const n1 = syncToPoints(layer262, [mkPart({ name: 'end_rod' })], 1, 1, '26.2');
    const n2 = syncToPoints(layer121, [mkPart({ name: 'end_rod' })], 1, 1, '1.21.11');
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

// ---------- 并行图集加载（fake DOM + fake Image） ----------

function fakeImageEnv(failAt: number[] = [], delayMs = 0) {
  const drawCalls: number[] = [];
  const srcs: string[] = [];
  let created = 0;
  class FakeImage {
    private _src = '';
    complete = true;
    naturalWidth = 8;
    naturalHeight = 8;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    get src() {
      return this._src;
    }
    set src(v: string) {
      this._src = v;
      srcs.push(v); // 记录贴图 URL（验证按版本分目录）
    }
    constructor() {
      created++;
      const mine = created; // 构造时快照（延迟解析时 created 已是终值）
      const shouldFail = failAt.includes(mine);
      const done = () => {
        if (shouldFail) {
          this.complete = false;
          this.onerror?.();
        } else {
          this.onload?.();
        }
      };
      if (delayMs > 0) setTimeout(done, delayMs);
      else queueMicrotask(done);
    }
  }
  const fakeCtx = {
    imageSmoothingEnabled: true,
    drawImage: () => {
      drawCalls.push(drawCalls.length);
    },
  };
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', {
    createElement: (tag: string) =>
      tag === 'canvas' ? { width: 0, height: 0, getContext: () => fakeCtx } : {},
  });
  return { drawCalls, srcs };
}

const FRAME_COUNT_262 = new Set(Object.values(PARTICLE_DATA['26.2'].frames).flat()).size;
const FRAME_COUNT_12111 = new Set(Object.values(PARTICLE_DATA['1.21.11'].frames).flat()).size;

describe('loadAtlasTexture 并行加载与进度（fake DOM）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetAtlasCache();
  });

  it('全帧成功：进度 (0,N) 起、末次 (N,N)，drew 单调不减', async () => {
    fakeImageEnv();
    const prog: [number, number][] = [];
    const tex = (await loadAtlasTexture('26.2', (d, t) => prog.push([d, t]))) as THREE.Texture;
    expect(prog[0]).toEqual([0, FRAME_COUNT_262]);
    expect(prog[prog.length - 1]).toEqual([FRAME_COUNT_262, FRAME_COUNT_262]);
    for (let i = 1; i < prog.length; i++) {
      expect(prog[i][0]).toBeGreaterThanOrEqual(prog[i - 1][0]);
      expect(prog[i][1]).toBe(FRAME_COUNT_262);
    }
    expect(prog).toHaveLength(FRAME_COUNT_262 + 1);
    expect(tex).not.toBeNull();
  });

  it('贴图 URL 按版本分目录（particles/<key>/<file>.png）', async () => {
    const env = fakeImageEnv();
    const tex = await loadAtlasTexture('1.21.11');
    expect(tex).not.toBeNull();
    expect(env.srcs).toHaveLength(FRAME_COUNT_12111);
    // base 前缀随构建配置（dev 测试环境 BASE_URL 可能为 '/'），只锁版本子目录 + 文件名
    for (const s of env.srcs) {
      expect(s).toMatch(/\/particles\/1\.21\.11\/[a-z0-9_]+\.png$/);
    }
  });

  it('无进度回调（createPointsLayer 内部调用形态）→ 全帧成功，resolve 纹理', async () => {
    // 回归：onProgress?.(++drew) 在回调缺省时短路不执行 ++drew → drew 恒 0
    // → 误判全缺帧 → resolve null（曾致 headless 下首版图集全静默丢失）
    fakeImageEnv();
    const tex = await loadAtlasTexture('26.2'); // 无 onProgress
    expect(tex).not.toBeNull();
  });

  it('缺帧 onerror → 跳过不画（drew < total），其余帧正常', async () => {
    fakeImageEnv([2]); // 第 2 张创建序的图 onerror
    const prog: [number, number][] = [];
    const tex = await loadAtlasTexture('26.2', (d, t) => prog.push([d, t]));
    expect(tex).not.toBeNull();
    const last = prog[prog.length - 1];
    expect(last[0]).toBe(FRAME_COUNT_262 - 1);
    expect(last[1]).toBe(FRAME_COUNT_262);
  });

  it('同 key 复用 Promise：第二次调用不再触发进度回调', async () => {
    fakeImageEnv();
    let first = 0;
    let second = 0;
    const p1 = loadAtlasTexture('26.2', () => {
      first++;
    });
    const p2 = loadAtlasTexture('26.2', () => {
      second++;
    });
    await p1;
    expect(p2).toBe(p1);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
  });

  it('全帧缺帧 → resolve null（着色器走圆点分支）', async () => {
    fakeImageEnv(Array.from({ length: FRAME_COUNT_262 }, (_, i) => i + 1));
    const tex = await loadAtlasTexture('26.2');
    expect(tex).toBeNull();
  });

  it('epoch 判废：切版本后旧 key 的迟到进度不转发（只收到新 key 的进度）', async () => {
    fakeImageEnv([], 30); // 延迟 30ms 解析 → 切 key 时 26.2 加载仍在途
    const layer = createPointsLayer(2, '26.2');
    const calls: [number, number][] = [];
    layer._onProgress = (d, t) => calls.push([d, t]);
    setPointsLayerAtlasKey(layer, '1.21.11'); // epoch 0→1：26.2 在途进度全部判废
    await new Promise<void>((r) => setTimeout(r, 50));
    // 旧 key（26.2，N=285）的进度一个都不该到；新 key（1.21.11）正常到达
    const N = FRAME_COUNT_12111;
    expect(calls.some(([, t]) => t !== N)).toBe(false);
    expect(calls[calls.length - 1]).toEqual([N, N]);
    layer.dispose();
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
  it('顶点着色器不重声明 Three.js 前缀属性（position/normal/uv）', () => {
    // ShaderMaterial（非 Raw）前缀自动声明 position/normal/uv（WebGL2 下 in）。
    // 源码里再写 `attribute vec2 uv;` → "redefinition" 编译失败 → useProgram
    // INVALID_OPERATION → 粒子整层不渲染（线上 2026-09-07 黑屏事故的根因，
    // headless swiftshader 同样报此错；单测锁住源码，GL 编译靠 CI 构建+人眼）。
    const layer = createPointsLayer(2);
    const vs = (layer.points.material as THREE.ShaderMaterial).vertexShader;
    expect(vs).not.toMatch(/\battribute\s+vec2\s+uv\s*;/);
    expect(vs).not.toMatch(/\battribute\s+vec3\s+position\s*;/);
    expect(vs).not.toMatch(/\battribute\s+vec3\s+normal\s*;/);
    // 自定义属性（color/size）不受前缀声明，必须显式保留
    expect(vs).toMatch(/\battribute\s+vec4\s+color\s*;/);
    expect(vs).toMatch(/\battribute\s+float\s+size\s*;/);
    layer.dispose();
  });

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
      parts[i] = { x: i * 0.01, y: 0, z: 0, r: 1, g: 0.5, b: 0.25, a: 0.8, name: 'flame', age: 0, lifetime: 60, vanilla: false };
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
