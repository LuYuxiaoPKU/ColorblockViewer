// Three.js 点云渲染层（计划 §八）。只读仿真快照，不写仿真状态。
//
//  - 一个 BufferGeometry 预分配 maxParticles 顶点（position 3N / color 4N / size N / uv N）；
//  - 每 tick 全量重写前缀 + setDrawRange(0, aliveCount)（粒子每 tick 都动，
//    增量收益低；N=20000 上传 <1ms）；
//  - 贴图：MC 客户端粒子贴图（scripts/gen-particle-assets.mjs 从官方客户端 jar 提取，
//    按版本分区的帧表见 ./particleData）。多帧类型走**原版 age-progress 选帧**
//    （帧号 = floor(age*(N-1)/lifetime)，随年龄线性推进、全寿命只播一遍；
//    1.21.1 反编译 ParticleEngine.getSpriteForAge 逐字核对，见 docs/技术路线.md §10）：
//    前 50% 寿命不透明，后 50% 线性淡出到 alpha=0.5（死亡瞬间即 0.5 而非 0，
//    SimpleAnimatedParticle.tick 原文）；end_rod 类附加颜色向 #F2DEC9 插值
//    （每 tick 靠拢 20%，EndRodParticle.setTargetColor；起点 = 出生渲染色，
//    模组在出生时已把命令色写进原版 renderColor → 起点即命令色，预览直接
//    对命令色做同一插值 = 逐字一致）。无帧表类型
//    （block/dust/item 等按方块纹理实时渲染的、未知名）→ 回退软发光圆点，
//    按类型微调 size/alpha/色相。
//  - 图集按 atlasKey（游戏版本，如 '1.21.11' / '26.2'）分区加载；切换 key 时旧纹理
//    dispose、缓存失效重载。异步加载（首帧前可能未就绪 → 先圆点后贴图，不阻塞渲染）。
// 本模块可 headless 构造（BufferGeometry/ShaderMaterial 不依赖 WebGL 上下文；
// 无 document 时图集加载 resolve null → 全圆点），sync 逻辑有单测覆盖。

import * as THREE from 'three';
import { PARTICLE_DATA, type ParticleVersionData } from './particleData';

/** 基础点尺寸（**世界块单位**）：默认粒子 ≈ 0.1 block（MC 小粒子的典型观感）。
 *  像素换算在顶点着色器里做透视除法，换算常数 uScale = 视口物理高度·0.5 /
 *  tan(fov/2)，由 SimViewport 在 resize 时维护 —— 视距 10 格时 0.1 block ≈ 9px
 *  （900px 高视口 / fov 50°），缩放相机不改变粒子实际大小。
 *  类型表在此基础上乘倍数。 */
export const BASE_SIZE = 0.1;

/** 类型微调（展示性近似，非模组语义）：size 倍数 / alpha 倍数 / 色相偏移（度）。
 *  未知类型 → 默认（1, 1, 0）。命令里的粒子名（flame/heart/…）原样匹配，
 *  大小写不敏感、可选 `minecraft:` 前缀。 */
export interface TypeTweak {
  size: number;
  alpha: number;
  hue: number;
}

const TWEAKS: Record<string, TypeTweak> = {
  flame: { size: 1.0, alpha: 0.9, hue: 0 },
  smoke: { size: 1.3, alpha: 0.55, hue: 0 },
  crimson_spore: { size: 0.9, alpha: 0.8, hue: 0 },
  dandelion: { size: 0.7, alpha: 0.9, hue: 0 },
  sparkle: { size: 0.6, alpha: 1.0, hue: 0 },
  heart: { size: 1.4, alpha: 1.0, hue: 30 },
  end_rod: { size: 2.2, alpha: 1.0, hue: 0 }, // 原版 glitter 帧 8×8 仅 4–14 个可见像素
  // （首帧全透明），0.05 block 默认尺寸下屏上 ~4px 几乎不可见 → 放大展示
  snowflake: { size: 0.8, alpha: 0.9, hue: 0 },
  portal: { size: 0.9, alpha: 0.7, hue: 0 },
  crit: { size: 0.5, alpha: 1.0, hue: 0 },
};

const DEFAULT_TWEAK: TypeTweak = { size: 1, alpha: 1, hue: 0 };

/** 粒子名归一化：小写 + 去 `minecraft:` 命名空间前缀。 */
function normName(name: string): string {
  let key = name.toLowerCase();
  const i = key.indexOf(':');
  if (i >= 0) key = key.slice(i + 1);
  return key;
}

export function tweakFor(name: string): TypeTweak {
  return TWEAKS[normName(name)] ?? DEFAULT_TWEAK;
}

/** 粒子类型 → 帧贴图文件列表（MC 客户端 data-driven 表；未收录 → null 走圆点）。
 *  version = 游戏版本（atlasKey）；缺省 '26.2'。 */
export function textureFor(name: string, version = '26.2'): string[] | null {
  return PARTICLE_DATA[version]?.frames[normName(name)] ?? null;
}

/** 游戏版本 → 粒子数据（类型全集/帧表）；未知版本 → undefined（上层用默认 '26.2'）。 */
export function particleVersionData(version: string): ParticleVersionData | undefined {
  return PARTICLE_DATA[version];
}

/** 色相旋转（度）。s=0 的灰白色系不受影响。 */
export function shiftHue(r: number, g: number, b: number, deg: number): [number, number, number] {
  if (deg === 0) return [r, g, b];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [r, g, b]; // 灰白
  const s = d / (1 - Math.abs(2 * l - 1));
  let h6 = 0; // 0..6（红=0，顺时针 60°/单位）
  if (max === r) {
    h6 = ((g - b) / d) % 6;
    if (h6 < 0) h6 += 6;
  } else if (max === g) h6 = (b - r) / d + 2;
  else h6 = (r - g) / d + 4;
  let h = (h6 / 6 + deg / 360) % 1; // 归一化色相 0..1
  if (h < 0) h += 1;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  let out: [number, number, number];
  if (h < 1 / 6) out = [c, x, 0];
  else if (h < 2 / 6) out = [x, c, 0];
  else if (h < 3 / 6) out = [0, c, x];
  else if (h < 4 / 6) out = [0, x, c];
  else if (h < 5 / 6) out = [x, 0, c];
  else out = [c, 0, x];
  return [out[0] + m, out[1] + m, out[2] + m];
}

// ---------- 贴图图集 ----------

// ---------- 原版帧动画行为（age-progress，见文件头） ----------

/** 类型 → 帧动画附加行为（按版本分区）。帧列表由 PARTICLE_DATA 帧表提供
 *  （textureFor）；**寿命进度选帧 + 后 50% 线性淡出对所有多帧类型（N>1）通用**
 *  （1.21.1 反编译 AnimatedParticle.tick 逐字核对，非 end_rod 专属），无需在此
 *  逐类型声明。这里只记录 end_rod 专属的颜色插值目标。证据边界：当前仅 end_rod
 *  有 1.21.1 反编译的完整行为参数，其他多帧类型走通用选帧+淡出、不做颜色插值。 */
export interface FrameSpec {
  /** 颜色向 targetColor 每 tick 靠拢 20%：end_rod → 0xF2DEC9（rgb 242,222,201，
   *  0–255 整数值；使用时除以 255 归一到 0..1 与渲染色同尺度）。
   *  未列出类型不插值。 */
  colorShift?: [number, number, number];
}

export const FRAME_SPECS: Record<string, Record<string, FrameSpec>> = {
  '1.21.11': { end_rod: { colorShift: [242, 222, 201] } },
  '26.2': { end_rod: { colorShift: [242, 222, 201] } },
};

export function frameSpecFor(name: string, version = '26.2'): FrameSpec | null {
  return FRAME_SPECS[version]?.[normName(name)] ?? null;
}

/** 寿命进度选帧（AnimatedParticle.setSpriteForAge 逐字）：
 *  frame = floor(age*(N-1)/lifetime)，全寿命只播一遍不循环。
 *  活粒子 age ≤ lifetime-1 → 最大索引 = floor((lifetime-1)(N-1)/lifetime) ≤ N-2，
 *  故末帧（index N-1，end_rod 的 glitter_0）实际不可见 —— 与原版一致。 */
function ageFrame(age: number, lifetime: number, n: number): number {
  if (n <= 1 || lifetime <= 0) return 0;
  const idx = Math.floor((age * (n - 1)) / lifetime);
  return idx < n ? idx : n - 1;
}

/** 后 50% 寿命线性淡出（AnimatedParticle.tick 逐字）：前 50% = 1，
 *  之后 1 - (age-lifetime/2)/lifetime，死亡瞬间 = 0.5（非 0）。 */
function ageFade(age: number, lifetime: number): number {
  if (lifetime <= 0 || age <= lifetime / 2) return 1;
  return 1 - (age - lifetime / 2) / lifetime;
}
/** 图集格尺寸（px）。粒子贴图多为 8/16px，个别 32px 的按原尺寸居中贴入（>TILE 的裁切）。 */
const TILE = 32;
const ATLAS_COLS = 12;

interface AtlasMeta {
  /** 帧文件 → 图集列索引（行 = floor(列/COLS)） */
  frameX: Map<string, number>;
  rows: number;
}

let metaCache: { key: string; meta: AtlasMeta } | null = null;

/** 图集布局（同步可知，不依赖图片加载）：帧文件去重后按出现顺序编号。
 *  按 atlasKey（游戏版本）分区；key 变化时重建。 */
function atlasMeta(key: string): AtlasMeta {
  if (metaCache && metaCache.key === key) return metaCache.meta;
  const frameX = new Map<string, number>();
  const frames = PARTICLE_DATA[key]?.frames;
  if (frames) {
    for (const fs of Object.values(frames)) {
      for (const f of fs) if (!frameX.has(f)) frameX.set(f, frameX.size);
    }
  }
  metaCache = { key, meta: { frameX, rows: Math.max(1, Math.ceil(frameX.size / ATLAS_COLS)) } };
  return metaCache.meta;
}

let texPromise: { key: string; p: Promise<THREE.Texture | null> } | null = null;

/** 加载帧图集（atlasKey 分区）：去重帧 → Image 解码 → CanvasTexture（Nearest，不生成 mipmap）。
 *  headless（无 document/Image）或加载失败 → resolve null（着色器走圆点分支）。
 *  切换 key 时旧 Promise/纹理失效重载。 */
function loadAtlasTexture(key: string): Promise<THREE.Texture | null> {
  if (!texPromise || texPromise.key !== key) {
    const p = (async () => {
      try {
        if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
        const { frameX, rows } = atlasMeta(key);
        const files: string[] = [...frameX.keys()];
        const cv = document.createElement('canvas');
        cv.width = ATLAS_COLS * TILE;
        cv.height = rows * TILE;
        const ctx = cv.getContext('2d');
        if (!ctx) return null;
        let drew = 0;
        for (let i = 0; i < files.length; i++) {
          const img = new Image();
          img.src = `${import.meta.env.BASE_URL}particles/${key}/${files[i]}.png`;
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve(); // 缺帧跳过（映射已校验过，正常不触发）
          });
          if (!img.complete || img.naturalWidth === 0) continue;
          // 居中贴入格子；>TILE 的大图按缩放贴入（保持方形观感）
          const scale = Math.min(1, TILE / img.naturalWidth, TILE / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            img,
            (i % ATLAS_COLS) * TILE + (TILE - w) / 2,
            Math.floor(i / ATLAS_COLS) * TILE + (TILE - h) / 2,
            w,
            h,
          );
          drew++;
        }
        if (drew === 0) return null;
        const tex = new THREE.CanvasTexture(cv);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        return tex;
      } catch {
        return null;
      }
    })();
    texPromise = { key, p };
  }
  return texPromise.p;
}

/** 帧 → 图集 UV 左上角（u = 列左缘；v = 行顶缘，flipY 下文 1 在图顶）。 */
function frameUV(frame: string, key: string): [number, number] {
  const { frameX, rows } = atlasMeta(key);
  const col = frameX.get(frame) ?? 0;
  const row = Math.floor(col / ATLAS_COLS);
  return [(col % ATLAS_COLS) / ATLAS_COLS, 1 - row / rows];
}

// ---------- 几何与材质 ----------

const VERTEX = /* glsl */ `
attribute vec4 color;
attribute float size;
// 注意：position / normal / uv 由 Three.js ShaderMaterial 前缀自动声明
// （WebGL2 下为 in）；不要在此重复声明 uv，否则 redefinition 编译失败、
// 顶点着色器不通过、粒子整层不渲染（线上曾因此黑屏）。
uniform float uSizeMul;
uniform float uScale;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vColor = color;
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // size 是世界块单位；透视换算：像素 = 块 * 视口高·0.5 / tan(fov/2) / 视距
  gl_PointSize = size * uSizeMul * (uScale / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uAlphaMul;
uniform float uHasAtlas;
uniform sampler2D uAtlas;
uniform vec2 uCell; // 图集单格 UV 尺寸 (1/列数, 1/行数)
varying vec4 vColor;
varying vec2 vUv; // 帧格左上角 UV（行 0 在纹理顶部）
void main() {
  vec4 c;
  float a;
  if (uHasAtlas > 0.5) {
    // 贴图帧：白色乘法着色（vColor 携带命令颜色/alpha），贴图 alpha 相乘。
    // gl_PointCoord (0,0) 在点左上 → u 向右加、v 向下减
    vec2 p = vec2(
      vUv.x + gl_PointCoord.x * uCell.x,
      vUv.y - gl_PointCoord.y * uCell.y
    );
    vec4 tex = texture2D(uAtlas, p);
    c = vec4(tex.rgb * vColor.rgb, tex.a * vColor.a);
    a = c.a * uAlphaMul;
  } else {
    // 软发光圆点（无贴图类型回退）
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    a = smoothstep(1.0, 0.2, d) * vColor.a * uAlphaMul;
    c = vColor;
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(c.rgb, a);
}
`;

export interface PointsLayer {
  points: THREE.Points;
  pos: Float32Array;
  color: Float32Array;
  size: Float32Array;
  /** 帧图集 UV（每顶点 2 分量；无图集/无帧表类型全 0） */
  uv: Float32Array;
  /** 全局缩放 uniform（UI 设置用）+ uScale 透视换算常数（SimViewport resize 维护）
   *  + uHasAtlas/uAtlas 图集（异步加载完成后由 applyAtlas 置位） */
  uniforms: {
    uSizeMul: { value: number };
    uAlphaMul: { value: number };
    uScale: { value: number };
    uHasAtlas: { value: number };
    uAtlas: { value: THREE.Texture | null };
    uCell: { value: THREE.Vector2 };
  };
  /** 图集加载完成回调（SimViewport 在 update 时检查并重发 needsUpdate） */
  atlasLoaded: boolean;
  /** 图集 epoch：setPointsLayerAtlasKey 自增 → 在途旧 key 加载的迟到结果判废 */
  _atlasEpoch: number;
  /** 图集加载完成后调用（置 uAtlas/uHasAtlas；atlasLoaded 门禁保证同 key 只应用一次）。
   *  正常路径由内部 .then 带 epoch 判废后调用；测试可直接注入。 */
  applyAtlas(tex: THREE.Texture | null): void;
  dispose(): void;
}

/** 预分配 max 顶点的点云层。atlasKey（游戏版本）决定加载哪套图集；
 *  图集异步加载，加载完成后由 applyAtlas 置位。 */
export function createPointsLayer(max: number, atlasKey = '26.2'): PointsLayer {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const color = new Float32Array(max * 4);
  const size = new Float32Array(max);
  const uv = new Float32Array(max * 2);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 4));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // 无界包围球：粒子可能飞到很远，避免被视锥剔除
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

  const { rows } = atlasMeta(atlasKey);
  const uniforms: PointsLayer['uniforms'] = {
    uSizeMul: { value: 1 },
    uAlphaMul: { value: 1 },
    // 初始值按 900px 视口 / fov 50° 估；SimViewport.resize 会按实际视口覆写
    uScale: { value: 100 },
    uHasAtlas: { value: 0 },
    uAtlas: { value: null },
    uCell: { value: new THREE.Vector2(1 / ATLAS_COLS, 1 / rows) },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const layer: PointsLayer = {
    points,
    pos,
    color,
    size,
    uv,
    uniforms,
    atlasLoaded: false,
    _atlasEpoch: 0,
    applyAtlas(tex: THREE.Texture | null) {
      if (layer.atlasLoaded) return; // 同 key 只应用一次；切 key 走 SimViewport.setAtlasKey
      if (!tex) return; // 加载失败 → 保持圆点回退
      uniforms.uAtlas.value = tex;
      uniforms.uHasAtlas.value = 1;
      tex.needsUpdate = true;
      layer.atlasLoaded = true;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      const t = uniforms.uAtlas.value;
      if (t) t.dispose();
    },
  };
  // 异步加载图集（headless/加载失败 → null，保持圆点）。
  // epoch 判废：切换版本（setPointsLayerAtlasKey 自增 _atlasEpoch）后旧 key 的迟到结果丢弃。
  void loadAtlasTexture(atlasKey).then((tex) => {
    if (layer._atlasEpoch !== 0) return;
    layer.applyAtlas(tex);
  });
  return layer;
}

/** 切换图集（游戏版本）：旧纹理 dispose、atlasLoaded 复位、重载新 key 图集。
 *  加载完成前 uHasAtlas=0 → 圆点回退，加载完成后由 applyAtlas 重新置位。
 *  epoch 自增使任何在途旧加载的迟到结果判废。 */
export function setPointsLayerAtlasKey(layer: PointsLayer, atlasKey: string): void {
  const e = ++layer._atlasEpoch;
  const old = layer.uniforms.uAtlas.value;
  if (old) old.dispose();
  layer.uniforms.uAtlas.value = null;
  layer.uniforms.uHasAtlas.value = 0;
  layer.atlasLoaded = false;
  const { rows } = atlasMeta(atlasKey);
  layer.uniforms.uCell.value = new THREE.Vector2(1 / ATLAS_COLS, 1 / rows);
  void loadAtlasTexture(atlasKey).then((tex) => {
    if (layer._atlasEpoch !== e) return; // 又被切走 → 判废
    if (layer.atlasLoaded) return; // 已被更新一轮覆盖
    layer.applyAtlas(tex);
  });
}

// ---------- 快照 → 缓冲 ----------

/** 渲染层读的最小粒子视图（SimParticle 结构子集，解耦 render ↔ sim）。 */
export interface RenderParticle {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  a: number;
  name: string;
  /** 已存活 tick（age-progress 选帧/淡出用；原版按年龄推进而非全局相位） */
  age: number;
  /** 寿命（tick；age=-1 → intMax，淡出/选帧按它算） */
  lifetime: number;
  /** 是否由原版 /particle 命令生成（原版粒子出生色恒为白） */
  vanilla: boolean;
}

/** 把快照前缀全量写入缓冲。返回写入数（= setDrawRange 的 count）。
 *  颜色经类型色相微调、alpha 乘类型系数后写入；size = BASE_SIZE * 类型倍数。
 *  有帧表（多帧）的类型走原版 age-progress 动画：帧号按寿命进度、后半程线性
 *  淡出（见 ageFrame/ageFade 注释）；end_rod 附加颜色向 #F2DEC9 插值。
 *  uv 始终写入（图集加载前也正确就位，加载完成首帧即有贴图）。 */
export function syncToPoints(
  layer: Pick<PointsLayer, 'pos' | 'color' | 'size' | 'uv'>,
  parts: RenderParticle[],
  sizeMul = 1,
  alphaMul = 1,
  atlasKey = '26.2',
): number {
  const max = layer.pos.length / 3;
  const n = Math.min(parts.length, max);
  const { pos, color, size, uv } = layer;
  for (let i = 0; i < n; i++) {
    const p = parts[i];
    const i3 = i * 3;
    pos[i3] = p.x;
    pos[i3 + 1] = p.y;
    pos[i3 + 2] = p.z;
    const tw = tweakFor(p.name);
    const frames = textureFor(p.name, atlasKey);
    const multi = frames !== null && frames.length > 1;
    let r = p.r;
    let g = p.g;
    let b = p.b;
    let alpha = p.a;
    if (multi) {
      // 原版 SimpleAnimatedParticle：初始色 = 出生渲染色（原版粒子恒白；
      // 模组粒子出生时已把命令色写进 renderColor → 起点即命令色）
      if (p.vanilla) {
        r = 1;
        g = 1;
        b = 1;
      }
      // end_rod：每 tick 向 targetColor 靠拢 20%（= (0.8)^age 剩余量，逐 tick
      // 递推的闭式解；1.21.1 反编译 EndRodParticle.setTargetColor(15916745)）
      const spec = frameSpecFor(p.name, atlasKey);
      if (spec?.colorShift) {
        // colorShift 以 0–255 整数存储（对照 16 进制色值直观）→ 归一到 0..1
        const tr = spec.colorShift[0] / 255;
        const tg = spec.colorShift[1] / 255;
        const tb = spec.colorShift[2] / 255;
        const f = Math.pow(0.8, p.age);
        r = tr + (r - tr) * f;
        g = tg + (g - tg) * f;
        b = tb + (b - tb) * f;
      }
      // 后半程线性淡出（死亡瞬间 alpha=0.5）
      alpha *= ageFade(p.age, p.lifetime);
    }
    const [hr, hg, hb] = shiftHue(r, g, b, tw.hue);
    const i4 = i * 4;
    color[i4] = hr;
    color[i4 + 1] = hg;
    color[i4 + 2] = hb;
    color[i4 + 3] = alpha * tw.alpha * alphaMul;
    size[i] = BASE_SIZE * tw.size * sizeMul;
    // 帧 UV：有帧表的类型取帧格左上角（多帧按寿命进度 ageFrame；单帧恒第 0 帧）；
    // 无帧表 → (0,0)（着色器走圆点分支时忽略；图集未加载时 uHasAtlas=0 同样忽略）
    if (frames && frames.length > 0) {
      const idx = multi ? ageFrame(p.age, p.lifetime, frames.length) : 0;
      const [u, v] = frameUV(frames[idx], atlasKey);
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
    } else {
      uv[i * 2] = 0;
      uv[i * 2 + 1] = 0;
    }
  }
  return n;
}
