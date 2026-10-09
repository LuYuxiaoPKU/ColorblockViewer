// 参照物组装守护：每个类型返回 Group、子 mesh 数量/包围盒符合 MC 尺寸直觉；
// 'none' → null；枚举与标签完整。纯渲染层道具，无引擎语义。

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildReference, REFERENCE_LABELS, REFERENCE_TYPES, type ReferenceType } from '../../src/render/reference';

function boxOf(g: THREE.Group): { minY: number; maxY: number; spanX: number; spanZ: number } {
  const b = new THREE.Box3().setFromObject(g);
  const s = new THREE.Vector3();
  b.getSize(s);
  return { minY: b.min.y, maxY: b.max.y, spanX: s.x, spanZ: s.z };
}

function meshCount(g: THREE.Group): number {
  let n = 0;
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
}

describe('buildReference 参照物组装', () => {
  it('none → null（无参照物）', () => {
    expect(buildReference('none')).toBeNull();
  });

  it('steve：6 个 mesh（双腿/躯干/双臂/头），脚底 y=0、总高 ≈1.85 格', () => {
    const g = buildReference('steve')!;
    expect(meshCount(g)).toBe(6);
    const b = boxOf(g);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeGreaterThan(1.8);
    expect(b.maxY).toBeLessThan(1.95);
    expect(b.spanX).toBeGreaterThan(0.7); // 肩宽 0.25×2 + 躯干 0.5
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

  it('oak_tree：树干 + 双层树冠，总高 >7 格、冠宽 ≈3.2', () => {
    const g = buildReference('oak_tree')!;
    expect(meshCount(g)).toBe(3);
    const b = boxOf(g);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeGreaterThan(7);
    expect(b.spanX).toBeGreaterThanOrEqual(3.1);
    expect(b.spanZ).toBeGreaterThanOrEqual(3.1);
  });

  it('outpost_tower：石塔 + 平台 + 旗帜，总高 >8 格', () => {
    const g = buildReference('outpost_tower')!;
    expect(meshCount(g)).toBeGreaterThanOrEqual(7);
    const b = boxOf(g);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeGreaterThan(8);
    expect(b.maxY).toBeLessThan(11);
  });

  it('枚举与标签完整覆盖', () => {
    expect(REFERENCE_TYPES).toEqual(['none', 'steve', 'command_block', 'oak_tree', 'outpost_tower']);
    for (const t of REFERENCE_TYPES as ReferenceType[]) {
      expect(REFERENCE_LABELS[t], t).toBeTruthy();
      expect(buildReference(t), t).not.toBeUndefined(); // 非 none 都有模型
    }
  });
});
