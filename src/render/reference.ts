// 场景参照物（渲染层道具，纯展示，无 1:1 约束）：史蒂夫 / 命令方块 / 橡树 /
// 袭击哨塔。纯几何体拼装（不加载外部资源），帮助用户比对粒子与方块/实体的
// 相对尺寸。位置约定：脚底 y=0、水平居中 (0.5, *, 0.5)（与原点 1 格网格对齐）。
// 'none' → null（无参照物）。

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

const mat = (hex: number): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color: hex });

const box = (w: number, h: number, d: number, color: number): THREE.Mesh =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));

const cyl = (r: number, h: number, color: number): THREE.Mesh =>
  new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat(color));

/** 史蒂夫：腿/躯干/双臂/头（经典配色），总高 ≈1.85 格（1 格 = 1.8m）。 */
function steve(): THREE.Group {
  const g = new THREE.Group();
  const skin = 0xc69c6d; // 肤色
  const shirt = 0x00a8a8; // 青蓝上衣
  const pants = 0x385da6; // 蓝裤
  // 双腿（脚底 y=0，胯高 0.75）
  for (const sx of [-0.125, 0.125]) {
    const leg = box(0.25, 0.75, 0.25, pants);
    leg.position.set(sx, 0.375, 0);
    g.add(leg);
  }
  // 躯干（胯 0.75 → 肩 1.37）
  const torso = box(0.5, 0.62, 0.25, shirt);
  torso.position.set(0, 1.06, 0);
  g.add(torso);
  // 双臂（肩 1.37 → 肘下，两侧各 0.375）
  for (const sx of [-0.375, 0.375]) {
    const arm = box(0.25, 0.62, 0.25, shirt);
    arm.position.set(sx, 1.06, 0);
    g.add(arm);
  }
  // 头（肩 1.37 → 1.87）
  const head = box(0.5, 0.5, 0.5, skin);
  head.position.set(0, 1.62, 0);
  g.add(head);
  return g;
}

/** 命令方块：1 格方块，橙色调。 */
function commandBlock(): THREE.Group {
  const g = new THREE.Group();
  const block = box(1, 1, 1, 0xffb000);
  block.position.set(0.5, 0.5, 0.5);
  g.add(block);
  return g;
}

/** 橡树：棕树干 + 双层绿色树冠，总高 ≈7.6 格（MC 橡树 5–7 格）。 */
function oakTree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = box(0.6, 5, 0.6, 0x6b4f2a);
  trunk.position.set(0.5, 2.5, 0.5);
  g.add(trunk);
  const crown1 = box(3.2, 2.4, 3.2, 0x2c6b2f);
  crown1.position.set(0.5, 6.2, 0.5);
  g.add(crown1);
  const crown2 = box(2, 1.2, 2, 0x3a9b3f);
  crown2.position.set(0.5, 7.5, 0.5);
  g.add(crown2);
  return g;
}

/** 袭击哨塔（掠夺者前哨站，简化结构）：石基/塔身 + 木板平台/顶棚 + 旗帜。 */
function outpostTower(): THREE.Group {
  const g = new THREE.Group();
  const stone = 0x8b8b8b;
  const wood = 0x8b5a2b;
  const base = box(2.6, 0.4, 2.6, stone);
  base.position.set(0.5, 0.2, 0.5);
  g.add(base);
  const shaft = box(1.6, 5, 1.6, stone);
  shaft.position.set(0.5, 3.1, 0.5);
  g.add(shaft);
  const upper = box(1.2, 2.6, 1.2, stone);
  upper.position.set(0.5, 6.9, 0.5);
  g.add(upper);
  const platform = box(3, 0.4, 3, wood);
  platform.position.set(0.5, 7.4, 0.5);
  g.add(platform);
  const roof = box(1.8, 0.4, 1.8, wood);
  roof.position.set(0.5, 8.05, 0.5);
  g.add(roof);
  const pole = cyl(0.05, 1.6, 0x555555);
  pole.position.set(0.5, 9, 0.5);
  g.add(pole);
  const flag = box(0.3, 0.9, 0.06, 0xc0392b);
  flag.position.set(0.68, 9.35, 0.5);
  g.add(flag);
  return g;
}

export function buildReference(type: ReferenceType): THREE.Group | null {
  switch (type) {
    case 'steve':
      return steve();
    case 'command_block':
      return commandBlock();
    case 'oak_tree':
      return oakTree();
    case 'outpost_tower':
      return outpostTower();
    default:
      return null;
  }
}
