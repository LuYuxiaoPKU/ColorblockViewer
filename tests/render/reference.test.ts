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

describe('buildReference 参照物组装（无纹理降级路径）', () => {
  it('none → null（无参照物）', () => {
    expect(buildReference('none')).toBeNull();
  });

  it('steve 参照物已移除（2026-10-12 用户拍板：修复成本高，删除）', () => {
    expect(REFERENCE_TYPES).not.toContain('steve');
    expect(buildReference('steve' as ReferenceType)).toBeNull();
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
    // 整方块 1 mesh + 特殊方块多 mesh（fence 1+连接杆、stairs 2）→ 略多于非空气方块数
    expect(meshCount(g)).toBeGreaterThan(nonAir);
    expect(meshCount(g)).toBeLessThan(nonAir * 2 + 300);
    const b = boxOf(g);
    // 结构 envelope：y 满 0..21；x/z 边界 = 主体墙外沿（banner 曾占 x=0/14 撑到
    // 全宽 15，跳过渲染后主体 x/z ∈ [1,13] → min=1 / span=13）
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeCloseTo(21, 6);
    expect(b.minX).toBeCloseTo(1, 6);
    expect(b.spanX).toBeCloseTo(13, 6);
    expect(b.spanZ).toBeCloseTo(13, 6);
  });

  it('outpost_tower 无结构数据（异步未就绪）→ 空组，不报错', () => {
    const g = buildReference('outpost_tower')!;
    expect(g).toBeTruthy();
    expect(meshCount(g)).toBe(0);
  });

  it('slab 上下位置贴格：top (3,1,5) 中心 y=1.75、bottom (1,3,4) 中心 y=3.25——曾 ±0.25 偏移致居中', () => {
    const g = buildTower(null, data);
    const findSlab = (cx: number, cz: number): number => {
      let y = NaN;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (Math.abs(m.position.x - cx) < 1e-6 && Math.abs(m.position.z - cz) < 1e-6 && (m.geometry as THREE.BoxGeometry).parameters.height < 1) y = m.position.y;
      });
      return y;
    };
    expect(findSlab(3.5, 5.5)).toBeCloseTo(1.75, 6); // top：中心 pos+0.75，几何 [1.5, 2.0] 贴格顶
    expect(findSlab(1.5, 4.5)).toBeCloseTo(3.25, 6); // bottom：中心 pos+0.25，几何 [3.0, 3.5] 贴格底
  });

  it('stairs half 语义：bottom (9,1,4) 整体顶 y=2.0（16px 满格）、top (3,3,4) 顶 y=4.0（x:180 翻转：可踩面在上半、高台翻到下半）——曾把 top 误作上移半格致高台侵入上方圆石', () => {
    const g = buildTower(null, data);
    g.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const stairsTopY = (cx: number, cz: number): number => {
      let maxY = -Infinity;
      g.traverse((o) => {
        if (!(o as THREE.Group).isGroup) return; // 楼梯 = 2-mesh 组：底段 + 高台
        const grp = o as THREE.Group;
        const gp = grp.position;
        if (Math.abs(gp.x - cx) < 1e-6 && Math.abs(gp.z - cz) < 1e-6 && grp.children.length === 2) {
          grp.traverse((c) => {
            const m = c as THREE.Mesh;
            if (!m.isMesh) return;
            const sz = (m.geometry as THREE.BoxGeometry).parameters;
            if (sz.height < 1) {
              m.getWorldPosition(v);
              maxY = Math.max(maxY, v.y + sz.height / 2);
            }
          });
        }
      });
      return maxY;
    };
    // bottom (9,1,4) facing=east：底段 world 1.0-1.5、高台 1.5-2.0
    expect(stairsTopY(9.5, 4.5)).toBeCloseTo(2.0, 6);
    // top (3,3,4) facing=north：翻转后底段 3.5-4.0（顶 = 格子顶 4.0），高台 3.0-3.5
    expect(stairsTopY(3.5, 4.5)).toBeCloseTo(4.0, 6);
  });

  it('fence 横杆伸到方块边缘：east+west 连接的 (4,14,1)，最远杆中心 x=4.71875 / 3.28125（原版从柱边 7px 到边 16px，边界对接）', () => {
    const g = buildTower(null, data);
    const east = { n: 0 };
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const size = (m.geometry as THREE.BoxGeometry).parameters;
      if (size.width === 0.5625 && m.position.x === 4.71875 && m.position.z === 1.5) east.n++;
      if (size.width === 0.5625 && m.position.x === 3.28125 && m.position.z === 1.5) east.n++;
    });
    expect(east.n).toBe(2); // 上/下各两根(东/西),共 4 → 这里计数东+西各至少 1?
  });

  it('chest/banner 已移除（用户拍板）：箱子 (9,14,10)、旗帜 (0,13,4) 位置均无 mesh——杜绝 default 分支整方块兜底渲染出来', () => {
    const g = buildTower(fakeTex(), data);
    let chestMesh = 0;
    let bannerMesh = 0;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const p = m.position;
      if (Math.abs(p.x - 9.5) < 1e-6 && Math.abs(p.y - 14) < 1e-6 && Math.abs(p.z - 10.5) < 1e-6) chestMesh++;
      if (Math.abs(p.x - 0.5) < 1e-6 && Math.abs(p.y - 13) < 1e-6 && Math.abs(p.z - 4.5) < 1e-6) bannerMesh++;
    });
    expect(chestMesh).toBe(0);
    expect(bannerMesh).toBe(0);
  });

  it('cobblestone_wall (2,14,2)：post 1:1 复刻（0.5×1×0.5，原版 [4,0,4]-[12,16,12]），侧面贴图按原版默认 UV 采样中间 8 列——曾 16px 纹理压进 8px 面，横向压缩 2 倍、圆石图案竖长变形', () => {
    const g = buildTower(fakeTex(), data);
    const found: THREE.Mesh[] = [];
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (Math.abs(m.position.x - 2.5) < 1e-6 && Math.abs(m.position.y - 14.5) < 1e-6 && Math.abs(m.position.z - 2.5) < 1e-6) found.push(m);
    });
    expect(found.length).toBe(1);
    const size = (found[0].geometry as THREE.BoxGeometry).parameters;
    expect(size.width).toBeCloseTo(0.5, 6);
    expect(size.height).toBeCloseTo(1, 6);
    const side = (found[0].material as THREE.Material[])[0] as THREE.MeshLambertMaterial;
    expect(side.map!.repeat.x).toBeCloseTo(0.5, 6); // 8/16：贴图中间 8 列
    expect(side.map!.offset.x).toBeCloseTo(0.25, 6); // 起点 4/16
    expect(side.map!.repeat.y).toBeCloseTo(1, 6); // 纵向 16 行全采 → 无变形
    expect(side.map!.offset.y).toBeCloseTo(0, 6);
    const top = (found[0].material as THREE.Material[])[2] as THREE.MeshLambertMaterial; // up 面
    expect(top.map!.repeat.x).toBeCloseTo(0.5, 6);
    expect(top.map!.repeat.y).toBeCloseTo(0.5, 6);
    expect(top.map!.offset.y).toBeCloseTo(0.25, 6); // 中心 8×8 区（v 4-12 从顶计）
  });
});

describe('枚举与标签完整覆盖', () => {
  it('4 类型齐全，标签非空', () => {
    expect(REFERENCE_TYPES).toEqual(['none', 'command_block', 'oak_tree', 'outpost_tower']);
    for (const t of REFERENCE_TYPES as ReferenceType[]) {
      expect(REFERENCE_LABELS[t], t).toBeTruthy();
    }
  });
});
