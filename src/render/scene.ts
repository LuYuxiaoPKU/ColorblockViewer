// 场景装配（计划 §八）：深色背景 + PerspectiveCamera + OrbitControls（Y 向上）
// + GridHelper@y=0（1 block 格，大小/显示可配，默认 10）+ AxesHelper(2)。
// 只读装配，粒子更新由调用方（sync.ts）在 tick 后推送。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildReference, loadReferenceTextures, loadTowerData, ReferenceType } from './reference';

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  resize(): void;
  /** 网格：size = 边长（block，1 block/格）；visible 只隐藏不销毁（避免重建抖动） */
  setGrid(size: number, visible: boolean): void;
  /** 参照物切换：type 变化时替换 group（旧组 dispose，防累积）；'none' → 卸载 */
  setReference(type: ReferenceType): void;
  dispose(): void;
}

const GRID_SIZE_COLOR = 0x3a4150;
const GRID_LINE_COLOR = 0x1c2130;

/** GridHelper 的边长不暴露属性，从 position 顶点数反推：
 * count = 4*(divisions+1)；本场景恒 divisions === size（1 block/格）。 */
export function gridSizeOf(g: THREE.GridHelper): number {
  return Math.floor((g.geometry.getAttribute('position').count / 4) - 1);
}

export function createScene(container: HTMLElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e14);

  // 参照物材质用 Lambert → 需要灯光（点云自带 shader，不受影响）
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  // 默认视角贴近游戏玩家观感（fov 对齐游戏默认 70、相机距原点 ~5.1 格）：
  // 游戏里玩家站粒子 1–5 格外，原 (6,5,8) 距 10.8 格会让粒子屏幕占比小 2–10 倍。
  const camera = new THREE.PerspectiveCamera(
    70,
    Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
    0.1,
    1000,
  );
  camera.position.set(3, 2, 4);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.update();

  let grid = new THREE.GridHelper(10, 10, GRID_SIZE_COLOR, GRID_LINE_COLOR);
  scene.add(grid);
  const axes = new THREE.AxesHelper(2);
  scene.add(axes);

  const resize = () => {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  // GridHelper 的边长不暴露属性，从 position 顶点数反推：
  // count = 4*(divisions+1)，且本场景 divisions === size（1 block/格）
  const gridSize = (g: THREE.GridHelper): number =>
    Math.floor((g.geometry.getAttribute('position').count / 4) - 1);

  const setGrid = (size: number, visible: boolean): void => {
    if (gridSize(grid) !== size) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      grid = new THREE.GridHelper(size, size, GRID_SIZE_COLOR, GRID_LINE_COLOR);
      scene.add(grid);
    }
    grid.visible = visible;
  };

  let refGroup: THREE.Group | null = null;
  let refEpoch = 0;
  const disposeRefGroup = (): void => {
    if (!refGroup) return;
    scene.remove(refGroup);
    refGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    refGroup = null;
  };
  const DEFAULT_CAM_POS = new THREE.Vector3(3, 2, 4);
  const DEFAULT_CAM_TARGET = new THREE.Vector3(0, 1, 0);

  /** 参照物入镜：相机沿当前视线方向拉远到覆盖包围盒（哨塔 21 格高，默认视角在塔内） */
  const fitCameraTo = (group: THREE.Group): void => {
    const b = new THREE.Box3().setFromObject(group);
    const size = b.getSize(new THREE.Vector3());
    const center = b.getCenter(new THREE.Vector3());
    if (size.lengthSq() === 0) return;
    const dir = camera.position.clone().sub(center);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.6, 1);
    dir.normalize();
    const dist = (size.length() / Math.sqrt(3)) * 2.4 + 2; // 对角线半径 ×2.4 + 留白
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
  };

  const resetCamera = (): void => {
    camera.position.copy(DEFAULT_CAM_POS);
    controls.target.copy(DEFAULT_CAM_TARGET);
    controls.update();
  };

  const setReference = (type: ReferenceType): void => {
    const epoch = ++refEpoch;
    disposeRefGroup();
    if (type === 'none') {
      resetCamera();
      return;
    }
    // 贴图 + 结构数据异步就绪后构建（epoch 判废：快速切换参照物时旧加载结果弃置）
    void Promise.all([loadReferenceTextures(), loadTowerData()]).then(([tex, tower]) => {
      if (epoch !== refEpoch) return;
      const g = buildReference(type, tex, tower);
      if (g) {
        scene.add(g);
        refGroup = g;
        fitCameraTo(g);
      }
    });
  };
  setReference('none');

  return {
    renderer,
    scene,
    camera,
    controls,
    resize,
    setGrid,
    setReference,
    dispose: () => {
      controls.dispose();
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      scene.remove(axes);
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
      if (refGroup) {
        scene.remove(refGroup);
        refGroup.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
          }
        });
      }
      refGroup = null;
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
