// 场景参照物（渲染层道具，纯展示，无 1:1 约束）：史蒂夫 / 命令方块 / 橡树 / 袭击哨塔。
// v2（2026-10-10）：原版贴图 + 原版模型形状 + 原版建筑结构。
//   - 贴图从 1.21.11 client.jar 提取（public/references/1.21.11/，与粒子贴图 public/particles
//     同口径）；加载失败/无纹理环境（headless）→ 纯色降级（与 v1 一致）。
//   - 哨塔 = 原版结构 watchtower.nbt 转 JSON（1:1 方块布局，服务端 jar 提取）；特殊方块
//     （栅栏/台阶/楼梯/墙/火把/旗帜/箱子）几何按原版模型 json 尺寸复刻（16px = 1 格），
//     jigsaw 占位跳过。
// 位置约定：脚底 y=0、水平居中 (0.5, *, 0.5)（与原点 1 格网格对齐）；'none' → null。

import * as THREE from 'three';

export type ReferenceType = 'none' | 'steve' | 'command_block' | 'oak_tree' | 'outpost_tower';

export const REFERENCE_TYPES: ReferenceType[] = [
  'none',
  'steve',
  'command_block',
  'oak_tree',
  'outpost_tower',
];

export const REFERENCE_LABELS: Record<ReferenceType, string> = {
  none: '无',
  steve: '史蒂夫（玩家，1.8m）',
  command_block: '命令方块（1 格）',
  oak_tree: '橡树（高 6–7 格）',
  outpost_tower: '袭击哨塔（掠夺者前哨站）',
};

/** 资源目录（BASE_URL 前缀兼容 GitHub Pages 子路径部署） */
const RES = `${import.meta.env.BASE_URL}references/1.21.11/`;

/** 贴图加载失败/无纹理时的纯色降级（v1 配色） */
const FALLBACK_COLORS: Record<string, number> = {
  steve: 0xc69c6d, // 肤色（无贴图时整体单色，取肤色）
  command_block: 0xffb000,
  oak: 0x2c6b2f,
  tower: 0x8b8b8b,
};

// ---------- 贴图加载（仿 loadAtlasTexture：Image + Promise 缓存；headless → null）----------

export const TEXTURE_FILES = [
  'steve.png',
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
  'banner_base.png',
  'chest.png',
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

// ---------- 史蒂夫：原版玩家 box 布局 + 原版皮肤贴图 ----------
// Box 尺寸（格）：头 8×8×8px=0.5；身 8×12×4；臂/腿 4×12×4（0.25×0.75×0.25）。身高 1.8 格。
// 皮肤 UV 布局 = 标准 wide 64×64 分区（像素坐标，v=1 在上，直接除以 64；面序见 mats6Map 注释：
// east/west/top/bottom/south/north）。

/** 各部件贴图分区（px）：head/body/arm/leg，每部件 6 面 = east, west, top, bottom, south, north。
 *  左右侧部件贴图对称 → 左件与右件仅 east/west 互换（原版皮肤即镜像分区）。 */
const SKIN_HEAD: Array<[number, number, number, number]> = [
  [0, 8, 8, 16], [16, 8, 24, 16], [8, 0, 16, 8], [16, 0, 24, 8], [8, 8, 16, 16], [24, 8, 32, 16],
];
/** 躯干皮肤分区（导出供测试断言防拉伸回归：面序 east/west 为 深×高 = 4×12px
 *  侧区，south/north 为 宽×高 = 8×12px 正/背区；曾误用 8px 区贴 4px 面 → 横向
 *  2 倍压缩成"贴图被拉伸"）。 */
export const SKIN_BODY: Array<[number, number, number, number]> = [
  [28, 20, 32, 32], [40, 20, 44, 32], [20, 16, 28, 20], [28, 16, 36, 20], [20, 20, 28, 32], [32, 20, 40, 32],
];
const SKIN_ARM_R: Array<[number, number, number, number]> = [
  [52, 20, 56, 32], [48, 20, 52, 32], [44, 16, 48, 20], [48, 16, 52, 20], [44, 20, 48, 32], [56, 20, 60, 32],
];
const SKIN_ARM_L: Array<[number, number, number, number]> = [
  [40, 20, 44, 32], [48, 20, 52, 32], [44, 16, 48, 20], [48, 16, 52, 20], [44, 20, 48, 32], [52, 20, 56, 32],
];
const SKIN_LEG_R: Array<[number, number, number, number]> = [
  [0, 20, 4, 32], [8, 20, 12, 32], [4, 16, 8, 20], [8, 16, 12, 20], [4, 20, 8, 32], [12, 20, 16, 32],
];
const SKIN_LEG_L: Array<[number, number, number, number]> = [
  [8, 20, 12, 32], [0, 20, 4, 32], [4, 16, 8, 20], [8, 16, 12, 20], [4, 20, 8, 32], [12, 20, 16, 32],
];

function stevePart(
  tex: Tex,
  size: [number, number, number],
  skin: Array<[number, number, number, number]>,
  pos: [number, number, number],
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(...size);
  const uv = new Float32Array(24);
  for (let f = 0; f < 6; f++) {
    const [x0, y0, x1, y1] = skin[f];
    const u0 = x0 / 64;
    const u1 = x1 / 64;
    const v0 = (64 - y1) / 64;
    const v1 = (64 - y0) / 64;
    // 每面顶点序 A=(u0,v1) B=(u1,v1) C=(u0,v0) D=(u1,v0)
    uv[f * 4] = u0; uv[f * 4 + 1] = v1;
    uv[f * 4 + 2] = u1; uv[f * 4 + 3] = v1;
    uv[f * 4 + 4] = u0; uv[f * 4 + 5] = v0;
    uv[f * 4 + 6] = u1; uv[f * 4 + 7] = v0;
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geo, blockMat(tex, 'steve.png', 'steve'));
  mesh.position.set(...pos);
  return mesh;
}

function steve(tex: Tex): THREE.Group {
  const g = new THREE.Group();
  // 双腿（脚底 0 → 胯 0.75），躯干（0.75 → 1.5），双臂（肩 1.5 → 肘下），头（1.5 → 2.0）
  g.add(stevePart(tex, [0.25, 0.75, 0.25], SKIN_LEG_R, [-0.125, 0.375, 0]));
  g.add(stevePart(tex, [0.25, 0.75, 0.25], SKIN_LEG_L, [0.125, 0.375, 0]));
  g.add(stevePart(tex, [0.5, 0.75, 0.25], SKIN_BODY, [0, 1.125, 0]));
  g.add(stevePart(tex, [0.25, 0.75, 0.25], SKIN_ARM_R, [-0.375, 1.125, 0]));
  g.add(stevePart(tex, [0.25, 0.75, 0.25], SKIN_ARM_L, [0.375, 1.125, 0]));
  g.add(stevePart(tex, [0.5, 0.5, 0.5], SKIN_HEAD, [0, 1.75, 0]));
  return g;
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

/** 台阶：半格（type=top → 上移半格），原版 slab 模型 0-8px。中心 = 格中心 pos+0.5
 *  （曾漏 +0.5 → 横向错开半格）。 */
function slabBlock(tex: Tex, name: string, props: Record<string, string>, pos: [number, number, number]): THREE.Mesh {
  const { side } = towerTextures(name);
  return box(mats6(tex, side, 'tower'), [1, 0.5, 1], [pos[0] + 0.5, pos[1] + (props.type === 'top' ? 0.5 : 0), pos[2] + 0.5]);
}

/** 楼梯：原版模型两段（底 0-8px 全宽 + 后 8-16px 高台），默认 facing=east 高台在东，
 *  组旋转 Y 对齐朝向；half=top 上移半格 */
function stairsBlock(tex: Tex, name: string, props: Record<string, string>, pos: [number, number, number]): THREE.Group {
  const { side } = towerTextures(name);
  const g = new THREE.Group();
  const mats = mats6(tex, side, 'tower');
  g.add(box(mats, [1, 0.5, 1], [0, 0, 0]));
  g.add(box(mats, [0.5, 0.5, 1], [0.25, 0.5, 0])); // 局部底面 y=0 → 组中心对齐方块底
  g.rotation.y = ({ east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 } as Record<string, number>)[props.facing ?? 'east'];
  g.position.set(pos[0] + 0.5, pos[1] + (props.half === 'top' ? 0.5 : 0), pos[2] + 0.5);
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

/** 石墙：中心柱（4-12px 见方 16px 高）+ 连接矮墙（高 14px）。哨塔内 wall 无水平连接 → 仅柱 */
function wallBlock(tex: Tex, _name: string, props: Record<string, string>, pos: [number, number, number]): THREE.Group {
  void props;
  const g = new THREE.Group();
  g.add(box(mats6(tex, 'cobblestone.png', 'tower'), [0.5, 1, 0.5], [pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5]));
  return g;
}

/** 火把：2px 柱高 10px（原版 template_torch 7-9px × 0-10px），顶面无火焰方块 */
function torchBlock(tex: Tex, pos: [number, number, number]): THREE.Group {
  const g = new THREE.Group();
  g.add(box(mats6(tex, 'torch.png', 'tower', true), [0.125, 0.625, 0.125], [pos[0] + 0.5, pos[1] + 0.3125, pos[2] + 0.5]));
  return g;
}

/** 挂墙白旗：杆（2px 厚）嵌墙内靠外表面 + 布（8×14×1px）贴墙外表面、面朝 facing 方向
 *  （组绕方块中心旋转，局部 -z 墙面 → 布完全在墙外 z∈[-0.5625,-0.5]；曾朝对侧半探出）。
 *  贴图 = 原版白色旗帜底布。 */
function bannerBlock(tex: Tex, props: Record<string, string>, pos: [number, number, number]): THREE.Group {
  const g = new THREE.Group();
  g.rotation.y = ({ north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 } as Record<string, number>)[props.facing ?? 'north'];
  g.position.set(pos[0] + 0.5, pos[1], pos[2] + 0.5);
  // 杆 y 0-16px 嵌墙内（z -0.4375..-0.375），布 y 1-15px 贴墙外表面（z -0.5625..-0.5）
  g.add(box(mats6(tex, 'banner_base.png', 'tower'), [0.125, 1, 0.0625], [0, 0.5, -0.40625]));
  g.add(box(mats6(tex, 'banner_base.png', 'tower'), [0.5, 0.875, 0.0625], [0, 0.5, -0.53125]));
  return g;
}

/** 箱子：按原版 ChestModel 拆 3 件（base 14×10×14px / lid 14×5×14px 叠合 1px /
 *  lock 2×4×1px，总高 14px=0.875 格，26.2 javap 实测）；纹理按面分区裁剪（chest.png
 *  布局：lid front 上 5px、lid top 14px、box front 10px、box top 14px）——把手/锁扣
 *  只出现在正面，盖底/箱顶等内部面是纯木纹（曾整面贴 → 内部面显示把手"内部贴图"）。
 *  面序 east/west/top/bottom/south/north；分区像素坐标 [u0,v0,u1,v1]（v 从图像顶计）。 */
const CHEST_LID_TOP = [0, 5, 14, 19] as const; // 盖顶木纹（14×14px）
const CHEST_LID_FRONT = [0, 0, 14, 5] as const; // 盖正面（14×5px，含锁扣）
const CHEST_BOX_TOP = [0, 29, 14, 43] as const; // 箱顶木纹（14×14px）
const CHEST_BOX_FRONT = [0, 19, 14, 29] as const; // 箱正面（14×10px，含把手）

/** 单面裁剪材质：共享 image 的 Texture clone + repeat/offset 裁到分区（v 从图像顶计，
 *  three flipY → 顶在 v=1，offset v=(64-v1)/64）。 */
function chestFace(tex: Tex, region: readonly [number, number, number, number]): THREE.MeshLambertMaterial {
  const map = tex && tex['chest.png'];
  if (!map) return fallbackFor('tower');
  const t = map.clone();
  t.needsUpdate = true;
  t.repeat.set((region[2] - region[0]) / 64, (region[3] - region[1]) / 64);
  t.offset.set(region[0] / 64, (64 - region[3]) / 64);
  return new THREE.MeshLambertMaterial({ map: t });
}

/** 六面材质组：south(前) 用 front 区（把手/锁扣），其余含 north(背) 用木纹区 */
function chestMats(tex: Tex, front: readonly [number, number, number, number], top: readonly [number, number, number, number]): THREE.MeshLambertMaterial[] {
  const f = chestFace(tex, front);
  const t = chestFace(tex, top);
  return [t, t, t, t, f, t]; // east/west/top/bottom/north 木纹；south 为 front
}

function chestBlock(tex: Tex, _props: Record<string, string>, pos: [number, number, number]): THREE.Group {
  const g = new THREE.Group();
  // base：14×10×14px @(1,0,1)；lid：14×5×14px 抬到 y9-14px（叠合 1px 合页）；lock：2×4×1px 凸出 z 面
  g.add(box(chestMats(tex, CHEST_BOX_FRONT, CHEST_BOX_TOP), [0.875, 0.625, 0.875], [pos[0] + 0.5, pos[1] + 0.3125, pos[2] + 0.5]));
  g.add(box(chestMats(tex, CHEST_LID_FRONT, CHEST_LID_TOP), [0.875, 0.3125, 0.875], [pos[0] + 0.5, pos[1] + 0.71875, pos[2] + 0.5]));
  // lock：2×4×1px 凸出盖正面（z 15-16px），用盖正面分区裁剪（锁扣图形在其中）
  const lockM = chestFace(tex, CHEST_LID_FRONT);
  g.add(box([lockM, lockM, lockM, lockM, lockM, lockM], [0.125, 0.25, 0.0625], [pos[0] + 0.5, pos[1] + 0.5625, pos[2] + 0.96875]));
  return g;
}

/** 哨塔整体：按结构 JSON 逐方块构建（air/jigsaw 跳过） */
export function buildTower(tex: Tex, data: TowerData): THREE.Group {
  const g = new THREE.Group();
  for (const [x, y, z, state] of data.blocks) {
    const p = data.palette[state];
    if (!p || p.Name === 'minecraft:air' || p.Name === 'minecraft:jigsaw') continue;
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
      case 'minecraft:white_wall_banner':
        g.add(bannerBlock(tex, props, pos));
        break;
      case 'minecraft:chest':
        g.add(chestBlock(tex, props, pos));
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
    case 'steve':
      return steve(tex);
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