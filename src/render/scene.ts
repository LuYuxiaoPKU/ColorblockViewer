// 场景装配（计划 §八）：深色背景 + PerspectiveCamera + OrbitControls（Y 向上）
// + GridHelper@y=0（1 block 格，大小/显示可配，默认 10）+ AxesHelper(2)。
// 只读装配，粒子更新由调用方（sync.ts）在 tick 后推送。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  resize(): void;
  /** 网格：size = 边长（block，1 block/格）；visible 只隐藏不销毁（避免重建抖动） */
  setGrid(size: number, visible: boolean): void;
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

  const camera = new THREE.PerspectiveCamera(
    50,
    Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
    0.1,
    1000,
  );
  camera.position.set(6, 5, 8);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.update();

  let grid = new THREE.GridHelper(10, 10, GRID_SIZE_COLOR, GRID_LINE_COLOR);
  scene.add(grid);
  scene.add(new THREE.AxesHelper(2));

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

  return {
    renderer,
    scene,
    camera,
    controls,
    resize,
    setGrid,
    dispose: () => {
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
