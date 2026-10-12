// 哨塔跨方块重叠守护（前哨站回归修复的沉淀）：特殊方块（半砖/楼梯/栅栏横杆等）
// 的 AABB 不得与相邻方块的部件实质相交（三轴交集 > 1e-3）。
// 排除规则：同方块自身部件对——原版 fence 横杆（7–16px）本即嵌入柱体（6–10px）
// 1px，属原版模型几何；跨方块横杆只伸到边界 16px 与邻块共享面（交集厚度 0）。
// 曾修：half=top 楼梯误作上移半格 → 高台侵入上方圆石柱。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildTower, TEXTURE_FILES, type TowerData } from '../../src/render/reference';

describe('哨塔几何不穿入相邻方块', () => {
  it('全部跨方块部件对无实质重叠', () => {
    const data = JSON.parse(
      readFileSync('public/references/1.21.11/watchtower.json', 'utf8'),
    ) as TowerData;
    const tex: Record<string, THREE.Texture> = {};
    for (const f of TEXTURE_FILES) tex[f] = new THREE.Texture();
    const g = buildTower(tex, data);
    g.updateMatrixWorld(true);

    // 反查 mesh 中心所属的方块条目（floor 向下取整；所有部件中心都落在自身格内）
    const blockAt = (x: number, y: number, z: number): string => {
      const b = data.blocks.find(
        (bb) => bb[0] === Math.floor(x) && bb[1] === Math.floor(y) && bb[2] === Math.floor(z),
      );
      if (!b) return '?';
      const p = data.palette[b[3]];
      return `${p.Name.split(':')[1]} ${JSON.stringify(p.Properties ?? {})}`;
    };

    const meshes: THREE.Mesh[] = [];
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const bad: string[] = [];
    for (let i = 0; i < meshes.length; i++) {
      for (let j = i + 1; j < meshes.length; j++) {
        const a = new THREE.Box3().setFromObject(meshes[i]);
        const b = new THREE.Box3().setFromObject(meshes[j]);
        if (!a.intersectsBox(b)) continue;
        const ix = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
        const iy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
        const iz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
        if (ix <= 1e-3 || iy <= 1e-3 || iz <= 1e-3) continue;
        const ca = a.getCenter(new THREE.Vector3());
        const kb = blockAt(b.getCenter(new THREE.Vector3()).x, b.getCenter(new THREE.Vector3()).y, b.getCenter(new THREE.Vector3()).z);
        const ka = blockAt(ca.x, ca.y, ca.z);
        if (ka === kb) continue; // 同方块部件（fence 横杆嵌柱）属原版几何
        bad.push(
          `A@(${ca.x.toFixed(2)},${ca.y.toFixed(2)},${ca.z.toFixed(2)}) ← ${ka}，B ← ${kb}，交集 y[${Math.max(a.min.y, b.min.y).toFixed(2)},${Math.min(a.max.y, b.max.y).toFixed(2)}]`,
        );
      }
    }
    expect(bad, bad.join('；')).toEqual([]);
  });
});