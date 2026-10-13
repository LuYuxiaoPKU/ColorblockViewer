// 场景参照物（渲染层道具，纯展示，无 1:1 约束）：史蒂夫 / 命令方块 / 橡树 / 袭击哨塔。
// v2（2026-10-10）：原版贴图 + 原版模型形状 + 原版建筑结构。
//   - 贴图从 1.21.11 client.jar 提取（public/references/1.21.11/，与粒子贴图 public/particles
//     同口径）；加载失败/无纹理环境（headless）→ 纯色降级（与 v1 一致）。
//   - 哨塔 = 原版结构 watchtower.nbt 转 JSON（1:1 方块布局，服务端 jar 提取）；特殊方块
//     （栅栏/台阶/楼梯/墙/火把）几何按原版模型 json 尺寸复刻（16px = 1 格），
//     jigsaw 占位跳过；旗帜/箱子用户拍板移除（模型/贴图问题多，渲染跳过）。
// 位置约定：脚底 y=0、水平居中 (0.5, *, 0.5)（与原点 1 格网格对齐）；'none' → null。

import * as THREE from 'three';

export type ReferenceType = 'none' | 'command_block' | 'oak_tree' | 'outpost_tower';

export const REFERENCE_TYPES: ReferenceType[] = [
  'none',
  'command_block',
  'oak_tree',
  'outpost_tower',
];

export const REFERENCE_LABELS: Record<ReferenceType, string> = {
  none: '无',
  command_block: '命令方块（1 格）',
  oak_tree: '橡树（高 6–7 格）',
  outpost_tower: '袭击哨塔',
};

/** 资源目录（BASE_URL 前缀兼容 GitHub Pages 子路径部署） */
const RES = `${import.meta.env.BASE_URL}references/1.21.11/`;

/** 贴图加载失败/无纹理时的纯色降级（v1 配色） */
const FALLBACK_COLORS: Record<string, number> = {
  command_block: 0xffb000,
  oak: 0x2c6b2f,
  tower: 0x8b8b8b,
};

// ---------- 贴图加载（仿 loadAtlasTexture：Image + Promise 缓存；headless → null）----------

export const TEXTURE_FILES = [
  'command_block_front.png',
  'command_block_back.png',
  'command_block_side.png',
  'oak_log.png',
  'oak_log_top.png',
  'oak_leaves.png',
  'dark_oak_log.png',
  'dark_oak_log_top.png',
  'dark_oak_planks.png',
  'birch_planks.png',
  'cobblestone.png',
  'torch.png',
] as const;

let texPromise: Promise<Record<string, THREE.Texture | null>> | null = null;

/** 测试钩子：清空贴图 Promise 缓存（headless 下打桩 document/Image 后需清缓存重走加载路径） */
export function _resetTextureCache(): void {
  texPromise = null;
}

function loadOne(src: string): Promise<HTMLImageElement | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(null);
  }
  const img = new Image();
  img.src = src;
  return new Promise((resolve) => {
    const done = (ok: boolean) => resolve(ok ? img : null);
    img.onload = () => done(true);
    img.onerror = () => done(false);
  });
}

/** 加载全部参照物贴图（失败项 → null，调用方降级纯色）。Promise 缓存，重复调用复用。 */
export function loadReferenceTextures(): Promise<Record<string, THREE.Texture | null>> {
  if (!texPromise) {
    texPromise = (async () => {
      const out: Record<string, THREE.Texture | null> = {};
      const imgs = await Promise.all(TEXTURE_FILES.map((f) => loadOne(RES + f)));
      for (let i = 0; i < TEXTURE_FILES.length; i++) {
        const img = imgs[i];
        if (!img || img.naturalWidth === 0) {
          out[TEXTURE_FILES[i]] = null;
          continue;
        }
        const tex = new THREE.Texture(img);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        out[TEXTURE_FILES[i]] = tex;
      }
      return out;
    })();
  }
  return texPromise;
}

// ---------- 结构数据（watchtower.nbt 转 JSON）----------

export type TowerPalette = { Name: string; Properties?: Record<string, string> };
export type TowerData = { size: [number, number, number]; palette: TowerPalette[]; blocks: Array<[number, number, number, number]> };

let towerCache: TowerData | null = null;

/** 加载结构 JSON（缓存；失败 → null）。场景接线在数据就绪后再构建哨塔。 */
export async function loadTowerData(): Promise<TowerData | null> {
  if (towerCache) return towerCache;
  try {
    const res = await fetch(`${RES}watchtower.json`);
    if (!res.ok) return null;
    towerCache = (await res.json()) as TowerData;
  } catch {
    towerCache = null;
  }
  return towerCache;
}

/** 测试钩子：清结构缓存 */
export function _resetTowerCache(): void {
  towerCache = null;
}

// ---------- 材质 ----------

type Tex = Record<string, THREE.Texture | null> | null;

const fallbackFor = (key: string): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color: FALLBACK_COLORS[key] ?? 0x777777 });

/** 树叶/火把等透贴图：用 alphaTest 剪切（原版 MC 即 CUTOUT 渲染）——避免半透明混合的
 *  深度排序穿帮（树冠内部互相穿插时暗部透出、观感发灰发白，曾致误认为 pale oak）。 */
function blockMat(tex: Tex, file: string, fallback: string, cutout = false): THREE.MeshLambertMaterial {
  const map = tex && tex[file];
  return map
    ? new THREE.MeshLambertMaterial({ map, ...(cutout ? { alphaTest: 0.5 } : {}) })
    : fallbackFor(fallback);
}

/** 六个同材质面（cutout = alphaTest 贴图剪切） */
function mats6(tex: Tex, file: string, fallback: string, cutout = false): THREE.MeshLambertMaterial[] {
  const m = blockMat(tex, file, fallback, cutout);
  return [m, m, m, m, m, m];
}

function box(mats: THREE.MeshLambertMaterial[], size: [number, number, number], pos: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mats);
  mesh.position.set(...pos);
  return mesh;
}

// ---------- 命令方块：1 格方块，原版贴图（north=front / south=back / 其余 side）----------

/** 命令方块六面：贴图是 16×64 动画贴图（mcmeta 4 帧垂直排列，原版按帧偏移采样）——
 *  这里只取第一帧（纵向 1/4：offset 0.75 + repeat 1×0.25，v=1 在图像顶）。 */
const CMD_ANIM_FRAMES = 4;
function cmdMat(tex: Tex, file: string): THREE.MeshLambertMaterial {
  const map = tex && tex[file];
  if (map) {
    const m = new THREE.MeshLambertMaterial({ map });
    map.repeat.set(1, 1 / CMD_ANIM_FRAMES);
    map.offset.set(0, 1 - 1 / CMD_ANIM_FRAMES);
    m.needsUpdate = true;
    return m;
  }
  return fallbackFor('command_block');
}

function commandBlock(tex: Tex): THREE.Group {
  const g = new THREE.Group();
  g.add(
    box(
      [cmdMat(tex, 'command_block_side.png'), cmdMat(tex, 'command_block_side.png'), cmdMat(tex, 'command_block_side.png'), cmdMat(tex, 'command_block_side.png'), cmdMat(tex, 'command_block_front.png'), cmdMat(tex, 'command_block_back.png')],
      [1, 1, 1],
      [0.5, 0.5, 0.5],
    ),
  );
  return g;
}

// ---------- 橡树：原版方块贴图（橡木原木 + 橡树树叶）+ 原版树形（树干 5 格 + 球冠树冠）----------

/** 原版树叶默认染色（defaultFoliageColor = 0x619961）：jar 内 oak_leaves.png 是
 *  灰度剪影贴图（R=G=B=alpha 形状），游戏按生物群系 tint 染色——Lambert
 *  color × map 即该机制，灰剪影 × 绿 = 原版树叶观感（近似平原色）。 */
const FOLIAGE_TINT = 0x619961;

function leavesMat(tex: Tex): THREE.MeshLambertMaterial {
  const map = tex && tex['oak_leaves.png'];
  return map
    ? new THREE.MeshLambertMaterial({ map, color: FOLIAGE_TINT, alphaTest: 0.5 })
    : fallbackFor('oak');
}

function oakTree(tex: Tex): THREE.Group {
  const g = new THREE.Group();
  // 树干：5 个 1×1×1 方块堆叠（原版逐方块；单个高 5 格 Box 会让侧面贴图
  // 纵向拉伸 5 倍）。侧 = oak_log，顶/底 = oak_log_top
  const logMats = [
    blockMat(tex, 'oak_log.png', 'oak'),
    blockMat(tex, 'oak_log.png', 'oak'),
    blockMat(tex, 'oak_log_top.png', 'oak'),
    blockMat(tex, 'oak_log_top.png', 'oak'),
    blockMat(tex, 'oak_log.png', 'oak'),
    blockMat(tex, 'oak_log.png', 'oak'),
  ];
  for (let y = 0; y < 5; y++) g.add(box(logMats, [1, 1, 1], [0.5, y + 0.5, 0.5]));
  // 树冠：原版橡树生成形状（树干顶 3 层球冠：下两层半径 2、顶层半径 1）
  const leafMats = [leavesMat(tex), leavesMat(tex), leavesMat(tex), leavesMat(tex), leavesMat(tex), leavesMat(tex)];
  const leaves: Array<[number, number, number]> = [];
  for (let y = 5; y <= 7; y++) {
    const r = y === 7 ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (y === 5 && Math.abs(dx) === r && Math.abs(dz) === r) continue; // 下层去四角，球冠收形
        leaves.push([dx, y, dz]);
      }
    }
  }
  for (const [dx, y, dz] of leaves) g.add(box(leafMats, [1, 1, 1], [0.5 + dx, y, 0.5 + dz]));
  return g;
}

// ---------- 袭击哨塔：原版结构逐方块（特殊方块几何按原版模型 json，16px = 1 格）----------

/** 方块名 → 侧/顶贴图文件；特殊方块在各自分支处理 */
function towerTextures(name: string): { side: string; top: string } {
  switch (name) {
    case 'minecraft:dark_oak_log':
      return { side: 'dark_oak_log.png', top: 'dark_oak_log_top.png' };
    case 'minecraft:dark_oak_planks':
    case 'minecraft:dark_oak_slab':
    case 'minecraft:dark_oak_stairs':
    case 'minecraft:dark_oak_fence':
      return { side: 'dark_oak_planks.png', top: 'dark_oak_planks.png' };
    case 'minecraft:birch_planks':
      return { side: 'birch_planks.png', top: 'birch_planks.png' };
    case 'minecraft:cobblestone':
    case 'minecraft:cobblestone_stairs':
    case 'minecraft:cobblestone_slab':
    case 'minecraft:cobblestone_wall':
      return { side: 'cobblestone.png', top: 'cobblestone.png' };
    default:
      return { side: 'cobblestone.png', top: 'cobblestone.png' };
  }
}

/** 整方块（原木按 axis 旋转贴图：x/z 轴 → 顶/底贴图在对应轴向面）；中心 = 格中心 pos+0.5 */
function fullBlock(tex: Tex, name: string, props: Record<string, string>, pos: [number, number, number]): THREE.Mesh {
  const { side, top } = towerTextures(name);
  const axis = props.axis ?? 'y';
  const east = blockMat(tex, axis === 'x' ? top : side, 'tower');
  const west = east;
  const north = blockMat(tex, axis === 'z' ? top : side, 'tower');
  const south = north;
  const up = blockMat(tex, axis === 'y' ? top : side, 'tower');
  const down = up;
  return box([east, west, up, down, south, north], [1, 1, 1], [pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5]);
}

/** 台阶：半格（type=top → 贴格顶 0.5-1.0，否则贴格底 0-0.5）。原版 slab 模型 0-8px / 8-16px。
 *   box 中心语义 → bottom 中心 pos+0.25、top 中心 pos+0.75（曾误用 pos+0 / pos+0.5，
 *   几何 ±0.25 使上下半砖都居中悬在格中部）。 */
function slabBlock(tex: Tex, name: string, props: Record<string, string>, pos: [number, number, number]): THREE.Mesh {
  const { side } = towerTextures(name);
  return box(mats6(tex, side, 'tower'), [1, 0.5, 1], [pos[0] + 0.5, pos[1] + (props.type === 'top' ? 0.75 : 0.25), pos[2] + 0.5]);
}

/** 楼梯：原版模型两段（底 0-8px 全宽 + 后 8-16px 高台），默认 facing=east 高台在东，
 *  组旋转 Y 对齐朝向。half=top = blockstate "x":180 绕中心翻转（uvlock）：底段翻到
 *  格子上半 [0.5,1.0]、高台翻到格子下半 [0,0.5]——即两段 y 中心互换（曾误作
 *  "整体上移半格"致高台顶侵入上方格 → 与圆石柱重叠）。组系原点 = 方块底面。 */
function stairsBlock(tex: Tex, name: string, props: Record<string, string>, pos: [number, number, number]): THREE.Group {
  const { side } = towerTextures(name);
  const g = new THREE.Group();
  const top = props.half === 'top';
  const mats = mats6(tex, side, 'tower');
  g.add(box(mats, [1, 0.5, 1], [0, top ? 0.75 : 0.25, 0]));
  g.add(box(mats, [0.5, 0.5, 1], [0.25, top ? 0.25 : 0.75, 0]));
  // 组旋转 Y 对齐朝向：three.js rotation.y 正方向与 MC 模型 "y" 旋转相反 →
  // south 用 -π/2、north 用 +π/2（曾 south=+π/2/north=-π/2 致南北两向反置）。
  g.rotation.y = ({ east: 0, south: -Math.PI / 2, west: Math.PI, north: Math.PI / 2 } as Record<string, number>)[props.facing ?? 'east'];
  g.position.set(pos[0] + 0.5, pos[1], pos[2] + 0.5);
  return g;
}

/** 栅栏：中心柱（6-10px 见方）+ 上下两根横杆（7-9px 宽，y 12-15 / 6-9）向连接侧伸出。
 *  横杆从柱边（7px=0.4375）延伸到方块边缘（16px=1.0）——相邻 fence 在边界对接
 *  才视觉连续（原版 custom_fence_side_east 实测；曾居中对称伸 0.28125 使杆不到边缘）。 */
function fenceBlock(tex: Tex, name: string, props: Record<string, string>, pos: [number, number, number]): THREE.Group {
  const { side } = towerTextures(name);
  const g = new THREE.Group();
  g.add(box(mats6(tex, side, 'tower'), [0.25, 1, 0.25], [pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5]));
  const bars = (key: 'north' | 'south' | 'east' | 'west', cy: number): void => {
    const axis = key === 'east' || key === 'west' ? 'x' : 'z';
    const edge = key === 'east' || key === 'south' ? 0.71875 : 0.28125; // 0.5 ± 0.21875
    g.add(
      box(
        mats6(tex, side, 'tower'),
        axis === 'x' ? [0.5625, 0.1875, 0.125] : [0.125, 0.1875, 0.5625],
        [pos[0] + (axis === 'x' ? edge : 0.5), pos[1] + cy, pos[2] + (axis === 'z' ? edge : 0.5)],
      ),
    );
  };
  for (const key of ['north', 'south', 'west', 'east'] as const) {
    if (props[key] === 'true') {
      bars(key, 0.84375);
      bars(key, 0.46875);
    }
  }
  return g;
}

/** 石墙：中心柱（4-12px 见方 16px 高）。哨塔内 wall 均 up=true 角柱、无水平连接 →
 *  仅 post（原版 template_wall_post from[4,0,4] to[12,16,12] 1:1 复刻）。
 *  贴图按原版默认 UV（面投影 [4,0,12,16]）裁剪采样——曾 UV 0-1 全贴致 8px 面
 *  压进 16px 纹理，横向压缩 2 倍、圆石图案竖长变形（用户报"贴图纵向拉伸"）。 */
const WALL_UV_SIDE = [4, 0, 12, 16] as const; // 侧面：贴图中间 8 列 × 全高（1:1 无变形）
const WALL_UV_TOP = [4, 4, 12, 12] as const; // 顶/底：贴图中心 8×8

/** 单面裁剪材质：共享 image 的 Texture clone + repeat/offset 裁到分区（v 从图像顶计，
 *  three flipY → 顶在 v=1，offset v=(16-v1)/16）。cutout = alphaTest 贴图剪切（透贴）。 */
function faceRegion(tex: Tex, file: string, region: readonly [number, number, number, number], cutout = false): THREE.MeshLambertMaterial {
  const map = tex && tex[file];
  if (!map) return fallbackFor('tower');
  const t = map.clone();
  t.needsUpdate = true;
  t.repeat.set((region[2] - region[0]) / 16, (region[3] - region[1]) / 16);
  t.offset.set(region[0] / 16, (16 - region[3]) / 16);
  return new THREE.MeshLambertMaterial({ map: t, ...(cutout ? { alphaTest: 0.5 } : {}) });
}

function wallFace(tex: Tex, region: readonly [number, number, number, number]): THREE.MeshLambertMaterial {
  return faceRegion(tex, 'cobblestone.png', region);
}

function wallBlock(tex: Tex, _name: string, _props: Record<string, string>, pos: [number, number, number]): THREE.Group {
  const side = wallFace(tex, WALL_UV_SIDE);
  const top = wallFace(tex, WALL_UV_TOP);
  const g = new THREE.Group();
  g.add(box([side, side, top, top, side, side], [0.5, 1, 0.5], [pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5]));
  return g;
}

/** 火把：2px 柱高 10px（原版 template_torch from[7,0,7] to[9,10,9]），顶面无火焰方块。
 *  贴图按原版 UV 裁剪采样（侧面 [7,6,9,16]、顶 [7,6,9,8]、底 [7,13,9,15]）——曾 UV 0-1
 *  全贴致 2px 柱身图像铺满整面、花脸压扁（用户报"贴图有问题"）。 */
const TORCH_UV_SIDE = [7, 6, 9, 16] as const;
const TORCH_UV_UP = [7, 6, 9, 8] as const;
const TORCH_UV_DOWN = [7, 13, 9, 15] as const;

function torchBlock(tex: Tex, pos: [number, number, number]): THREE.Group {
  const g = new THREE.Group();
  const side = faceRegion(tex, 'torch.png', TORCH_UV_SIDE, true);
  const up = faceRegion(tex, 'torch.png', TORCH_UV_UP, true);
  const down = faceRegion(tex, 'torch.png', TORCH_UV_DOWN, true);
  g.add(box([side, side, up, down, side, side], [0.125, 0.625, 0.125], [pos[0] + 0.5, pos[1] + 0.3125, pos[2] + 0.5]));
  return g;
}

/** 箱子已删除（用户拍板：贴图分区问题修复成本高；2026-10-12）——
 *   buildTower 跳过 minecraft:chest，chestBlock/chestFace/chest.png 一并移除 */

/** 哨塔整体：按结构 JSON 逐方块构建（air/jigsaw 跳过） */
export function buildTower(tex: Tex, data: TowerData): THREE.Group {
  const g = new THREE.Group();
  for (const [x, y, z, state] of data.blocks) {
    const p = data.palette[state];
    if (!p || p.Name === 'minecraft:air' || p.Name === 'minecraft:jigsaw') continue;
    // 用户拍板移除的方块族：旗帜（模型 bug 多）、箱子（贴图分区问题）——结构数据保留，渲染跳过
    if (p.Name === 'minecraft:white_wall_banner' || p.Name === 'minecraft:chest') continue;
    const props = p.Properties ?? {};
    const pos: [number, number, number] = [x, y, z];
    switch (p.Name) {
      case 'minecraft:dark_oak_log':
      case 'minecraft:dark_oak_planks':
      case 'minecraft:birch_planks':
      case 'minecraft:cobblestone':
        g.add(fullBlock(tex, p.Name, props, pos));
        break;
      case 'minecraft:dark_oak_slab':
      case 'minecraft:cobblestone_slab':
        g.add(slabBlock(tex, p.Name, props, pos));
        break;
      case 'minecraft:dark_oak_stairs':
      case 'minecraft:cobblestone_stairs':
        g.add(stairsBlock(tex, p.Name, props, pos));
        break;
      case 'minecraft:dark_oak_fence':
        g.add(fenceBlock(tex, p.Name, props, pos));
        break;
      case 'minecraft:cobblestone_wall':
        g.add(wallBlock(tex, p.Name, props, pos));
        break;
      case 'minecraft:torch':
        g.add(torchBlock(tex, pos));
        break;
      default:
        g.add(fullBlock(tex, p.Name, props, pos));
    }
  }
  return g;
}

// ---------- 入口 ----------

export function buildReference(type: ReferenceType, tex: Tex = null, tower: TowerData | null = null): THREE.Group | null {
  switch (type) {
    case 'command_block':
      return commandBlock(tex);
    case 'oak_tree':
      return oakTree(tex);
    case 'outpost_tower':
      return tower ? buildTower(tex, tower) : new THREE.Group();
    default:
      return null;
  }
}