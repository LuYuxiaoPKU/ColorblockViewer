// 参照物组装守护（v2 原版资源版）：几何按原版尺寸/模型形状断言；贴图加载失败/无纹理
// 环境（headless）→ 纯色降级（map=null 的 Lambert，与 v1 配色一致）；哨塔结构数据
// = 仓库内 watchtower.json（原版 nbt 转 JSON），逐方块构建、air/jigsaw 跳过。
// 纯渲染层道具，无引擎语义。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  buildReference,
  buildTower,
  REFERENCE_LABELS,
  REFERENCE_TYPES,
  SKIN_BODY,
  TEXTURE_FILES,
  type ReferenceType,
  type TowerData,
} from '../../src/render/reference';

/** 注入假贴图（无 image 的 Texture 即可测材质参数） */
function fakeTex(): Record<string, THREE.Texture> {
  const t: Record<string, THREE.Texture> = {};
  for (const f of TEXTURE_FILES) t[f] = new THREE.Texture();
  return t;
}

function boxOf(g: THREE.Group): { minY: number; maxY: number; minX: number; spanX: number; spanZ: number } {
  const b = new THREE.Box3().setFromObject(g);
  const s = new THREE.Vector3();
  b.getSize(s);
  return { minY: b.min.y, maxY: b.max.y, minX: b.min.x, spanX: s.x, spanZ: s.z };
}

function meshCount(g: THREE.Group): number {
  let n = 0;
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
}

/** 无纹理（headless 降级）路径下所有材质 = 无 map 的 Lambert */
function allPlainLambert(g: THREE.Group): boolean {
  let ok = true;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const lm = mat as THREE.MeshLambertMaterial;
        if (!lm.isMeshLambertMaterial || lm.map !== null) ok = false;
      }
    }
  });
  return ok;
}

describe('buildReference 参照物组装（无纹理降级路径）', () => {
  it('none → null（无参照物）', () => {
    expect(buildReference('none')).toBeNull();
  });

  it('steve：6 个 mesh（双腿/躯干/双臂/头），脚底 y=0、总高 ≈1.9 格、肩宽 1 格', () => {
    const g = buildReference('steve')!;
    expect(meshCount(g)).toBe(6);
    expect(allPlainLambert(g)).toBe(true);
    const b = boxOf(g);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeGreaterThan(1.85);
    expect(b.maxY).toBeLessThan(2.05); // 头顶 2.0（原版 1.8 格 + 头 0.5）
    expect(b.spanX).toBeGreaterThan(0.9); // 臂展 0.375×2 + 躯干 0.5
    expect(b.spanX).toBeLessThan(1.1);
  });

  it('steve 躯干皮肤分区防拉伸：east/west 为 4px 侧区（深×高）、south/north 为 8px 正/背区（宽×高）——曾用 8px 区贴 4px 面致横向 2 倍压缩', () => {
    for (const f of [0, 1]) {
      expect(SKIN_BODY[f][2] - SKIN_BODY[f][0], `面 ${f}（east/west）宽`).toBe(4);
    }
    for (const f of [4, 5]) {
      expect(SKIN_BODY[f][2] - SKIN_BODY[f][0], `面 ${f}（south/north）宽`).toBe(8);
    }
    for (const f of [0, 1, 4, 5]) {
      expect(SKIN_BODY[f][3] - SKIN_BODY[f][1], `面 ${f} 高`).toBe(12);
    }
  });

  it('command_block：1 个 1 格方块，脚底 y=0、顶 y=1', () => {
    const g = buildReference('command_block')!;
    expect(meshCount(g)).toBe(1);
    const b = boxOf(g);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeCloseTo(1, 6);
    expect(b.spanX).toBeCloseTo(1, 6);
    expect(b.spanZ).toBeCloseTo(1, 6);
  });

  it('command_block 动画贴图只取第一帧：map.repeat=(1,0.25) offset=(0,0.75)（16×64 四帧垂直排列，原版按帧偏移采样）', () => {
    const g = buildReference('command_block', fakeTex())!;
    const mat = ((g.children[0] as THREE.Mesh).material as THREE.Material[])[0] as THREE.MeshLambertMaterial;
    expect(mat.map).toBeTruthy();
    expect(mat.map!.repeat.y).toBeCloseTo(0.25, 6);
    expect(mat.map!.offset.y).toBeCloseTo(0.75, 6);
  });

  it('oak_tree 树叶材质：alphaTest=0.5（原版 CUTOUT 剪切）+ foliage 染色 0x619961（jar 贴图为灰度剪影，原版按生物群系 tint——Lambert color×map）', () => {
    const g = buildReference('oak_tree', fakeTex())!;
    const leaves = ((g.children[5] as THREE.Mesh).material as THREE.Material[])[0] as THREE.MeshLambertMaterial;
    expect(leaves.alphaTest).toBeCloseTo(0.5, 6);
    expect(leaves.transparent).toBe(false);
    expect(leaves.color.getHex()).toBe(0x619961);
  });

  it('oak_tree：树干 5 块（1:1 原版逐方块，非单个拉伸 Box）+ 树叶 55（球冠 3 层：下层去四角 21、中层 25、顶层 9），总高 8 格、冠宽 4', () => {
    const g = buildReference('oak_tree')!;
    expect(meshCount(g)).toBe(60);
    const b = boxOf(g);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeCloseTo(7.5, 6); // 树冠顶 7.5（原版橡树 5–7 格）
    expect(b.spanX).toBeCloseTo(5, 6); // 树冠 ±2 格 + 叶块半格
    expect(b.spanZ).toBeCloseTo(5, 6);
  });
});

describe('哨塔结构数据（仓库 watchtower.json = 原版 nbt 1:1）', () => {
  const data = JSON.parse(
    readFileSync('public/references/1.21.11/watchtower.json', 'utf8'),
  ) as TowerData;

  it('与原版结构 nbt 对拍：15×21×15、40 种方块、4725 块', () => {
    expect(data.size).toEqual([15, 21, 15]);
    expect(data.palette.length).toBe(40);
    expect(data.blocks.length).toBe(4725);
  });

  it('palette 含哨塔全部方块族（原木/木板/石/栅栏/台阶/楼梯/火把/旗帜/箱子/jigsaw）', () => {
    const names = new Set(data.palette.map((p) => p.Name));
    for (const n of [
      'minecraft:dark_oak_log',
      'minecraft:dark_oak_planks',
      'minecraft:birch_planks',
      'minecraft:cobblestone',
      'minecraft:dark_oak_fence',
      'minecraft:dark_oak_slab',
      'minecraft:cobblestone_stairs',
      'minecraft:dark_oak_stairs',
      'minecraft:cobblestone_wall',
      'minecraft:white_wall_banner',
      'minecraft:torch',
      'minecraft:chest',
      'minecraft:jigsaw',
      'minecraft:air',
    ]) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it('buildTower 逐方块构建：air/jigsaw 跳过、含特殊方块多 mesh、包围盒 = 实际结构分布', () => {
    const g = buildTower(null, data);
    const nonAir = data.blocks.filter(([, , , s]) => {
      const p = data.palette[s];
      return p && p.Name !== 'minecraft:air' && p.Name !== 'minecraft:jigsaw';
    }).length;
    // 整方块 1 mesh + 特殊方块多 mesh（fence 1+连接杆、stairs 2、chest 2）→ 略多于非空气方块数
    expect(meshCount(g)).toBeGreaterThan(nonAir);
    expect(meshCount(g)).toBeLessThan(nonAir * 2 + 300);
    const b = boxOf(g);
    // 结构 envelope 15×21×15 含留白：y 满 0..21；x/z 实际方块分布 0.5..14.031
    // （最左列仅 2 块、无出挑部件 → min 恰 0.5；最右 banner 布贴墙面厚 1px → 14.031）
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeCloseTo(21, 6);
    expect(b.minX).toBeCloseTo(0.5, 3);
    expect(b.spanX).toBeCloseTo(13.531, 3);
    expect(b.spanZ).toBeCloseTo(13.531, 3);
  });

  it('outpost_tower 无结构数据（异步未就绪）→ 空组，不报错', () => {
    const g = buildReference('outpost_tower')!;
    expect(g).toBeTruthy();
    expect(meshCount(g)).toBe(0);
  });
});

describe('枚举与标签完整覆盖', () => {
  it('5 类型齐全，标签非空', () => {
    expect(REFERENCE_TYPES).toEqual(['none', 'steve', 'command_block', 'oak_tree', 'outpost_tower']);
    for (const t of REFERENCE_TYPES as ReferenceType[]) {
      expect(REFERENCE_LABELS[t], t).toBeTruthy();
    }
  });
});
