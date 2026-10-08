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
import { PARTICLE_DATA } from './particleData';
import {
  BASE_SIZE,
  ageFade,
  ageFrame,
  frameSpecFor,
  particleVisual,
  shiftHue,
  textureFor,
  tweakFor,
  visualSpecFor,
  type FrameSpec,
  type RenderParticle,
  type TypeTweak,
} from './color';

// 再导出以兼容既有调用点（测试与 sync.ts 从 points 引入）：颜色/尺寸/帧动画
// 公共计算已移入 color.ts（2D 快速模式共用，不依赖 three）。
export {
  BASE_SIZE,
  ageFade,
  ageFrame,
  frameSpecFor,
  shiftHue,
  textureFor,
  tweakFor,
  visualSpecFor,
  type FrameSpec,
  type RenderParticle,
  type TypeTweak,
};

/** 游戏版本 → 粒子数据（类型全集/帧表）；未知版本 → undefined（上层用默认 '26.2'）。
 *  实现在 particleData.ts（纯数据模块）；此处保留同名再导出以兼容既有调用点 ——
 *  UI 侧请直接从 '../render/particleData' 引入，避免把 three 拉进首屏静态图。 */
export { particleVersionData } from './particleData';

// ---------- 贴图图集 ----------
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

/** 测试钩子：清空图集 Promise 缓存（headless 下旧运行已把缓存固化为 null，
 *  打桩 document/Image 后需清缓存才能重走加载路径）。 */
export function _resetAtlasCache(): void {
  texPromise = null;
}

/** 加载单帧 PNG（headless/加载失败 → null，缺帧跳过与旧串行实现一致）。 */
function loadOneImage(key: string, file: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = `${import.meta.env.BASE_URL}particles/${key}/${file}.png`;
  return new Promise((resolve) => {
    const done = (ok: boolean) => resolve(ok ? img : null);
    img.onload = () => done(true);
    img.onerror = () => done(false);
  });
}

/** 加载帧图集（atlasKey 分区）：去重帧 → 并行 Image 解码 → 按序画入 canvas →
 *  CanvasTexture（Nearest，不生成 mipmap）。onProgress 每画完一帧上报 (drew, total)
 *  （含起始 (0,total)）；调用方按 _atlasEpoch 判废（切版本后旧 key 的迟到进度丢弃）。
 *  headless（无 document/Image）或全部缺帧 → resolve null（着色器走圆点分支），
 *  且 onProgress 不触发。切换 key 时旧 Promise/纹理失效重载。 */
export function loadAtlasTexture(
  key: string,
  onProgress?: (drew: number, total: number) => void,
): Promise<THREE.Texture | null> {
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
        onProgress?.(0, files.length);
        // 并行解码全部帧（串行 await 是首屏最大延迟源）；画布绘制仍按 i 顺序
        // 串行（格布局按 i 定列行，与旧实现逐字一致）。
        const imgs = await Promise.all(files.map((f) => loadOneImage(key, f)));
        let drew = 0;
        for (let i = 0; i < imgs.length; i++) {
          const img = imgs[i];
          if (!img || img.naturalWidth === 0) continue;
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
          // 计数与回调解耦：onProgress?.(++drew, …) 在回调缺省时短路不执行 ++drew
          // → drew 恒 0 → 误判全缺帧（曾致无回调调用方静默拿 null）
          drew++;
          onProgress?.(drew, files.length);
        }
        if (drew === 0) return null;
        const tex = new THREE.CanvasTexture(cv);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        return tex;
      } catch (e) {
        console.error('atlas load failed:', e); // 吞异常前留痕（浏览器控制台可见）
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
  /** 当前图集 key（游戏版本）：dispose 时用于失效同 key 的模块级缓存 */
  _atlasKey: string;
  /** 已 dispose：在途图集 .then 判废（避免给已销毁的 layer 赋未释放纹理） */
  _disposed: boolean;
  /** 图集加载进度上报（drew, total）；SimViewport 注入（按 _atlasEpoch 判废）。
   *  测试可直接注入断言序列。 */
  _onProgress: ((drew: number, total: number) => void) | null;
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
  // 每 tick 全量重写前缀 → DynamicDrawUsage（提示驱动端优先 CPU 侧缓冲策略）
  const attrPos = new THREE.BufferAttribute(pos, 3);
  const attrColor = new THREE.BufferAttribute(color, 4);
  const attrSize = new THREE.BufferAttribute(size, 1);
  const attrUv = new THREE.BufferAttribute(uv, 2);
  attrPos.setUsage(THREE.DynamicDrawUsage);
  attrColor.setUsage(THREE.DynamicDrawUsage);
  attrSize.setUsage(THREE.DynamicDrawUsage);
  attrUv.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attrPos);
  geo.setAttribute('color', attrColor);
  geo.setAttribute('size', attrSize);
  geo.setAttribute('uv', attrUv);
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
    _atlasKey: atlasKey,
    _disposed: false,
    _onProgress: null,
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
      // 模块级图集缓存与纹理同生命周期：该 layer 持有 uAtlas（= 缓存的纹理）
      // 且与缓存同 key 时失效缓存——否则 full→fast→full 切回会命中缓存返回
      // 已 dispose 的纹理（uHasAtlas=1 但 GL 纹理已销毁 → 贴图类型渲染黑/未定义）。
      // 缓存纹理与 layer 纹理是同一对象（applyAtlas 直接引用），layer 释放即
      // 缓存失效；key 不同（缓存属另一 layer/版本）不动。
      if (t && texPromise && texPromise.key === layer._atlasKey) texPromise = null;
      layer._disposed = true;
    },
  };
  // 异步加载图集（headless/加载失败 → null，保持圆点）。
  // 进度回调经 queueMicrotask 投递：构造期 loadAtlasTexture 开头的 onProgress?.(0, N)
  // 会同步执行，此刻调用方（SimViewport）尚未把 _onProgress 赋上（构造器在
  // createPointsLayer 返回后才赋值）→ (0,N) 会丢；microtask 一定在构造器同步体
  // 结束之后才跑，时序上必然能收到。
  // epoch 判废：切换版本（setPointsLayerAtlasKey 自增 _atlasEpoch）后旧 key 的
  // 迟到结果与迟到进度都丢弃（进度回调按启动时 epoch 门控，与 .then 同口径）。
  void loadAtlasTexture(atlasKey, (drew, total) => {
    queueMicrotask(() => {
      if (layer._disposed) return;
      if (layer._atlasEpoch !== 0) return;
      layer._onProgress?.(drew, total);
    });
  }).then((tex) => {
    if (layer._disposed) return; // 已销毁 → 不赋纹理（无人释放它 = 泄漏）
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
  layer._atlasKey = atlasKey;
  const { rows } = atlasMeta(atlasKey);
  layer.uniforms.uCell.value = new THREE.Vector2(1 / ATLAS_COLS, 1 / rows);
  void loadAtlasTexture(atlasKey, (drew, total) => {
    if (layer._disposed) return;
    if (layer._atlasEpoch !== e) return; // 又被切走 → 迟到进度判废
    layer._onProgress?.(drew, total);
  }).then((tex) => {
    if (layer._disposed) return; // 已销毁 → 不赋纹理
    if (layer._atlasEpoch !== e) return; // 又被切走 → 判废
    if (layer.atlasLoaded) return; // 已被更新一轮覆盖
    layer.applyAtlas(tex);
  });
}

// ---------- 快照 → 缓冲 ----------

/** 把快照前缀全量写入缓冲。返回写入数（= setDrawRange 的 count）。
 *  颜色/尺寸口径由 color.ts particleVisual 提供（与 2D 快速模式共用）；
 *  有帧表（多帧）的类型走原版 age-progress 动画：帧号按寿命进度、后半程线性
 *  淡出（见 color.ts 注释）；end_rod 附加颜色向 #F2DEC9 插值。
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
    const vis = particleVisual(p, 1, atlasKey, sizeMul, alphaMul);
    const i4 = i * 4;
    color[i4] = vis.r;
    color[i4 + 1] = vis.g;
    color[i4 + 2] = vis.b;
    color[i4 + 3] = vis.a;
    size[i] = vis.radius;
    // 帧 UV：有帧表的类型取帧格左上角（多帧按寿命进度 ageFrame；单帧恒第 0 帧）；
    // 无帧表 → (0,0)（着色器走圆点分支时忽略；图集未加载时 uHasAtlas=0 同样忽略）
    const frames = visualSpecFor(p, atlasKey).frames;
    if (frames && frames.length > 0) {
      const idx = frames.length > 1 ? ageFrame(p.age, p.lifetime, frames.length) : 0;
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
