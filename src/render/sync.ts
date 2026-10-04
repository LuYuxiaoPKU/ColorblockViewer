// 仿真快照 → 点云缓冲（计划 §八）。每 tick 全量重写前缀 + setDrawRange，
// needsUpdate 每 tick 一次（非每帧）。渲染只读仿真快照，不写仿真状态。

import * as THREE from 'three';
import { createScene, type SceneBundle } from './scene';
import { createPointsLayer, setPointsLayerAtlasKey, syncToPoints, type PointsLayer } from './points';

/** 渲染层读的最小引擎视图（解耦 render ↔ sim：SimEngine 结构子集）。 */
export interface SnapshotSource {
  snapshot(): {
    x: number; y: number; z: number;
    r: number; g: number; b: number; a: number;
    name: string;
    age: number;
    lifetime: number;
    vanilla: boolean;
    nbtTint?: boolean;
    colorFrom?: { r: number; g: number; b: number };
    colorTo?: { r: number; g: number; b: number };
    sizeMul?: number;
  }[];
}

export class SimViewport {
  private scene: SceneBundle;
  private layer: PointsLayer;
  private raf = 0;
  private running = false;
  /** 着色器已预热（start 首次 compile，避免首帧 render 时同步编译卡顿） */
  private compiled = false;
  /** 当前图集 key（游戏版本）：帧 UV 采样 + 贴图加载都按它分区 */
  private atlasKey = '26.2';

  sizeMul = 1;
  alphaMul = 1;

  /** 首帧预热进度（App 构造后赋值）：'atlas' = 贴图加载（frac = drew/total），
   *  'ready' = 着色器编译完成（进度条淡出信号）。快速模式视口不实现（?. 兼容）。
   *  首次 'ready' 上报后本视口永久停止上报：版本切换触发的新图集加载属于热切换，
   *  圆点回退一闪即过，进度条不应再出现（App 侧 readyRef 门控对模式切换重挂的
   *  视口会失效，此处为视口级权威门控）。 */
  onProgress: ((stage: 'atlas' | 'ready', frac: number, label?: string) => void) | null = null;
  /** 首次 'ready' 已上报 → 之后所有进度（含版本切换的图集加载）不再上报 */
  private readyReported = false;

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
    this.layer._onProgress = (drew, total) => {
      if (this.readyReported) return;
      this.onProgress?.('atlas', total > 0 ? drew / total : 0, `加载贴图 ${drew}/${total}`);
    };
    this.scene.scene.add(this.layer.points);
  }

  /** 切换游戏版本 → 换图集（旧纹理 dispose，加载完成前圆点回退）。 */
  setAtlasKey(key: string): void {
    if (key === this.atlasKey) return;
    this.atlasKey = key;
    setPointsLayerAtlasKey(this.layer, key);
  }

  /** 网格大小（block，1 block/格）与显示开关（App 按 sim 设置驱动）。 */
  setGrid(size: number, visible: boolean): void {
    this.scene.setGrid(size, visible);
  }

  /** tick/命令后调用：全量重写缓冲 + drawRange。返回可见粒子数。
   *  帧动画按粒子自身 age/lifetime（age-progress，原版语义）；
   *  图集异步加载完成前自动走圆点回退。 */
  update(source: SnapshotSource): number {
    const n = syncToPoints(
      this.layer,
      source.snapshot(),
      this.sizeMul,
      this.alphaMul,
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

  /** 渲染循环（轨道相机阻尼需要连续渲染；tick 由外部墙钟累加器驱动）。
   *  启动时先预热着色器（compileAsync）：把 GL 程序编译从首帧 render 提前，
   *  避免播放开始后第一帧同步编译卡顿；完成时上报 'ready'（进度条淡出）。 */
  start(): void {
    if (this.running) return;
    if (this.scene.renderer.getContext() === null) {
      // WebGL 上下文创建失败（无 GPU/被禁用）：渲染循环无意义，不上 rAF；
      // running 置位保证 start 幂等（二次调用不再重复上报）。
      this.running = true;
      this.readyReported = true;
      this.onProgress?.('ready', 1);
      return;
    }
    this.running = true;
    if (!this.compiled) {
      this.compiled = true;
      void this.scene.renderer
        .compileAsync(this.scene.scene, this.scene.camera)
        .then(() => {
          if (this.readyReported) return;
          this.readyReported = true;
          this.onProgress?.('ready', 1);
        });
    }
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
