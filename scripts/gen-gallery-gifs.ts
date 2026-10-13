// 示例画廊动图生成器：跑引擎 → 2D 快速模式逐帧渲染 → GIF 编码。
// 产物 docs/wiki/public/wiki-gallery/<templateId>.gif（提交入库，画廊页 <img> 引用）。
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
/** GIF 全局调色板容量（索引 0 = 背景，余 255 位；留 5 空位防 256 溢出） */
const MAX_COLORS = 250;

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
const BG_RGB = [0x0b, 0x0e, 0x14];
const GRID_LINE = '#1c2130';
const GRID_FRAME = '#3a4150';

/** 逐帧推进并渲染到 canvas（与实况 render2d 快速模式同口径） */
function stepAndDraw(
  ctx: import('@napi-rs/canvas').CanvasRenderingContext2D,
  engine: SimEngine,
  every: number,
): void {
  for (let i = 0; i < every; i++) engine.tickOnce();
  drawFrame(ctx, engine);
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

type RGB = [number, number, number];

/** 第一遍：逐帧渲染并收集画布上出现的所有颜色 → 全局调色板（索引 0 = 背景色） */
function collectPalette(
  ctx: import('@napi-rs/canvas').CanvasRenderingContext2D,
  engine: SimEngine,
  ticks: number,
  every: number,
): { table: RGB[]; lut: Map<number, number> } {
  const table: RGB[] = [BG_RGB as RGB]; // 索引 0 = 背景
  const lut = new Map<number, number>();
  lut.set((BG_RGB[0] << 16) | (BG_RGB[1] << 8) | BG_RGB[2], 0);
  for (let t = 0; t <= ticks; t += every) {
    stepAndDraw(ctx, engine, every);
    const d = ctx.getImageData(0, 0, W, H).data;
    for (let p = 0; p < d.length; p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2];
      if (r === BG_RGB[0] && g === BG_RGB[1] && b === BG_RGB[2]) continue;
      if (table.length >= MAX_COLORS) continue;
      const key = (r << 16) | (g << 8) | b;
      if (!lut.has(key)) {
        lut.set(key, table.length);
        table.push([r, g, b]);
      }
    }
  }
  return { table, lut };
}

/** 像素颜色 → 调色板索引；调色板已满时对未收录颜色取最近邻（缓存） */
function idxFor(
  r: number,
  g: number,
  b: number,
  table: RGB[],
  lut: Map<number, number>,
  cache: Map<number, number>,
): number {
  const key = (r << 16) | (g << 8) | b;
  const hit = lut.get(key);
  if (hit !== undefined) return hit;
  let idx = cache.get(key);
  if (idx !== undefined) return idx;
  let best = 1;
  let bd = Infinity;
  for (let i = 1; i < table.length; i++) {
    const [tr, tg, tb] = table[i];
    const dr = tr - r, dg = tg - g, db = tb - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bd) {
      bd = dist;
      best = i;
    }
  }
  cache.set(key, best);
  return best;
}

function gifFromTemplate(id: string): Buffer {
  const tpl = TEMPLATES.find((t) => t.id === id);
  if (!tpl) throw new Error('模板不存在: ' + id);
  const runCmds = (engine: SimEngine): void => {
    for (const c of tpl.cmds) {
      for (const cmd of parseCommands(c.replace(/^\//, ''))) engine.runCommand(cmd);
    }
  };
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const { ticks, every } = SHOWS[id] ?? { ticks: 200, every: 4 };

  // 第一遍：渲染收集全局调色板
  const engineA = new SimEngine(SIM);
  runCmds(engineA);
  const { table, lut } = collectPalette(ctx, engineA, ticks, every);
  console.log(`  ${id}: 全局调色板 ${table.length} 色`);

  // 第二遍：同序渲染，用固定全局调色板编码（首帧写全局表，后续帧不写局部表）
  const engineB = new SimEngine(SIM);
  runCmds(engineB);
  const gif = GIFEncoder();
  const cache = new Map<number, number>();
  let first = true;
  for (let t = 0; t <= ticks; t += every) {
    stepAndDraw(ctx, engineB, every);
    const d = ctx.getImageData(0, 0, W, H).data;
    const idx = new Uint8Array(W * H);
    for (let p = 0, o = 0; p < d.length; p += 4, o++) {
      const r = d[p], g = d[p + 1], b = d[p + 2];
      if (r === BG_RGB[0] && g === BG_RGB[1] && b === BG_RGB[2]) {
        idx[o] = 0;
      } else {
        idx[o] = idxFor(r, g, b, table, lut, cache);
      }
    }
    gif.writeFrame(idx, W, H, {
      palette: first ? (table as never) : undefined,
      delay: FRAME_MS,
      transparent: false,
    });
    first = false;
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

const OUT_DIR = join(process.cwd(), 'docs', 'wiki', 'public', 'wiki-gallery');
mkdirSync(OUT_DIR, { recursive: true });
for (const id of ['ripple', 'ring']) {
  const buf = gifFromTemplate(id);
  const path = join(OUT_DIR, `${id}.gif`);
  writeFileSync(path, buf);
  console.log(`✓ ${id}.gif  ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log('完成');
