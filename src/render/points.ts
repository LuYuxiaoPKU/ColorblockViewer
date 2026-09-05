// Three.js 点云渲染层（计划 §八）。只读仿真快照，不写仿真状态。
//
//  - 一个 BufferGeometry 预分配 maxParticles 顶点（position 3N / color 4N / size N）；
//  - 每 tick 全量重写前缀 + setDrawRange(0, aliveCount)（粒子每 tick 都动，
//    增量收益低；N=20000 上传 <1ms）；
//  - 软发光圆点 ShaderMaterial（AdditiveBlending、depthWrite:false）；
//  - 粒子类型统一渲染为软圆点，**只按类型微调 size/alpha/色相**（不还原 MC 贴图）。
// 本模块可 headless 构造（BufferGeometry/ShaderMaterial 不依赖 WebGL 上下文），
// sync 逻辑有单测覆盖。

import * as THREE from 'three';

/** 基础点尺寸：视距 30 格时 ≈ 30px（~0.1 block，与 MC 小粒子观感一致）。
 *  gl_PointSize = size * uSizeMul * (300 / -mvPosition.z)，即 size≈0.1*300*30/...
 *  换算见计划 §八；类型表在此基础上乘倍数。 */
export const BASE_SIZE = 30;

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
  end_rod: { size: 0.5, alpha: 1.0, hue: 0 },
  snowflake: { size: 0.8, alpha: 0.9, hue: 0 },
  portal: { size: 0.9, alpha: 0.7, hue: 0 },
  crit: { size: 0.5, alpha: 1.0, hue: 0 },
};

const DEFAULT_TWEAK: TypeTweak = { size: 1, alpha: 1, hue: 0 };

export function tweakFor(name: string): TypeTweak {
  let key = name.toLowerCase();
  const i = key.indexOf(':');
  if (i >= 0) key = key.slice(i + 1);
  return TWEAKS[key] ?? DEFAULT_TWEAK;
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

// ---------- 几何与材质 ----------

const VERTEX = /* glsl */ `
attribute vec4 color;
attribute float size;
uniform float uSizeMul;
varying vec4 vColor;
void main() {
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uSizeMul * (300.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uAlphaMul;
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float alpha = smoothstep(1.0, 0.2, d) * vColor.a * uAlphaMul;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, alpha);
}
`;

export interface PointsLayer {
  points: THREE.Points;
  pos: Float32Array;
  color: Float32Array;
  size: Float32Array;
  /** 全局缩放 uniform（UI 设置用） */
  uniforms: { uSizeMul: { value: number }; uAlphaMul: { value: number } };
  dispose(): void;
}

/** 预分配 max 顶点的点云层。 */
export function createPointsLayer(max: number): PointsLayer {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const color = new Float32Array(max * 4);
  const size = new Float32Array(max);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 4));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  // 无界包围球：粒子可能飞到很远，避免被视锥剔除
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

  const uniforms = {
    uSizeMul: { value: 1 },
    uAlphaMul: { value: 1 },
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
  return {
    points,
    pos,
    color,
    size,
    uniforms,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
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
}

/** 把快照前缀全量写入缓冲。返回写入数（= setDrawRange 的 count）。
 *  颜色经类型色相微调、alpha 乘类型系数后写入；size = BASE_SIZE * 类型倍数。 */
export function syncToPoints(
  layer: Pick<PointsLayer, 'pos' | 'color' | 'size'>,
  parts: RenderParticle[],
  sizeMul = 1,
  alphaMul = 1,
): number {
  const max = layer.pos.length / 3;
  const n = Math.min(parts.length, max);
  const { pos, color, size } = layer;
  for (let i = 0; i < n; i++) {
    const p = parts[i];
    const i3 = i * 3;
    pos[i3] = p.x;
    pos[i3 + 1] = p.y;
    pos[i3 + 2] = p.z;
    const tw = tweakFor(p.name);
    const [r, g, b] = shiftHue(p.r, p.g, p.b, tw.hue);
    const i4 = i * 4;
    color[i4] = r;
    color[i4 + 1] = g;
    color[i4 + 2] = b;
    color[i4 + 3] = p.a * tw.alpha * alphaMul;
    size[i] = BASE_SIZE * tw.size * sizeMul;
  }
  return n;
}
