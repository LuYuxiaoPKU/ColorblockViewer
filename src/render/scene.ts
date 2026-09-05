// 场景装配（计划 §八）：深色背景 + PerspectiveCamera + OrbitControls（Y 向上）
// + GridHelper(10,10)@y=0（1 block 格）+ AxesHelper(2)。
// 只读装配，粒子更新由调用方（sync.ts）在 tick 后推送。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  resize(): void;
  dispose(): void;
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

  scene.add(new THREE.GridHelper(10, 10, 0x3a4150, 0x1c2130));
  scene.add(new THREE.AxesHelper(2));

  const resize = () => {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  return {
    renderer,
    scene,
    camera,
    controls,
    resize,
    dispose: () => {
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
