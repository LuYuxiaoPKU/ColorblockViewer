// 示例画廊动图生成器：跑引擎 → 2D 快速模式逐帧渲染 → GIF 编码。
// 产物 public/wiki-gallery/<templateId>.gif（提交入库，画廊页 <img> 引用）。
// 渲染口径与 render2d 快速模式一致：等距投影 + 深色底 + lighter 加色圆点
// （粒子颜色/半径/淡出走 color.ts particleVisual，与实况同一份色值逻辑）。
// GIF = 引擎从出生到消亡的全过程循环回放（seed 固定 → 每次生成逐帧一致）。
// 用法：npx tsx scripts/gen-gallery-gifs.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import gifenc from 'gifenc';
const { GIFEncoder } = gifenc;
import { SimEngine } from '../src/sim/engine.ts';
import { parseCommands } from '../src/command/parser.ts';
import { TEMPLATES } from '../src/templates/library.ts';
import { particleProjection, fit } from '../src/render/render2d.ts';
import { particleVisual } from '../src/render/color.ts';

/** 与 SimViewport 构造同口径的引擎默认配置（seed 固定 1 → 逐帧可复现） */
const SIM = {
  playerPos: { x: 0, y: 0, z: 0 },
  defaultLifetime: 20,
  maxParticles: 1000000,
  seed: 1,
  mcVersion: '26.2' as const,
  gridSize: 10,
  gridVisible: true,
  renderMode: 'full' as const,
  reference: 'none' as const,
};

const W = 360;
const H = 360;
const FRAME_MS = 80;
const MAX_COLORS = 248; // GIF 全局调色板容量（留 8 空位防溢出）

/** 每模板的回放窗口（tick）与采样间隔（tick/帧）：粒子寿命决定时长。
 *  循环里先 tickOnce 再画帧，末帧 = ticks+1 tick 的状态；取 ticks 使末帧
 *  恰好是消亡前一 tick → GIF 全程无空帧。
 *  （ripple age=200 全周期；ring 寿命 20 且 0.0628 rad/tick 约 100 tick 转
 *  一圈，全周期会 90% 空帧 → 压缩到 18 tick 使粒子全程可见） */
const SHOWS: Record<string, { ticks: number; every: number }> = {
  ripple: { ticks: 196, every: 4 }, // 50 帧 @80ms = 4s 循环
  ring: { ticks: 18, every: 1 }, // 19 帧 @80ms = 1.52s 循环
};

const BG = '#0b0e14';
const GRID_LINE = '#1c2130';
const GRID_FRAME = '#3a4150';

/** 每帧像素（RGBA）→ 索引图 + 该帧调色板（收集帧内颜色，LRU 兜底复用旧色） */
function quantizeFrame(
  rgba: Uint8Array,
  w: number,
  h: number,
  palette: Map<string, number>,
  palData: Uint8Array,
  framePal: Uint8Array,
): Uint8Array {
  const idx = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    const key = `${r},${g},${b}`;
    let pi = palette.get(key);
    if (pi === undefined) {
      pi = palette.size;
      if (pi >= MAX_COLORS) pi = 0; // 超容量：背景色兜底（粒子色远少于 248）
      palette.set(key, pi);
      palData[pi * 3] = r;
      palData[pi * 3 + 1] = g;
      palData[pi * 3 + 2] = b;
    }
    framePal[pi * 3] = palData[pi * 3];
    framePal[pi * 3 + 1] = palData[pi * 3 + 1];
    framePal[pi * 3 + 2] = palData[pi * 3 + 2];
    idx[i] = pi;
  }
  return idx;
}

function drawFrame(
  ctx: import('@napi-rs/canvas').CanvasRenderingContext2D,
  engine: SimEngine,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const parts = engine.snapshot() as never as Array<{
    x: number; y: number; z: number; r: number; g: number; b: number; a: number;
    name: string; age: number; lifetime: number; vanilla: boolean;
    nbtTint?: boolean; colorFrom?: { r: number; g: number; b: number };
    colorTo?: { r: number; g: number; b: number }; sizeMul?: number;
  }>;
  const f = fit(parts as never, SIM.gridSize, w, h);
  // 网格（y=0 平面）：内部细线 + 外框（与 render2d.drawGrid 同口径）
  const n = SIM.gridSize;
  const lo = Math.floor(-n / 2);
  const hi = Math.floor(n / 2);
  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = lo; i <= hi; i++) {
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
  ctx.strokeStyle = GRID_FRAME;
  ctx.beginPath();
  const c0 = particleProjection(lo, 0, lo, f.scale, f.ox, f.oy);
  const c1 = particleProjection(hi, 0, lo, f.scale, f.ox, f.oy);
  const c2 = particleProjection(hi, 0, hi, f.scale, f.ox, f.oy);
  const c3 = particleProjection(lo, 0, hi, f.scale, f.ox, f.oy);
  for (const c of [c0, c1, c2, c3]) ctx.lineTo(c.sx, c.sy);
  ctx.closePath();
  ctx.stroke();
  // 粒子（lighter 加色圆点；particleVisual = 与实况相同的色值/淡出/半径口径）
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    const v = particleVisual(p as never, 1, SIM.mcVersion, 1, 1);
    if (v.a <= 0.004) continue;
    const pr = particleProjection(p.x, p.y, p.z, f.scale, f.ox, f.oy);
    const radius = Math.max(v.radius * f.scale, 0.5);
    ctx.globalAlpha = Math.min(1, v.a);
    const col = `rgb(${Math.round(v.r * 255)},${Math.round(v.g * 255)},${Math.round(v.b * 255)})`;
    if (radius < 1.5) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(pr.sx, pr.sy, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const g = ctx.createRadialGradient(pr.sx, pr.sy, 0, pr.sx, pr.sy, radius);
      g.addColorStop(0, col.replace('rgb(', 'rgba(').replace(')', ',1)'));
      g.addColorStop(0.2, col.replace('rgb(', 'rgba(').replace(')', ',1)'));
      g.addColorStop(1, col.replace('rgb(', 'rgba(').replace(')', ',0)'));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pr.sx, pr.sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function gifFromTemplate(id: string): Buffer {
  const tpl = TEMPLATES.find((t) => t.id === id);
  if (!tpl) throw new Error('模板不存在: ' + id);
  const engine = new SimEngine(SIM);
  for (const c of tpl.cmds) {
    for (const cmd of parseCommands(c.replace(/^\//, ''))) engine.runCommand(cmd);
  }
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const gif = GIFEncoder();
  const palData = new Uint8Array(MAX_COLORS * 3);
  const framePal = new Uint8Array(MAX_COLORS * 3);
  const palette = new Map<string, number>();
  const { ticks, every } = SHOWS[id] ?? { ticks: 200, every: 4 };
  const total = Math.floor(ticks / every) + 1;
  for (let t = 0; t <= ticks; t += every) {
    for (let i = 0; i < every; i++) engine.tickOnce();
    drawFrame(ctx, engine);
    const px = ctx.getImageData(0, 0, W, H).data;
    const idx = quantizeFrame(px, W, H, palette, palData, framePal);
    // 帧调色板 = 该帧用到的索引位（其余位置为 0,0,0，GIF 解码不引用）
    gif.writeFrame(idx, W, H, { palette: framePal, delay: FRAME_MS, transparent: false });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

const OUT_DIR = join(process.cwd(), 'public', 'wiki-gallery');
mkdirSync(OUT_DIR, { recursive: true });
for (const id of ['ripple', 'ring']) {
  const buf = gifFromTemplate(id);
  const path = join(OUT_DIR, `${id}.gif`);
  writeFileSync(path, buf);
  console.log(`✓ ${id}.gif  ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log('完成');