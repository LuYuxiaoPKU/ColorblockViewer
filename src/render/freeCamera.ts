// 自由视角控制器（MC 旁观者式）：指针锁定转向 + WASD/Space/Shift/Ctrl 漫游。
// 按键对齐 MC 飞行模式默认键位：Space 上升、Shift 下降（潜行键语义）、
// Ctrl 加速（疾跑键语义）——曾把加速绑 Shift 与下降冲突。
// 纯状态机：不直接操作 DOM；由 scene.ts 接线（pointer lock 生命周期、按键事件、rAF dt）。
// 移动/灵敏度常量集中于此，实机微调只改这里。

import * as THREE from 'three';

export const FREE_SPEED = 8; // 格/秒（≈游戏奔跑）
export const FREE_SENSITIVITY = 0.002; // rad/px（鼠标位移 → 转角）
export const FREE_SPEED_BOOST = 3; // Ctrl 加速倍率
export const FREE_MIN_Y = 0.2; // 防陷地：y 相机的下限

/** 按键语义（MC 飞行模式默认键位）：keydown/keyup 接口（scene 转发 DOM 事件） */
export const FREE_KEYS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  up: 'Space',
  down: 'ShiftLeft',
} as const;

export class FreeCameraController {
  yaw = 0;
  pitch = 0;
  /** 当前按下的键集合（代码值，如 'KeyW'） */
  private readonly keys = new Set<string>();

  /** 进入自由模式：从当前相机朝向反算 yaw/pitch，过渡无跳变
   *  （相机默认朝 -Z：dir=(0,0,-1) → yaw=0；pitch 朝上为正）。 */
  enter(camera: THREE.PerspectiveCamera): void {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    this.keys.clear();
  }

  /** 指针锁定鼠标位移 → 转动（灵敏度常量；pitch 限 ±90°，防翻转） */
  rotate(dx: number, dy: number): void {
    this.yaw -= dx * FREE_SENSITIVITY;
    this.pitch -= dy * FREE_SENSITIVITY;
    const lim = Math.PI / 2 - 1e-3;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  /** 按键注册（scene 转发 keydown/keyup；重复 keydown 无副作用） */
  press(key: string): void {
    this.keys.add(key);
  }

  release(key: string): void {
    this.keys.delete(key);
  }

  clearKeys(): void {
    this.keys.clear();
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  /** 单帧推进：按键合成水平/垂直速度（Y 分量剔除的水平前进方向与相机朝向解耦），
   *  应用位移并写回相机旋转（YXZ）。返回相机移动后的位置（便于测试断言）。 */
  update(camera: THREE.PerspectiveCamera, dt: number): THREE.Vector3 {
    const f = (this.keys.has(FREE_KEYS.forward) ? 1 : 0) - (this.keys.has(FREE_KEYS.back) ? 1 : 0);
    const s = (this.keys.has(FREE_KEYS.right) ? 1 : 0) - (this.keys.has(FREE_KEYS.left) ? 1 : 0);
    const v = (this.keys.has(FREE_KEYS.up) ? 1 : 0) - (this.keys.has(FREE_KEYS.down) ? 1 : 0);
    if (f === 0 && s === 0 && v === 0) {
      camera.rotation.order = 'YXZ';
      camera.rotation.set(this.pitch, this.yaw, 0);
      return camera.position;
    }
    // 水平前进（Y 剔除）：yaw=0 朝向 -Z；右 = (cos yaw, 0, -sin yaw)（forward × up 验证）
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let mx = fx * f + rx * s;
    let mz = fz * f + rz * s;
    const hor = Math.hypot(mx, mz);
    if (hor > 1) {
      mx /= hor;
      mz /= hor;
    } // 斜向不超速
    // MC 疾跑键（Ctrl）加速；Shift 专属下降、不再兼加速
    const boost = this.keys.has('ControlLeft') || this.keys.has('ControlRight') ? FREE_SPEED_BOOST : 1;
    const step = FREE_SPEED * dt * boost;
    camera.position.x += mx * step;
    camera.position.z += mz * step;
    camera.position.y = Math.max(FREE_MIN_Y, camera.position.y + v * step);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
    return camera.position;
  }
}