import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildTower, TEXTURE_FILES, type TowerData } from '../../src/render/reference';

/** 每个 stairs 组的高台（0.5×0.5×1 尺寸 mesh）世界方向必须等于数据 facing——
 *  曾 south/north 旋转方向反置（three.js 与 MC 模型 y 旋转方向相反）致两向台阶朝错。 */
describe('哨塔 stairs 朝向（facing 与高台方向一致）', () => {
  it('全部台阶朝向正确', () => {
    const data = JSON.parse(
      readFileSync('public/references/1.21.11/watchtower.json', 'utf8'),
    ) as TowerData;
    const tex: Record<string, THREE.Texture> = {};
    for (const f of TEXTURE_FILES) tex[f] = new THREE.Texture();
    const g = buildTower(tex, data);
    g.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const bad: string[] = [];
    // 遍历数据：每个 stairs 条目 → 期望组位置 (x+0.5, y+half, z+0.5)
    for (const b of data.blocks) {
      const pal = data.palette[b[3]];
      if (!String(pal.Name).includes('stairs')) continue;
      const [x, y, z] = b;
      const { facing = 'east' } = pal.Properties ?? {};
      const gx = x + 0.5;
      const gz = z + 0.5;
      const gy = y; // 组 position.y 恒 = 方块底（half=top 为 x:180 翻转，非上移）
      // 找到该位置的 2-mesh 组（stairs）
      let dir = '';
      g.traverse((o) => {
        if (!(o as THREE.Group).isGroup || (o as THREE.Group).children.length !== 2) return;
        const grp = o as THREE.Group;
        if (Math.abs(grp.position.x - gx) > 1e-6 || Math.abs(grp.position.z - gz) > 1e-6 || Math.abs(grp.position.y - gy) > 1e-6) return;
        grp.children.forEach((c) => {
          const m = c as THREE.Mesh;
          const sz = (m.geometry as THREE.BoxGeometry).parameters;
          if (m.isMesh && sz.width === 0.5 && sz.depth === 1 && sz.height === 0.5) {
            m.getWorldPosition(v);
            const dx = v.x - gx;
            const dz = v.z - gz;
            dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north';
          }
        });
      });
      if (dir !== facing) bad.push(`(${x},${y},${z}) facing=${facing} 渲染高台=${dir || '未找到'}`);
    }
    expect(bad, bad.join('；')).toEqual([]);
  });
});
