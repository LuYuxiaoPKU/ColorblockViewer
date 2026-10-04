// src/render/render2d.ts 直测：等距投影与视角自动适配（纯函数，无 DOM 依赖）。
// Canvas 2D 绘制路径依赖浏览器上下文（headless 无法断言像素），由浏览器
// 手工/preview 验证；色值口径共用 color.ts particleVisual（3D/2D 同一份，
// tests/render/points.test.ts 已锁）。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Render2DViewport, fit, particleProjection } from '../../src/render/render2d';
import type { RenderParticle } from '../../src/render/color';
import type { SnapshotSource } from '../../src/render/sync';

function mkPart(over: Partial<RenderParticle> = {}): RenderParticle {
  return { x: 0, y: 0, z: 0, r: 1, g: 0.5, b: 0.25, a: 0.8, name: 'flame', age: 0, lifetime: 60, vanilla: false, ...over };
}

describe('particleProjection 等距投影', () => {
  it('原点 → 视口中心', () => {
    const p = particleProjection(0, 0, 0, 10, 100, 200);
    expect(p.sx).toBe(100);
    expect(p.sy).toBe(200);
  });
  it('x 轴 → 右下（+x：sx+KX·s、sy+KY·s）', () => {
    const p = particleProjection(1, 0, 0, 10, 0, 0);
    expect(p.sx).toBeCloseTo(Math.sqrt(3) / 2 * 10, 6);
    expect(p.sy).toBeCloseTo((Math.sqrt(3) / 4) * 10, 6);
  });
  it('z 轴 → 左下（与 x 对称）', () => {
    const p = particleProjection(0, 0, 1, 10, 0, 0);
    expect(p.sx).toBeCloseTo(-(Math.sqrt(3) / 2) * 10, 6);
    expect(p.sy).toBeCloseTo((Math.sqrt(3) / 4) * 10, 6);
  });
  it('y 轴 → 纯竖直向上', () => {
    const p = particleProjection(0, 1, 0, 10, 5, 7);
    expect(p.sx).toBe(5);
    expect(p.sy).toBe(7 - 10);
  });
});

describe('fit 视角自动适配', () => {
  it('无粒子 → 按网格边长定框、云中心居中', () => {
    const f = fit([], 10, 1000, 1000);
    // 云 = ±5 立方：投影宽 10·KX，高 = KY·20 + 10（y 方向 ±5）
    const spanX = 10 * Math.sqrt(3);
    const spanY = (Math.sqrt(3) / 4) * 20 + 10;
    expect(f.scale).toBeCloseTo(Math.min(1000 * 0.82 / spanX, 1000 * 0.82 / spanY), 4);
    expect(f.ox).toBeCloseTo(500, 4);
    expect(f.oy).toBeCloseTo(500, 4);
  });
  it('单粒子/稀疏 → 缩放上限 60px/block（不放大成巨圆）', () => {
    const f = fit([mkPart({ x: 2, y: 3, z: 1 })], 10, 800, 600);
    expect(f.scale).toBe(60);
  });
  it('大范围云 → 缩放到 82% 视口', () => {
    const f = fit([mkPart({ x: -100, y: 0, z: 0 }), mkPart({ x: 100, y: 0, z: 0 })], 10, 1000, 1000);
    const spanX = 200 * (Math.sqrt(3) / 2);
    expect(f.scale).toBeCloseTo(1000 * 0.82 / spanX, 4);
    // 云中心 (0,0,0) → 视口中心
    expect(f.ox).toBeCloseTo(500, 4);
    expect(f.oy).toBeCloseTo(500, 4);
  });
  it('偏置云 → ox/oy 把云中心挪到视口中心', () => {
    const f = fit([mkPart({ x: 30, y: 10, z: 0 })], 10, 1000, 1000);
    // 云在 y=0 平面的投影中心：sx=(30)·KX，sy=KY·30−10
    const cx = 30 * (Math.sqrt(3) / 2);
    const cy = (Math.sqrt(3) / 4) * 30 - 10;
    expect(f.ox).toBeCloseTo(500 - cx * f.scale, 4);
    expect(f.oy).toBeCloseTo(500 - cy * f.scale, 4);
  });
});

// 生命周期用例用 fake DOM（真实 2D 绘制路径依赖浏览器上下文，headless 不测
// 像素；ctx = null 时 draw 提前返回，只锁挂载/更新/截断/清理行为）
function fakeEnv() {
  const containerChildren: unknown[] = [];
  const container = {
    appendChild: (el: unknown) => containerChildren.push(el),
    removeChild: (el: unknown) => {
      const i = containerChildren.indexOf(el);
      if (i >= 0) containerChildren.splice(i, 1);
    },
    get children() {
      return containerChildren;
    },
  } as unknown as HTMLElement;
  const canvas = {
    style: {} as Record<string, string>,
    clientWidth: 300,
    clientHeight: 200,
    width: 0,
    height: 0,
    getContext: () => null,
    parentElement: container,
  } as unknown as HTMLCanvasElement;
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return { container, canvas, containerChildren };
}

describe('Render2DViewport 生命周期（fake DOM）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('构造挂 canvas 到容器；update 截断到容量上限', () => {
    const { container, canvas, containerChildren } = fakeEnv();
    const vp = new Render2DViewport(container, 10);
    expect(containerChildren).toContain(canvas);
    expect(vp.size).toBe(200);
    const parts = Array.from({ length: 50 }, (_, i) => mkPart({ x: i, age: i % 10 }));
    expect(vp.update({ snapshot: () => parts } as unknown as SnapshotSource)).toBe(10);
  });

  it('设置方法不抛错；start 幂等；倍数可读写', () => {
    const { container } = fakeEnv();
    const vp = new Render2DViewport(container, 100);
    vp.setGrid(20, false);
    vp.setAtlasKey('1.21.11');
    vp.setSizeMul(2);
    vp.setAlphaMul(0.5);
    vp.setPointScale(400, 50); // 快速模式空操作
    vp.start();
    vp.start(); // 幂等
    vp.stop();
    expect(vp.sizeMul).toBe(2);
    expect(vp.alphaMul).toBe(0.5);
  });

  it('dispose 从容器移除 canvas（size 归 0）', () => {
    const { container, containerChildren } = fakeEnv();
    const vp = new Render2DViewport(container, 10);
    vp.start();
    vp.dispose();
    expect(containerChildren.length).toBe(0);
    expect(vp.size).toBe(0);
  });
});
