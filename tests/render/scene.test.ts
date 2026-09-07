// scene 网格单测：GridHelper 顶点数 ↔ 边长换算（setGrid 的重建判据 gridSizeOf）
// 与 1 block/格的顶点分布。GridHelper 不依赖 WebGL 上下文，可直接构造；
// createScene 全链路（含 WebGLRenderer）由 headless 浏览器验证覆盖。

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { gridSizeOf } from '../../src/render/scene';

describe('网格几何', () => {
  it('默认 10×10（1 block/格）：position 顶点数 = 4*(10+1) = 44', () => {
    const g = new THREE.GridHelper(10, 10, 0x3a4150, 0x1c2130);
    expect(g.geometry.getAttribute('position').count).toBe(4 * 11);
    expect(gridSizeOf(g)).toBe(10);
  });

  it('gridSizeOf 从顶点数反推边长（setGrid 的重建判据）', () => {
    for (const size of [2, 10, 50, 100]) {
      const g = new THREE.GridHelper(size, size, 0x3a4150, 0x1c2130);
      expect(gridSizeOf(g)).toBe(size);
    }
    // 非 1 block/格（divisions ≠ size）时反推为 divisions —— 本场景恒 size===divisions，
    // 此处只锁定换算公式对等价的鲁棒性
    const g = new THREE.GridHelper(10, 5, 0x3a4150, 0x1c2130);
    expect(gridSizeOf(g)).toBe(5);
  });

  it('1 block/格：size=50 时顶点落在 ±25 且步长 1', () => {
    const g = new THREE.GridHelper(50, 50, 0x3a4150, 0x1c2130);
    const pos = g.geometry.getAttribute('position') as THREE.BufferAttribute;
    // 第一条线：(-25, 0, -25) → (25, 0, -25)
    expect(pos.getX(0)).toBe(-25);
    expect(pos.getX(1)).toBe(25);
    expect(pos.getZ(0)).toBe(-25);
    // 每条线 4 个顶点（横 2 + 纵 2），下一条横线 z 步长 1
    expect(pos.getZ(4)).toBe(-24);
  });

  it('边长不同 → 顶点数不同（重建判据可区分）', () => {
    const a = new THREE.GridHelper(10, 10, 0x3a4150, 0x1c2130);
    const b = new THREE.GridHelper(12, 12, 0x3a4150, 0x1c2130);
    expect(a.geometry.getAttribute('position').count).not.toBe(b.geometry.getAttribute('position').count);
  });
});
