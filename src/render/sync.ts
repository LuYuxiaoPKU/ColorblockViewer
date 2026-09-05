// 仿真快照 → 点云缓冲（计划 §八）。每 tick 全量重写前缀 + setDrawRange，
// needsUpdate 每 tick 一次（非每帧）。渲染只读仿真快照，不写仿真状态。

import * as THREE from 'three';
import { createScene, type SceneBundle } from './scene';
import { createPointsLayer, syncToPoints, type PointsLayer } from './points';

/** 渲染层读的最小引擎视图（解耦 render ↔ sim：SimEngine 结构子集） */
export interface SnapshotSource {
  snapshot(): {
    x: number; y: number; z: number;
    r: number; g: number; b: number; a: number;
    name: string;
  }[];
}

export class SimViewport {
  private scene: SceneBundle;
  private layer: PointsLayer;
  private raf = 0;
  private running = false;

  sizeMul = 1;
  alphaMul = 1;

  constructor(container: HTMLElement, maxParticles: number) {
    this.scene = createScene(container);
    this.layer = createPointsLayer(maxParticles);
    this.scene.scene.add(this.layer.points);
  }

  /** tick/命令后调用：全量重写缓冲 + drawRange。返回可见粒子数。 */
  update(source: SnapshotSource): number {
    const n = syncToPoints(this.layer, source.snapshot(), this.sizeMul, this.alphaMul);
    const geo = this.layer.points.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, n);
    return n;
  }

  setSizeMul(v: number): void {
    this.sizeMul = v;
    this.layer.uniforms.uSizeMul.value = v;
  }

  setAlphaMul(v: number): void {
    this.alphaMul = v;
    this.layer.uniforms.uAlphaMul.value = v;
  }

  resize(): void {
    this.scene.resize();
  }

  /** 渲染循环（轨道相机阻尼需要连续渲染；tick 由外部墙钟累加器驱动）。 */
  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.scene.controls.update();
      this.scene.renderer.render(this.scene.scene, this.scene.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    this.layer.dispose();
    this.scene.dispose();
  }
}
