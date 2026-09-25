// 应用状态：useSyncExternalStore 轻量外部 store，不引状态库。
//
// 单一输入路径（极简版）：粘贴框文本 → applyInputText（parse 成功才写回真源）→
// commands 结构化数组为唯一真源，文本是派生（serializeAll）。没有表单编辑路径——
// 「执行」前先 applyInputText，粘贴未应用的文本也能直接跑。
//
// 执行语义与引擎一致：「执行」按当前 commands 逐条 runCommand（命令级错误 toast、
// 后续行继续）。tick*parameter 的后续 tick 生成由引擎内部生成器队列驱动，播放
// 循环只负责 tickOnce——不需要重放命令。
//
// 热路径约定：引擎/播放状态放 App 的 ref，本 store 只承担 React 侧低频显示
// （HUD 数字 10Hz 轮询、toast、播放按钮高亮镜像）。

import { useSyncExternalStore } from 'react';
import { parseCommands } from '../command/parser';
import { serializeAll } from '../command/serialize';
import type { SharePayload } from '../share/encoding';
import type { ParticleCommand } from '../command/types';
import type { SimConfig } from '../sim/types';

export interface AppState {
  /** 唯一真源：当前命令列表（由粘贴框文本解析而来） */
  commands: ParticleCommand[];
  /** 粘贴框文本（派生自 commands；手动编辑期间可偏离，「执行」成功后重新对齐） */
  input: string;
  /** 仿真设置（SettingsDrawer 编辑；App 侧应用到引擎 ref） */
  sim: SimConfig;
  /** 播放镜像（按钮高亮用；rAF 循环读的是 App 的 ref，这里只供 UI 显示） */
  playing: boolean;
  speed: number;
  /** HUD：tick 数 / 活粒子数 / 累计丢弃（10Hz 轮询刷新） */
  hud: { tick: number; count: number; dropped: number };
  /** toast（引擎错误 / 解析失败），组件侧自动消失 */
  toasts: string[];
}

function defaultState(): AppState {
  return {
    commands: [],
    input: '',
    sim: { playerPos: { x: 0, y: 0, z: 0 }, defaultLifetime: 20, maxParticles: 20000, seed: 1, mcVersion: '26.2', gridSize: 10, gridVisible: true, nativeKinematics: true },
    playing: false,
    speed: 1,
    hud: { tick: 0, count: 0, dropped: 0 },
    toasts: [],
  };
}

let state: AppState = defaultState();
const listeners = new Set<() => void>();

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function getState(): AppState {
  return state;
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

// ---- 更新函数 ----

/** 整体替换命令列表（模板库「载入并执行」/ 一键清空 用） */
export function replaceCommands(cmds: ParticleCommand[]): void {
  const commands = cmds.slice();
  set({ commands, input: serializeAll(commands) });
}

/** 粘贴框编辑（仅暂存文本，不动命令真源） */
export function setInputText(text: string): void {
  set({ input: text });
}

/** 解析粘贴框 → 成功则写回命令真源并重新对齐文本；失败返回错误消息（命令不动） */
export function applyInputText(): string | null {
  try {
    const commands = parseCommands(state.input);
    set({ commands, input: serializeAll(commands) });
    return null;
  } catch (err) {
    const msg = (err as Error).message;
    set({ toasts: [...state.toasts, msg].slice(-5) });
    return msg;
  }
}

/** 分享链接还原（main.tsx 首渲染前调用）：?s= 载荷 → 命令真源 + 设置
 *  （sim 与当前默认合并，旧链接缺新字段时降级到默认） */
export function loadShared(p: SharePayload): void {
  set({
    commands: p.commands,
    input: serializeAll(p.commands),
    sim: { ...state.sim, ...p.sim },
  });
}

export function setPlaying(playing: boolean): void {
  set({ playing });
}

export function setSpeed(speed: number): void {
  set({ speed });
}

export function setSim(patch: Partial<SimConfig>): void {
  set({ sim: { ...state.sim, ...patch } });
}

export function setHud(hud: AppState['hud']): void {
  const h = state.hud;
  if (h.tick === hud.tick && h.count === hud.count && h.dropped === hud.dropped) return;
  set({ hud });
}

export function pushToast(msg: string): void {
  set({ toasts: [...state.toasts, msg].slice(-5) });
}

export function clearToasts(): void {
  if (state.toasts.length === 0) return;
  set({ toasts: [] });
}
