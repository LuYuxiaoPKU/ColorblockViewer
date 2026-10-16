// 运行时导出（调研 A+C，见 CC《运行时导出功能调研.md》）：
//  - capturePng：当前画布单帧截图（WebGL 完整模式需 preserveDrawingBuffer，
//    render2d 快速模式 2D canvas 天然可读）——toBlob 下载。
//  - encodeGif：Timeline 帧序列 → 离屏 2D canvas 逐帧重放 → gifenc 编码。
//    快速模式口径（2D 等距投影，与实况同一份色值逻辑）；完整模式的 3D
//    动图不做（GPU 读回 + 256 色压色带，调研 D 路线否决——3D 动图需求由
//    WebM 录制承接，本模块不含）。
//
// headless 约束：document/Image 缺失时 capturePng 返回 null（上层不弹下载）；
// encodeGif 纯数值编码可测（gallery 工具同链在 node 跑通）。

/** 画布 → PNG Blob 下载。返回是否成功（headless/画布缺失 → false）。 */
export function capturePng(canvas: HTMLCanvasElement | null, filename: string): boolean {
  if (!canvas || typeof document === 'undefined') return false;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
  return true;
}

/** 时间戳文件名：colorblockviewer-<tick>-<时分秒>.png（重名覆盖避免，顺序可辨） */
export function captureFilename(tick: number): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `colorblockviewer-tick${tick}-${hh}${mm}${ss}.png`;
}

// ---------- GIF 编码（C 路线） ----------

import { GIFEncoder } from 'gifenc';
import { fit, particleProjection } from './render2d';
import { particleVisual } from './color';
import type { SimParticle } from '../sim/types';

export interface GifFrame {
  particles: SimParticle[];
  /** 该帧的 tick（仅文件名/进度展示用） */
  tick: number;
  /** 帧间隔 ms（播放 20 TPS → 50ms；timeline 降频帧为 50×k） */
  delayMs: number;
}

export interface GifOptions {
  width: number;
  height: number;
  gridSize: number;
  gridVisible?: boolean;
  atlasKey?: string;
  /** 编码进度回调（帧序号/总帧数；分片编码时 UI 可显示进度） */
  onProgress?: (done: number, total: number) => void;
}

const GIF_BG: [number, number, number] = [0x0b, 0x0e, 0x14];

/** 单帧绘制到 2D ctx（口径与 Render2DViewport.draw 逐字一致：同背景/网格/
 *  lighter 加色/软光晕——复用 fit + particleProjection + particleVisual）。 */
export function drawGifFrame(
  ctx: CanvasRenderingContext2D,
  parts: SimParticle[],
  o: GifOptions,
): void {
  const w = o.width;
  const h = o.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, w, h);
  const f = fit(parts, o.gridSize, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const key = o.atlasKey ?? '26.2';
  for (const p of parts) {
    const v = particleVisual(p, f.scale, key, 1, 1);
    if (v.a <= 0.004) continue;
    const pr = particleProjection(p.x, p.y, p.z, f.scale, f.ox, f.oy);
    const radius = Math.max(v.radius * f.scale, 0.5);
    ctx.globalAlpha = Math.min(1, v.a);
    if (radius < 1.5) {
      ctx.fillStyle = `rgb(${Math.round(v.r * 255)},${Math.round(v.g * 255)},${Math.round(v.b * 255)})`;
      ctx.beginPath();
      ctx.arc(pr.sx, pr.sy, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
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
  ctx.globalCompositeOperation = 'source-over';
}


/** 帧序列 → GIF Buffer（两遍法：第一遍收全局调色板，第二遍编码）。
 *  document 缺失（headless）时用 OffscreenCanvas 不可用 → 由调用方保证有
 *  2D ctx；本函数只做纯编码可测部分时接收 draw 回调注入。 */
export function encodeGif(
  frames: GifFrame[],
  draw: (ctx: CanvasRenderingContext2D, parts: SimParticle[], o: GifOptions) => void,
  o: GifOptions,
): Uint8Array {
  const gif = GIFEncoder();
  // 第一遍：全部帧画到离屏 canvas，收集像素 → 全局调色板（256 色）
  const palette = collectPalette(frames, draw, o);
  const cache = new Map<number, number>();
  let first = true;
  frames.forEach((fr, i) => {
    o.onProgress?.(i, frames.length);
    const idx = frameIndices(fr.particles, draw, o, palette, cache);
    gif.writeFrame(idx, o.width, o.height, {
      palette: first ? (palette as never) : undefined,
      delay: Math.max(20, Math.round(fr.delayMs)),
      transparent: false,
    });
    first = false;
  });
  gif.finish();
  return gif.bytes();
}

function collectPalette(
  frames: GifFrame[],
  draw: (ctx: CanvasRenderingContext2D, parts: SimParticle[], o: GifOptions) => void,
  o: GifOptions,
): number[][] {
  // 调色板采样：全帧逐像素统计太重（gallery 工具是全帧）——运行时取抽样帧
  // （均匀取 ≤16 帧）统计非背景像素，按频率排序取 255 色 + 背景色固定为 0
  const counts = new Map<number, number>();
  const step = Math.max(1, Math.ceil(frames.length / 16));
  for (let i = 0; i < frames.length; i += step) {
    const px = renderPixels(frames[i].particles, draw, o);
    for (let p = 0; p < px.length; p += 4) {
      const r = px[p], g = px[p + 1], b = px[p + 2];
      if (r === GIF_BG[0] && g === GIF_BG[1] && b === GIF_BG[2]) continue;
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 255);
  const table: number[][] = [GIF_BG, ...sorted.map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255])];
  return table;
}

function renderPixels(
  parts: SimParticle[],
  draw: (ctx: CanvasRenderingContext2D, parts: SimParticle[], o: GifOptions) => void,
  o: GifOptions,
): Uint8ClampedArray {
  const cv = document.createElement('canvas');
  cv.width = o.width;
  cv.height = o.height;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('离屏 2D canvas 不可用');
  draw(ctx, parts, o);
  return ctx.getImageData(0, 0, o.width, o.height).data;
}

function frameIndices(
  parts: SimParticle[],
  draw: (ctx: CanvasRenderingContext2D, parts: SimParticle[], o: GifOptions) => void,
  o: GifOptions,
  palette: number[][],
  cache: Map<number, number>,
): Uint8Array {
  const d = renderPixels(parts, draw, o);
  const idx = new Uint8Array(o.width * o.height);
  for (let p = 0, q = 0; p < d.length; p += 4, q++) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    if (r === GIF_BG[0] && g === GIF_BG[1] && b === GIF_BG[2]) {
      idx[q] = 0;
    } else {
      const key = (r << 16) | (g << 8) | b;
      let pi = cache.get(key);
      if (pi === undefined) {
        // 最近色查找（缓存 miss 才线性扫 256 项）
        pi = 0;
        let best = Infinity;
        for (let i = 1; i < palette.length; i++) {
          const c = palette[i];
          const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
          const dist = dr * dr + dg * dg + db * db;
          if (dist < best) { best = dist; pi = i; }
        }
        cache.set(key, pi);
      }
      idx[q] = pi;
    }
  }
  return idx;
}
