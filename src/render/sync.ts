// 仿真快照 → 点云缓冲（计划 §八）。每 tick 全量重写前缀 + setDrawRange，
// needsUpdate 每 tick 一次（非每帧）。渲染只读仿真快照，不写仿真状态。

import * as THREE from 'three';
import { createScene, type SceneBundle } from './scene';
import { createPointsLayer, setPointsLayerAtlasKey, syncToPoints, FRAME_MS, type PointsLayer } from './points';

/** 渲染层读的最小引擎视图（解耦 render ↔ sim：SimEngine 结构子集）。
 *  tick 用于帧动画相位（1/20 s/帧，与 MC 客户端 SpriteSet 节奏一致）。 */
export interface SnapshotSource {
  tick: number;
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
  /** 当前图集 key（游戏版本）：帧 UV 采样 + 贴图加载都按它分区 */
  private atlasKey = '26.2';

  sizeMul = 1;
  alphaMul = 1;

  /** 画布物理像素尺寸与相机 fov（点尺寸换算用，App 启动/resize 时读取） */
  get size(): number {
    return this.scene.renderer.domElement.clientHeight;
  }
  get fov(): number {
    return this.scene.camera.fov;
  }

  constructor(container: HTMLElement, maxParticles: number, atlasKey = '26.2') {
    this.scene = createScene(container);
    this.atlasKey = atlasKey;
    this.layer = createPointsLayer(maxParticles, atlasKey);
    this.scene.scene.add(this.layer.points);
  }

  /** 切换游戏版本 → 换图集（旧纹理 dispose，加载完成前圆点回退）。 */
  setAtlasKey(key: string): void {
    if (key === this.atlasKey) return;
    this.atlasKey = key;
    setPointsLayerAtlasKey(this.layer, key);
  }

  /** tick/命令后调用：全量重写缓冲 + drawRange。返回可见粒子数。
   *  帧相位取引擎 tick（1/20 s/帧）；图集异步加载完成前自动走圆点回退。 */
  update(source: SnapshotSource): number {
    const n = syncToPoints(
      this.layer,
      source.snapshot(),
      this.sizeMul,
      this.alphaMul,
      source.tick * FRAME_MS,
      this.atlasKey,
    );
    const geo = this.layer.points.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
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

  /** 点尺寸世界块→像素换算常数：uScale = 视口物理高·0.5 / tan(fov/2)。
   *  构造后立即调用一次（首帧渲染前生效），之后每次 resize 重算。 */
  setPointScale(heightPx: number, fovDeg: number): void {
    this.layer.uniforms.uScale.value =
      (heightPx * 0.5 * Math.min(window.devicePixelRatio, 2)) /
      Math.tan((fovDeg * 0.5 * Math.PI) / 180);
  }

  resize(): void {
    this.scene.resize();
    this.setPointScale(this.scene.renderer.domElement.clientHeight, this.scene.camera.fov);
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
