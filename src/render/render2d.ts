// 快速模式渲染层：Canvas 2D 点云（无 WebGL、**不加载 three**）。
// 与 SimViewport（完整模式）接口对齐（update/setGrid/resize/start/stop/dispose/
// setAtlasKey/setPointScale），App 按 sim.renderMode 条件加载二选一。
//
// 仿真引擎在两种模式下 1:1 照常运行（位置/颜色/寿命完全保留）；快速模式只丢
// 贴图外观——粒子画成颜色圆点（色值口径与完整模式同一份：color.ts particleVisual，
// 含类型微调/多帧淡出/end_rod 颜色插值），以 `lighter`（加色）近似 3D 的
// AdditiveBlending，软边缘径向渐变近似圆点着色器的 smoothstep 光晕。
//
// 等距正交投影（无透视）：世界 (x,y,z) → 屏幕 (x−z, y 向上) 的斜 45° 俯视
// （与完整模式 OrbitControls 缺省视角观感一致，y 仍为竖直轴）。视角自动适配：
// 每帧按粒子云包围盒（无粒子时按网格尺寸）居中 + 缩放，粒子云飘出视野不会
// 丢失。rAF 带脏检查：仅 update()（tick 后）标记的帧重绘，空闲不消耗 GPU/CPU。

import { particleVisual, type RenderParticle } from './color';
import type { SnapshotSource } from './sync';

// 等距投影系数（30° 等轴测）：sx = (x−z)·√3/2，sy = (x+z)·√3/4 − y
const KX = Math.sqrt(3) / 2;
const KY = Math.sqrt(3) / 4;

/** 世界坐标 → 视口内坐标（CSS px，y 向下；scale = px/世界块，ox/oy = 中心偏移）。
 *  纯函数，直测。 */
export function particleProjection(
  x: number,
  y: number,
  z: number,
  scale: number,
  ox: number,
  oy: number,
): { sx: number; sy: number } {
  return { sx: ox + (x - z) * KX * scale, sy: oy + (KY * (x + z) - y) * scale };
}

export interface ViewFit {
  scale: number; // 像素 / 世界块
  ox: number; // 云中心 → 视口中心 的 x 偏移（px）
  oy: number; // …y 偏移（px，向下为正）
}

/** 视角自动适配：云在 y=0 平面的投影包围盒 → 居中 + 等比缩放填满视口
 *  （上限 60px/block 防止稀疏粒子被放大成巨圆；下限 1）。
 *  无粒子（n=0）时按 grid 边长定框。纯函数，直测。 */
export function fit(parts: RenderParticle[], grid: number, w: number, h: number): ViewFit {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let n = 0;
  for (const p of parts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    n++;
  }
  if (n === 0) {
    const r = Math.max(grid, 10) / 2;
    minX = -r;
    maxX = r;
    minZ = -r;
    maxZ = r;
    minY = -r;
    maxY = r;
  }
  // 等距投影下云的投影包围盒
  const xMin = (minX - maxZ) * KX;
  const xMax = (maxX - minZ) * KX;
  const yMin = KY * (minX + minZ) - maxY;
  const yMax = KY * (maxX + maxZ) - minY;
  const spanX = Math.max(xMax - xMin, 4);
  const spanY = Math.max(yMax - yMin, 4);
  const scale = Math.max(1, Math.min(60, Math.min((w * 0.82) / spanX, (h * 0.82) / spanY)));
  return {
    scale,
    ox: w / 2 - ((xMin + xMax) / 2) * scale,
    oy: h / 2 - ((yMin + yMax) / 2) * scale,
  };
}

/** 快速模式视口。接口与 SimViewport 对齐（App 侧统一按 ViewportApi 调用）。
 *  setPointScale 为空操作（2D 无透视换算）；setAtlasKey 记录版本供帧表查询。 */
export class Render2DViewport {
  private canvas: HTMLCanvasElement | null;
  private ctx: CanvasRenderingContext2D | null;
  private parts: RenderParticle[] = [];
  private raf = 0;
  private running = false;
  private dirty = false;
  private max: number;
  private gridSize = 10;
  private gridVisible = true;
  /** 游戏版本（帧表按它分区；与完整模式一致） */
  private atlasKey = '26.2';

  sizeMul = 1;
  alphaMul = 1;

  /** 与 SimViewport 对齐的空操作字段（快速模式无预热阶段；App 无条件安装回调，
   *  本类从不调用 → 无进度上报，进度条不出现）。 */
  onProgress: ((stage: 'atlas' | 'ready', frac: number, label?: string) => void) | null = null;

  constructor(container: HTMLElement, maxParticles: number, atlasKey = '26.2') {
    this.max = maxParticles;
    this.atlasKey = atlasKey;
    const cv = document.createElement('canvas');
    cv.style.display = 'block';
    cv.style.width = '100%';
    cv.style.height = '100%';
    container.appendChild(cv);
    this.canvas = cv;
    this.ctx = cv.getContext('2d');
    this.resize();
  }

  get size(): number {
    return this.canvas ? this.canvas.clientHeight : 0;
  }

  /** 与 SimViewport 对齐：记录版本（2D 无贴图加载，色值口径的帧表查询按它分区）。 */
  setAtlasKey(key: string): void {
    if (key !== this.atlasKey) {
      this.atlasKey = key;
      this.dirty = true;
    }
  }

  /** 与 SimViewport 对齐的空操作（2D 无透视换算，pxPerBlock 由 fit 自适应）。 */
  setPointScale(_heightPx: number, _fovDeg: number): void {}

  setGrid(size: number, visible: boolean): void {
    if (size !== this.gridSize || visible !== this.gridVisible) {
      this.gridSize = size;
      this.gridVisible = visible;
      this.dirty = true;
    }
  }

  setSizeMul(v: number): void {
    this.sizeMul = v;
    this.dirty = true;
  }

  setAlphaMul(v: number): void {
    this.alphaMul = v;
    this.dirty = true;
  }

  /** tick/命令后调用：记录粒子快照并标脏。返回可见粒子数（截断到容量上限）。 */
  update(source: SnapshotSource): number {
    this.parts = source.snapshot().slice(0, this.max);
    this.dirty = true;
    return this.parts.length;
  }

  resize(): void {
    if (!this.canvas) return;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.dirty = true;
  }

  /** 渲染循环（脏检查：仅 update/setGrid/resize 标脏的帧重绘）。 */
  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      if (this.dirty) {
        this.dirty = false;
        this.draw();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
  }

  private draw(): void {
    const ctx = this.ctx;
    const cv = this.canvas;
    if (!ctx || !cv) return;
    const w = cv.width;
    const h = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0e14'; // 与完整模式 scene 背景一致
    ctx.fillRect(0, 0, w, h);
    const f = fit(this.parts, this.gridSize, w, h);
    if (this.gridVisible) this.drawGrid(ctx, f);
    this.drawAxes(ctx, f);
    const comp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter'; // 近似 AdditiveBlending
    for (const p of this.parts) {
      const v = particleVisual(p, 1, this.atlasKey, this.sizeMul, this.alphaMul);
      if (v.a <= 0.004) continue; // 与 3D 着色器 discard 阈值一致
      const pr = particleProjection(p.x, p.y, p.z, f.scale, f.ox, f.oy);
      const radius = Math.max(v.radius * f.scale, 0.5);
      ctx.globalAlpha = Math.min(1, v.a);
      if (radius < 1.5) {
        ctx.fillStyle = `rgb(${Math.round(v.r * 255)},${Math.round(v.g * 255)},${Math.round(v.b * 255)})`;
        ctx.beginPath();
        ctx.arc(pr.sx, pr.sy, radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 软光晕（近似 3D 圆点着色器 smoothstep(1, 0.2, d) 的衰减）
        const g = ctx.createRadialGradient(pr.sx, pr.sy, 0, pr.sx, pr.sy, radius);
        const rgb = (a: number) =>
          `rgba(${Math.round(v.r * 255)},${Math.round(v.g * 255)},${Math.round(v.b * 255)},${a})`;
        g.addColorStop(0, rgb(1));
        g.addColorStop(0.2, rgb(1));
        g.addColorStop(1, rgb(0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pr.sx, pr.sy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = comp;
  }

  private drawGrid(ctx: CanvasRenderingContext2D, f: ViewFit): void {
    const n = this.gridSize;
    const lo = Math.floor(-n / 2);
    const hi = Math.floor(n / 2);
    ctx.strokeStyle = '#1c2130';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = lo; i <= hi; i++) {
      // x 线（沿 x 轴）/ z 线（沿 z 轴），y=0 平面
      let a = particleProjection(i, 0, lo, f.scale, f.ox, f.oy);
      let b = particleProjection(i, 0, hi, f.scale, f.ox, f.oy);
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      a = particleProjection(lo, 0, i, f.scale, f.ox, f.oy);
      b = particleProjection(hi, 0, i, f.scale, f.ox, f.oy);
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
    }
    ctx.stroke();
    ctx.strokeStyle = '#3a4150'; // 外框，与 3D GridHelper 主色一致
    ctx.beginPath();
    const c0 = particleProjection(lo, 0, lo, f.scale, f.ox, f.oy);
    const c1 = particleProjection(hi, 0, lo, f.scale, f.ox, f.oy);
    const c2 = particleProjection(hi, 0, hi, f.scale, f.ox, f.oy);
    const c3 = particleProjection(lo, 0, hi, f.scale, f.ox, f.oy);
    ctx.moveTo(c0.sx, c0.sy);
    ctx.lineTo(c1.sx, c1.sy);
    ctx.lineTo(c2.sx, c2.sy);
    ctx.lineTo(c3.sx, c3.sy);
    ctx.closePath();
    ctx.stroke();
  }

  private drawAxes(ctx: CanvasRenderingContext2D, f: ViewFit): void {
    const L = 2; // 与 3D AxesHelper(2) 一致
    const axis = (dx: number, dy: number, dz: number, color: string) => {
      const a = particleProjection(0, 0, 0, f.scale, f.ox, f.oy);
      const b = particleProjection(dx, dy, dz, f.scale, f.ox, f.oy);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    };
    axis(L, 0, 0, '#c0392b'); // x 红
    axis(0, L, 0, '#27ae60'); // y 绿
    axis(0, 0, L, '#2980b9'); // z 蓝
  }
}
