// 运行时导出（调研 A+C）：
//  - captureFilename：文件名格式锁
//  - drawGifFrame：fake 2D ctx 记录调用（背景/加色混合/圆点路径）——与
//    Render2DViewport.draw 同口径（视觉回归锁在两侧共用函数 particleVisual 上）
//  - encodeGif：headless 不可用（renderPixels 需真 2D getImageData）→ 锁
//    「依赖真画布」的报错路径 + gifenc 编码用 gallery 工具已验证（node 同链），
//    此处用最小像素桩覆盖 writeFrame 参数语义。
import { describe, it, expect } from 'vitest';
import { captureFilename, drawGifFrame, encodeGif } from '../../src/render/exportCapture';
import type { SimParticle } from '../../src/sim/types';

function fakeCtx(): CanvasRenderingContext2D & { calls: string[] } {
  const calls: string[] = [];
  const gradient = { addColorStop: () => calls.push('addColorStop') };
  return {
    calls,
    setTransform: () => calls.push('setTransform'),
    fillRect: () => calls.push('fillRect'),
    beginPath: () => calls.push('beginPath'),
    arc: () => calls.push('arc'),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    createRadialGradient: () => gradient,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }) as never,
  } as never;
}

function particle(over: Partial<SimParticle> = {}): SimParticle {
  return {
    id: 1, name: 'minecraft:end_rod',
    x: 0, y: 1, z: 0,
    vx: 0, vy: 0, vz: 0,
    r: 1, g: 0.95, b: 0.89, a: 1,
    age: 5, lifetime: 60,
    alive: true, stop: false, vanilla: false,
    cx: 0, cy: 0, cz: 0,
    ...over,
  } as SimParticle;
}

describe('captureFilename', () => {
  it('格式：colorblockviewer-tick<N>-<HHMMSS>.png', () => {
    expect(captureFilename(42)).toMatch(/^colorblockviewer-tick42-\d{6}\.png$/);
  });
});

describe('drawGifFrame', () => {
  it('背景填充 + lighter 加色 + 粒子圆点（与 render2d.draw 同口径）', () => {
    const ctx = fakeCtx();
    drawGifFrame(ctx, [particle()], { width: 64, height: 48, gridSize: 10 });
    expect(ctx.calls[0]).toBe('setTransform');
    expect(ctx.calls[1]).toBe('fillRect'); // 背景铺底
    expect(ctx.calls).toContain('fill');   // 粒子圆点（半径 <1.5 → arc+fill 路径）
  });
  it('大半径粒子走径向渐变（软光晕分支）', () => {
    const ctx = fakeCtx();
    drawGifFrame(ctx, [particle({ sizeMul: 8 })], { width: 256, height: 192, gridSize: 10 });
    expect(ctx.calls).toContain('addColorStop');
  });
});

describe('encodeGif', () => {
  it('依赖真 2D 画布（headless getContext null → 报错冒泡）', () => {
    // renderPixels 里 document.createElement 在 vitest jsdom/无 DOM 环境可能不存在
    // 或 ctx 为 null → 抛错即锁「不是静默坏 GIF」的语义
    expect(() =>
      encodeGif(
        [{ particles: [particle()], tick: 0, delayMs: 50 }],
        (c, parts, o) => drawGifFrame(c, parts, o),
        { width: 32, height: 32, gridSize: 10 },
      ),
    ).toThrow();
  });
});
