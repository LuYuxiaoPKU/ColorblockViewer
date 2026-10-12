// 自由视角控制器单测：朝向反算、灵敏度/clamp、按键位移合成（速度、方向、Y 剔除、加速、下限）。
// 纯逻辑（不触 DOM/pointer lock），scene.ts 集成另由集成验证覆盖。

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FreeCameraController, FREE_MIN_Y, FREE_SPEED, FREE_SPEED_BOOST } from '../../src/render/freeCamera';

function cam(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  c.position.set(0, 1, 0);
  return c;
}

describe('FreeCameraController', () => {
  it('enter：从当前相机朝向反算 yaw/pitch（默认 -Z → yaw 0；向下看 → pitch 负）', () => {
    const c = cam();
    c.lookAt(0, -1, -1); // 朝 -Z 且俯视
    const f = new FreeCameraController();
    f.enter(c);
    expect(f.yaw).toBeCloseTo(0, 6);
    expect(f.pitch).toBeLessThan(0);
  });

  it('rotate：灵敏度换算弧度、pitch 限幅 ±90°', () => {
    const f = new FreeCameraController();
    f.yaw = 0;
    f.pitch = 0;
    f.rotate(500, 100); // 500px × 0.002 = 1 rad；100px × 0.002 = 0.2 rad
    expect(f.yaw).toBeCloseTo(-1, 6); // 鼠标右移 → 视线右转（yaw 减少）
    expect(f.pitch).toBeCloseTo(-0.2, 6); // 鼠标下移 → 视线下移
    f.pitch = Math.PI / 2 - 0.01;
    f.rotate(0, -1000); // 大幅上移 → clamp
    expect(f.pitch).toBeLessThan(Math.PI / 2);
  });

  it('update：W 仅水平前进（Y 剔除）、按住时间 × 速度', () => {
    const c = cam();
    const f = new FreeCameraController();
    f.yaw = 0;
    f.pitch = Math.PI / 4; // 朝上 45° 不影响水平移动
    f.press('KeyW');
    const dt = 1;
    f.update(c, dt);
    expect(c.position.x).toBeCloseTo(0, 6);
    expect(c.position.z).toBeCloseTo(-FREE_SPEED, 6); // yaw=0 前方 -Z
    expect(c.position.y).toBeCloseTo(1, 6); // 无升降键 → y 不动
  });

  it('update：A/D 左右平移（yaw=0 → 右 = +X）', () => {
    const c = cam();
    const f = new FreeCameraController();
    f.yaw = 0;
    f.press('KeyD');
    f.update(c, 0.5);
    expect(c.position.x).toBeCloseTo(FREE_SPEED * 0.5, 6);
    f.release('KeyD');
    f.press('KeyA');
    f.update(c, 0.5);
    expect(c.position.x).toBeCloseTo(0, 6);
  });

  it('update：Space/Shift 升降、y 下限 FREE_MIN_Y', () => {
    const c = cam();
    c.position.y = 0.05;
    const f = new FreeCameraController();
    f.press('KeyW');
    f.update(c, 1);
    expect(c.position.y).toBeCloseTo(FREE_MIN_Y, 6); // clamp 下限
    f.release('KeyW');
    f.press('Space');
    f.update(c, 0.5);
    expect(c.position.y).toBeCloseTo(FREE_MIN_Y + FREE_SPEED * 0.5, 6);
  });

  it('update：斜向移动归一化不超速、Shift 加速 ×3', () => {
    const c = cam();
    const f = new FreeCameraController();
    f.press('KeyW');
    f.press('KeyD');
    f.update(c, 1);
    const diag = Math.hypot(c.position.x, c.position.z);
    expect(diag).toBeCloseTo(FREE_SPEED, 6); // 斜向 = 1× 速度（归一化）
    f.release('KeyA');
    f.release('KeyD');
    f.clearKeys();
    f.press('KeyW');
    f.press('ShiftLeft');
    const before = c.position.clone();
    f.update(c, 1);
    expect(c.position.z - before.z).toBeCloseTo(-FREE_SPEED * FREE_SPEED_BOOST, 6); // W+Shift 增量
  });

  it('update：松开移动键 → 位置不变、仅应用旋转', () => {
    const c = cam();
    const f = new FreeCameraController();
    f.yaw = 0.3;
    f.pitch = 0.2;
    f.update(c, 1);
    expect(c.position.x).toBeCloseTo(0, 6);
    expect(c.position.z).toBeCloseTo(0, 6);
    expect(c.rotation.y).toBeCloseTo(0.3, 6);
    expect(c.rotation.x).toBeCloseTo(0.2, 6);
  });
});