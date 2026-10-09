// 粒子渲染色/尺寸公共计算（3D 点云 points.ts 与 2D 快速模式 render2d.ts 共用）。
// 纯函数、**无 three 依赖**——快速模式（Canvas 2D，不加载 three）与完整模式
// （WebGL 点云）走同一套色值/尺寸口径。
// 色值口径与 points.ts 原实现逐字一致（类型微调 / 多帧白起点 / colorFrom→colorTo
// 插值 / end_rod 颜色靠拢 / 后半程淡出），测试在 tests/render/points.test.ts
// （3D 侧）与 tests/render/render2d.test.ts（2D 侧）双侧锁定。

import { PARTICLE_DATA } from './particleData';

/** 基础点尺寸（**世界块单位**）：默认粒子 ≈ 0.1 block（MC 小粒子的典型观感）。
 *  像素换算：3D 在顶点着色器里做透视除法（uScale 由 SimViewport 维护），
 *  2D 用统一缩放常数（pxPerBlock）。类型表在此基础上乘倍数。 */
export const BASE_SIZE = 0.1;

/** 粒子名归一化：小写 + 去 `minecraft:` 命名空间前缀。 */
function normName(name: string): string {
  let key = name.toLowerCase();
  const i = key.indexOf(':');
  if (i >= 0) key = key.slice(i + 1);
  return key;
}

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

export function tweakFor(name: string): TypeTweak {
  return TWEAKS[normName(name)] ?? DEFAULT_TWEAK;
}

/** 粒子类型 → 帧贴图文件列表（MC 客户端 data-driven 表；未收录 → null 走圆点）。
 *  version = 游戏版本（atlasKey）；缺省 '26.2'。 */
export function textureFor(name: string, version = '26.2'): string[] | null {
  return PARTICLE_DATA[version]?.frames[normName(name)] ?? null;
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
export function ageFrame(age: number, lifetime: number, n: number): number {
  if (n <= 1 || lifetime <= 0) return 0;
  const idx = Math.floor((age * (n - 1)) / lifetime);
  return idx < n ? idx : n - 1;
}

/** 后 50% 寿命线性淡出（AnimatedParticle.tick 逐字）：前 50% = 1，
 *  之后 1 - (age-lifetime/2)/lifetime，死亡瞬间 = 0.5（非 0）。 */
export function ageFade(age: number, lifetime: number): number {
  if (lifetime <= 0 || age <= lifetime / 2) return 1;
  return 1 - (age - lifetime / 2) / lifetime;
}

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
  /** type{NBT} 已解析出渲染色（dust 的 color）：true 时不强制出生色为白 */
  nbtTint?: boolean;
  /** dust_color_transition 的 from_color（= 出生色；渐变插值起点） */
  colorFrom?: { r: number; g: number; b: number };
  /** dust_color_transition 的 to_color（渐变终点；按 frac = age/(lifetime+1) 插值） */
  colorTo?: { r: number; g: number; b: number };
  /** 点大小倍数（dust 的 scale，默认 1） */
  sizeMul?: number;
}

/** 单粒子渲染 spec 缓存（**粒子对象直挂属性**）：particleVisual 每 tick 每
 * 粒子一次，而 name（类型）与 atlasKey（版本）在播放期间不变 → 类型微调/
 * 帧表/帧动画行为的解析结果可复用。1M 不同对象实测直挂属性 11.5ms vs
 * WeakMap 94ms（~8×：对象属性 = hidden class 槽位直读，无哈希/索引），
 * 故弃 WeakMap。缓存与粒子对象同生命周期（随池回收）；atlasKey 变化
 * （切版本）时按 key 判废重算。`__cbVis` 是私有键：copyParticle/timeline/
 * 分享序列化均为手工逐字段拷贝，不会带上它。 */
interface VisualSpec {
  key: string;
  tweak: TypeTweak;
  frames: string[] | null;
  spec: FrameSpec | null;
}
interface VisualSpecHost {
  __cbVis?: VisualSpec;
}

export function visualSpecFor(p: RenderParticle, atlasKey: string): VisualSpec {
  const host = p as unknown as VisualSpecHost;
  const vs = host.__cbVis;
  if (vs && vs.key === atlasKey) return vs;
  const fresh: VisualSpec = {
    key: atlasKey,
    tweak: tweakFor(p.name),
    frames: textureFor(p.name, atlasKey),
    spec: frameSpecFor(p.name, atlasKey),
  };
  host.__cbVis = fresh;
  return fresh;
}

/** 单粒子渲染色与像素半径（口径与 points.ts syncToPoints 原实现逐字一致）。
 *  pxPerBlock = 视口像素/世界块换算（3D 着色器按 uScale 做透视除法、3D 侧
 *  恒传 1 使 radius 即世界块单位；2D 用统一缩放常数）；
 *  sizeMul/alphaMul = 全局倍数（UI 设置）。 */
export function particleVisual(
  p: RenderParticle,
  pxPerBlock: number,
  atlasKey: string,
  sizeMul = 1,
  alphaMul = 1,
): { r: number; g: number; b: number; a: number; radius: number } {
  const radius = particleVisualWithSpecOut(
    p, pxPerBlock, sizeMul, alphaMul, visualSpecFor(p, atlasKey), SCRATCH_VIS, 0,
  );
  return { r: SCRATCH_VIS[0], g: SCRATCH_VIS[1], b: SCRATCH_VIS[2], a: SCRATCH_VIS[3], radius };
}

/** 与 particleVisual 同口径，但渲染 spec 由调用方传入（vs = visualSpecFor(p, key)）。
 * syncToPoints 热路径循环里 spec 已取一次（frames 选帧也要用），复用可省掉
 * 每粒子的第二次 WeakMap get（1M 满帧实测 ~25ms+）。 */
export function particleVisualWithSpec(
  p: RenderParticle,
  pxPerBlock: number,
  sizeMul: number,
  alphaMul: number,
  vs: VisualSpec,
): { r: number; g: number; b: number; a: number; radius: number } {
  const radius = particleVisualWithSpecOut(p, pxPerBlock, sizeMul, alphaMul, vs, SCRATCH_VIS, 0);
  return { r: SCRATCH_VIS[0], g: SCRATCH_VIS[1], b: SCRATCH_VIS[2], a: SCRATCH_VIS[3], radius };
}

/** 热路径形态（syncToPoints 用）：r/g/b/a 直写 out（4 分量，起点 i4），
 * 返回 radius（number，免每粒子返回对象）。1M end_rod 探针：返回对象形态
 * 41.4ms vs 直写 23.0ms（-44%，含 0.8^age 预计算表）。模块级 scratch 仅供
 * 对象形态入口（particleVisual/particleVisualWithSpec）内部复用——单线程调用、
 * 不嵌套（调用方拿到的对象字段是拷贝值，与 scratch 生命周期无关）。 */
const SCRATCH_VIS = new Float32Array(4);

export function particleVisualWithSpecOut(
  p: RenderParticle,
  pxPerBlock: number,
  sizeMul: number,
  alphaMul: number,
  vs: VisualSpec,
  out: Float32Array,
  i4: number,
): number {
  const tw = vs.tweak;
  const frames = vs.frames;
  const multi = frames !== null && frames.length > 1;
  let r = p.r;
  let g = p.g;
  let b = p.b;
  let alpha = p.a;
  if (multi) {
    // 原版 SimpleAnimatedParticle：初始色 = 出生渲染色（原版粒子恒白；
    // 模组粒子出生时已把命令色写进 renderColor → 起点即命令色）
    // 例外：dust 的 NBT color 直接写入 rCol/gCol/bCol（DustParticle 构造器）
    // → nbtTint 时不强制白（取证：26.2 字节码）
    if (p.vanilla && !p.nbtTint) {
      r = 1;
      g = 1;
      b = 1;
    }
    // dust_color_transition：渲染色随寿命进度 from→to 线性插值
    // （DustColorTransitionParticle.lerpColors 字节码；tick 制预览 delta 取 0）
    if (p.colorFrom && p.colorTo) {
      const frac = p.age / (p.lifetime + 1);
      r = p.colorFrom.r + (p.colorTo.r - p.colorFrom.r) * frac;
      g = p.colorFrom.g + (p.colorTo.g - p.colorFrom.g) * frac;
      b = p.colorFrom.b + (p.colorTo.b - p.colorFrom.b) * frac;
    }
    // end_rod：每 tick 向 targetColor 靠拢 20%（= (0.8)^age 剩余量，闭式解；
    // 1.21.1 反编译 EndRodParticle.setTargetColor(15916745)）。0.8^age 预计算表
    // 查整数 age（age 为 tick 计数恒整；表外回退 pow，0.8^4096 已下溢为 0）
    const spec = vs.spec;
    if (spec?.colorShift) {
      const tr = spec.colorShift[0] / 255;
      const tg = spec.colorShift[1] / 255;
      const tb = spec.colorShift[2] / 255;
      const f =
        p.age >= 0 && (p.age | 0) === p.age && p.age < FADE08.length
          ? FADE08[p.age]
          : Math.pow(0.8, p.age);
      r = tr + (r - tr) * f;
      g = tg + (g - tg) * f;
      b = tb + (b - tb) * f;
    }
    // 后半程线性淡出（死亡瞬间 alpha=0.5）
    alpha *= ageFade(p.age, p.lifetime);
  }
  const hue = tw.hue;
  let hr: number, hg: number, hb: number;
  if (hue === 0) {
    // 多数类型 hue=0：免 shiftHue 调用与 3 元素数组分配（1M 满帧热路径）
    hr = r;
    hg = g;
    hb = b;
  } else {
    const s = shiftHue(r, g, b, hue);
    hr = s[0];
    hg = s[1];
    hb = s[2];
  }
  out[i4] = hr;
  out[i4 + 1] = hg;
  out[i4 + 2] = hb;
  out[i4 + 3] = alpha * tw.alpha * alphaMul;
  return BASE_SIZE * tw.size * sizeMul * (p.sizeMul ?? 1) * pxPerBlock;
}

/** end_rod colorShift 的 0.8^age 预计算表（age = tick 计数，整数域；
 *  上界 4096：0.8^4096 ≈ 1e-395 已低于 double 最小正规数，视觉不可见区 = 0）。 */
const FADE08: number[] = (() => {
  const t: number[] = [];
  for (let i = 0; i < 4096; i++) t.push(Math.pow(0.8, i));
  return t;
})();
