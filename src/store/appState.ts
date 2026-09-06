// M5 应用状态（计划 §九）：useSyncExternalStore 轻量外部 store，不引状态库。
//
// 双向同步以 `commands`（结构化命令数组）为唯一真源，文本是派生：
//   改表单 → setCommand → serialize → 粘贴框文本更新
//   改粘贴框 → applyInputText（parse 成功才写回真源；失败 → 命令不动 + toast
//   显示原文与错误，不强转）
//
// 执行语义与引擎一致（计划 §七时序）：「执行」按当前 commands 逐条 runCommand
// （命令级错误 toast、后续行继续）。tick*parameter 的后续 tick 生成由引擎内
// 部生成器队列驱动（命令执行时立即跑首批、余量排到后续 tick 初），播放循环
// 只负责 tickOnce——不需要重放命令。
//
// 热路径约定：引擎/播放状态放 App 的 ref，本 store 只承担 React 侧低频显示
// （HUD 数字 10Hz 轮询、toast、播放按钮高亮镜像、表单字段值）。

import { useSyncExternalStore } from 'react';
import { parseCommands } from '../command/parser';
import { serializeAll } from '../command/serialize';
import type {
  ParticleCommand,
  NormalCmd,
  ConditionalCmd,
  ParameterCmd,
  GroupCmd,
  ClearCmd,
  VanillaCmd,
} from '../command/types';
import type { SimConfig } from '../sim/types';

export interface AppState {
  /** 唯一真源：当前命令列表（表单编辑对象） */
  commands: ParticleCommand[];
  /** 粘贴框文本（派生自 commands；手动编辑期间可偏离，「应用」成功后重新对齐） */
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

// ---- 默认命令工厂（表单初始值 / 新增命令按钮）----

const zeroPos = () => ({ x: { v: 0, rel: false }, y: { v: 0, rel: false }, z: { v: 0, rel: false } });

export const DEFAULT_NORMAL: NormalCmd = {
  kind: 'normal',
  name: 'flame',
  pos: zeroPos(),
  color: { r: 1, g: 0.5, b: 0.2, a: 1 },
  speed: { x: 0, y: 0, z: 0 },
  range: { x: 0.4, y: 0.4, z: 0 },
  count: 600,
  age: 20,
  speedExpression: null,
  speedStep: 1.0,
  group: null,
};

export const DEFAULT_CONDITIONAL: ConditionalCmd = {
  kind: 'conditional',
  name: 'flame',
  pos: { ...zeroPos(), y: { v: 1, rel: false } },
  color: { r: 1, g: 1, b: 1, a: 1 },
  speed: { x: 0, y: 0, z: 0 },
  range: { x: 1, y: 1, z: 1 },
  expression: 'dis>1.5',
  step: 0.1,
  age: 0,
  speedExpression: null,
  speedStep: 1.0,
  group: null,
};

const DEFAULT_PARAMETER_COLOR = { r: 1, g: 0.9, b: 0.8, a: 1 };

export const DEFAULT_PARAMETER: ParameterCmd = {
  kind: 'parameter',
  polar: false,
  tick: false,
  rgba: false,
  name: 'flame',
  pos: { ...zeroPos(), y: { v: 0.5, rel: false } },
  color: DEFAULT_PARAMETER_COLOR,
  speed: { x: 0, y: 0, z: 0 },
  begin: 0,
  end: 12.56,
  expression: 'x,y,z=4*cos(t*0.2),0,4*sin(t*0.2)',
  step: 0.25,
  cpt: 10,
  age: 40,
  speedExpression: null,
  speedStep: 1.0,
  group: null,
};

export const DEFAULT_GROUP_CHANGE: GroupCmd = {
  kind: 'group',
  sub: 'change',
  type: 'parameter',
  group: 'g1',
  expression: 'x=5;cr=1;cg=0;cb=0;vx=0.2',
  conditionalExpression: null,
  pos: null,
};

export const DEFAULT_GROUP_REMOVE: GroupCmd = {
  kind: 'group',
  sub: 'remove',
  group: 'g1',
  expression: null,
  pos: null,
};

export const DEFAULT_CLEAR: ClearCmd = { kind: 'clearparticle' };

// 原版 /particle：name 必填；pos/delta/speed/count 为命令树槽位默认
// （null = 未给：pos→玩家位置、delta→0、speed→0、count→0 = 单粒子）
export const DEFAULT_VANILLA: VanillaCmd = {
  kind: 'vanilla',
  name: 'flame',
  pos: null,
  delta: null,
  speed: null,
  count: null,
  normal: false,
};

// parameter 变体名 ↔ (polar, tick, rgba)
const PARAM_NAMES: Record<string, [boolean, boolean, boolean]> = {
  parameter: [false, false, false],
  polarparameter: [true, false, false],
  tickparameter: [false, true, false],
  tickpolarparameter: [true, true, false],
  rgbaparameter: [false, false, true],
  rgbapolarparameter: [true, false, true],
  rgbatickparameter: [false, true, true],
  rgbatickpolarparameter: [true, true, true],
};

export function parameterVariantName(c: ParameterCmd): string {
  for (const [name, [polar, tick, rgba]] of Object.entries(PARAM_NAMES)) {
    if (polar === c.polar && tick === c.tick && rgba === c.rgba) return name;
  }
  return 'parameter';
}

export function makeParameter(variant: string): ParameterCmd {
  const [polar, tick, rgba] = PARAM_NAMES[variant] ?? PARAM_NAMES.parameter;
  return { ...structuredClone(DEFAULT_PARAMETER), polar, tick, rgba, color: rgba ? null : { ...DEFAULT_PARAMETER_COLOR } };
}

function defaultState(): AppState {
  const commands: ParticleCommand[] = [
    { ...structuredClone(DEFAULT_NORMAL), pos: { ...DEFAULT_NORMAL.pos, y: { v: 1, rel: false } } },
    structuredClone(DEFAULT_PARAMETER),
  ];
  return {
    commands,
    input: serializeAll(commands),
    sim: { playerPos: { x: 0, y: 0, z: 0 }, defaultLifetime: 20, maxParticles: 20000, seed: 1 },
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

/** 替换第 i 条命令（表单每次改动构造新对象传入），并重新派生文本 */
export function setCommand(i: number, cmd: ParticleCommand): void {
  const commands = state.commands.slice();
  commands[i] = cmd;
  set({ commands, input: serializeAll(commands) });
}

export function insertCommandAfter(i: number, cmd: ParticleCommand): void {
  const commands = state.commands.slice();
  commands.splice(i + 1, 0, cmd);
  set({ commands, input: serializeAll(commands) });
}

export function removeCommand(i: number): void {
  const commands = state.commands.slice();
  commands.splice(i, 1);
  set({ commands, input: serializeAll(commands) });
}

/** 粘贴框编辑（仅暂存文本，不动命令真源） */
export function setInputText(text: string): void {
  set({ input: text });
}

/** 「应用」：解析粘贴框 → 成功则写回命令真源并重新对齐文本；失败返回错误消息（命令不动） */
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
