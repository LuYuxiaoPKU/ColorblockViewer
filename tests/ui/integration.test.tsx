// 集成验证（极简版）：粘贴 → 执行 → 播放条（播放/上一帧/下一帧/进度条/重置/倍速）→ 模板库全流程。
// happy-dom 渲染真实 <App/>；SimViewport（WebGL）mock 掉——Three 路径由
// tests/render/points.test.ts 单元覆盖，这里聚焦 UI↔store↔引擎 联动。
// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../../src/App';
import { getState, replaceCommands, setInputText, setSim, setPlaying, setSpeed, setPlayback, clearToasts } from '../../src/store/appState';
import { serialize, serializeAll } from '../../src/command/serialize';
import { parseCommands } from '../../src/command/parser';
import { templateById, templateText } from '../../src/templates/library';
import { SimEngine } from '../../src/sim/engine';
import { checkCommandsFormat } from '../../src/command/gameFormat';
import { SimViewport } from '../../src/render/sync';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/render/sync', () => {
  const gridCalls: [number, boolean][] = [];
  const progressState: {
    last: { onProgress: ((stage: string, frac: number, label?: string) => void) | null } | null;
  } = { last: null };
  return {
    SimViewport: class {
      static gridCalls = gridCalls;
      static progressState = progressState;
      /** 测试钩子：置 true 时构造抛异常（模拟 WebGL 上下文创建失败） */
      static throwOnConstruct = false;
      onProgress: ((stage: string, frac: number, label?: string) => void) | null = null;
      constructor() {
        if ((this.constructor as unknown as { throwOnConstruct: boolean }).throwOnConstruct) {
          throw new Error('THREE.WebGLRenderer: Error creating WebGL context.');
        }
        progressState.last = this;
      }
      update(): number {
        return 0;
      }
      get size(): number {
        return 900;
      }
      get fov(): number {
        return 50;
      }
      start() {}
      stop() {}
      resize() {}
      dispose() {}
      setSizeMul() {}
      setAlphaMul() {}
      setPointScale() {}
      setAtlasKey() {}
      setGrid(size: number, visible: boolean) {
        gridCalls.push([size, visible]);
      }
    },
  };
});

const SIM_BASE = { playerPos: { x: 0, y: 0, z: 0 }, defaultLifetime: 20, maxParticles: 20000, seed: 1, mcVersion: '26.2', gridSize: 10, gridVisible: true, nativeKinematics: true, renderMode: 'full' as const };

let container: HTMLDivElement;
let root: Root;
/** 剪贴板替身（happy-dom 不提供 writeText）：记录最后一次写入内容 */
let clipboardText = '';

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  (SimViewport as unknown as { throwOnConstruct: boolean }).throwOnConstruct = false;
});

beforeEach(async () => {
  clipboardText = '';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t: string) => {
        clipboardText = t;
        return Promise.resolve();
      },
    },
  });
  // store 是模块单例：每个用例前回到「空命令」的确定状态
  replaceCommands([]);
  setInputText('');
  setSim(SIM_BASE);
  setPlaying(false);
  setSpeed(1);
  setPlayback({ tick: 0, endTick: -1, oldestTick: 0, frames: 0, totalCopies: 0, maxTick: 0 });
  clearToasts();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  // 渲染层按需加载（App 动态 import render/sync）→ 等一拍让 viewport 建立，
  // 否则首帧后立刻断言的 viewport 调用（如 setGrid）还没发生
  await act(async () => {
    await Promise.resolve();
  });
});

function ta(): HTMLTextAreaElement {
  const el = container.querySelector('textarea');
  if (!el) throw new Error('textarea not found');
  return el;
}

function setValue(el: HTMLTextAreaElement, v: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(text: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text));
  if (!btn) throw new Error('button not found: ' + text);
  return btn as HTMLButtonElement;
}

/** aria-label 按钮（◀/▶/↺ 等无文字按钮） */
function byAria(label: string): HTMLButtonElement {
  const btn = container.querySelector('button[aria-label="' + label + '"]');
  if (!btn) throw new Error('button not found by aria-label: ' + label);
  return btn as HTMLButtonElement;
}

/** 某个容器内的按钮（模板卡片等局部查找） */
function buttonIn(scope: Element, text: string): HTMLButtonElement {
  const btn = [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text));
  if (!btn) throw new Error('button not found in scope: ' + text);
  return btn as HTMLButtonElement;
}

/** input 元素输入（React 受控组件需要原生 setter + input 事件） */
function setInputValue(el: HTMLInputElement, v: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** select 切换（React 受控 select 监听 change 事件） */
function setSelectValue(el: HTMLSelectElement, v: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('粘贴 → 执行', () => {
  it('初始：粘贴框为空（无默认命令）', () => {
    expect(ta().value).toBe('');
    expect(getState().commands).toEqual([]);
  });

  it('粘贴原版 /particle → 直接加入播放器 → HUD 有粒子（无需先应用）', () => {
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 37\n');
    click(button('加入播放器'));
    const cmds = getState().commands;
    expect(cmds.length).toBe(1);
    expect(cmds[0].kind).toBe('vanilla');
    expect(ta().value).toBe(serializeAll(cmds)); // 加入播放器后文本对齐真源
    const hud = container.querySelector('.hud');
    expect(hud?.textContent).toContain('粒子 37');
  });

  it('粘贴无法解析的命令 → 加入播放器报错（toast）且命令列表不动', () => {
    setValue(ta(), 'particleex normal broken\n');
    click(button('加入播放器'));
    expect(getState().commands).toEqual([]);
    expect(ta().value).toBe('particleex normal broken\n'); // 文本保留，用户可继续修改
    expect(getState().toasts.at(-1)).toMatch(/用法/);
    // 回归：曾双推（store 的 applyInputText 自推一条 + App.run 又推一条）
    // → 同一条错误占 toast 配额（slice(-5)）2 条
    expect(getState().toasts.filter((t) => /用法/.test(t))).toHaveLength(1);
  });

  it('用户真实指令（/ 前缀 + 单引号表达式）粘贴→执行 → 结构正确 + 回显保留斜杠', () => {
    const raw = "/particleex conditional minecraft:end_rod ~1 ~2 ~ 1 0.95 0.89 1 0 0 0 0.5 0.5 0.5 '(abs(y)==0.5&!(abs(z)<0.5))|(abs(x)==0.5&(!(abs(z)<0.5)|!(abs(y)<0.5)))' 0.1 20 'vy=0.05' 1.0 null\n";
    setValue(ta(), raw);
    click(button('加入播放器'));
    const c = getState().commands[0];
    expect(c.kind).toBe('conditional');
    if (c.kind !== 'conditional') return;
    expect(c.name).toBe('minecraft:end_rod');
    expect(c.pos.y).toEqual({ v: 2, rel: true });
    expect(c.expression).toBe("(abs(y)==0.5&!(abs(z)<0.5))|(abs(x)==0.5&(!(abs(z)<0.5)|!(abs(y)<0.5)))");
    expect(c.speedExpression).toBe('vy=0.05');
    expect(c.group).toBeNull();
    // 执行后 textarea 回写真源：斜杠保留（回归：曾「斜杠消失」）
    expect(ta().value).toBe(serializeAll(getState().commands));
    expect(ta().value.startsWith('/particleex conditional minecraft:end_rod')).toBe(true);
  });

  it('用户报告的完整命令：polarparameter 螺旋，粘贴后直接执行 → 201 粒子', () => {
    // begin=-10 end=10 step=0.1 → 201 个 t 值；y=2 半径 ~1 的圆环（end_rod 贴图）
    setValue(ta(), 'particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 -10 10 dis=1;s1=2*t;s2=0 0.1 20 i=0.1;(vx,vy,vz)=((i)*cos(s1),0,(i)*sin(s1)) 1 null\n');
    click(button('加入播放器'));
    expect(getState().commands.length).toBe(1);
    expect(getState().commands[0]?.kind).toBe('parameter');
    const hud = container.querySelector('.hud');
    expect(hud?.textContent).toContain('粒子 201');
  });

  it('格式检查面板：缺引号表达式 → ⚠️ 指明参数位；补上引号 → ✅', () => {
    const head = 'particleex conditional minecraft:end_rod ~ ~ ~ 1 0.95 0.89 1 0 0 0 8 0.6 8 ';
    const tail = ' 0.1 200 vy=0.05 1 null'; // step / age / 速度表达式 / speedStep / group
    setValue(ta(), head + '(abs(y-0.5)<0.05)&(sqrt(x^2+z^2)<8)' + tail);
    const bad = container.querySelector('.format-check.bad');
    expect(bad).toBeTruthy();
    expect(bad!.textContent).toContain('第 15 个参数'); // 条件表达式位
    expect(bad!.textContent).toContain('第 18 个参数'); // 速度表达式位
    expect(bad!.textContent).toContain('截断');

    setValue(ta(), head + "'(abs(y-0.5)<0.05)&(sqrt(x^2+z^2)<8)'" + ' 0.1 200 \'vy=0.05\' 1 null');
    expect(container.querySelector('.format-check.bad')).toBeNull();
    expect(container.querySelector('.format-check.ok')!.textContent).toContain('每行都符合游戏内 brigadier 格式');
  });

  it('缺引号表达式执行 → 真源保留原表达式 + 回显自动补单引号（引号不再消失）', () => {
    const head = 'particleex conditional minecraft:end_rod ~ ~ ~ 1 0.95 0.89 1 0 0 0 8 0.6 8 ';
    const tail = ' 0.1 200 vy=0.05 1 null';
    setValue(ta(), head + '(abs(y-0.5)<0.05)&(sqrt(x^2+z^2)<8)' + tail);
    click(button('加入播放器'));
    expect(getState().input).toContain("'(abs(y-0.5)<0.05)&(sqrt(x^2+z^2)<8)'");
    expect(getState().input).toContain("'vy=0.05'");
    expect(checkCommandsFormat(getState().input)).toEqual([]); // 回显本身即游戏内合法格式
  });
});

describe('播放条（播放 / 上一帧 / 下一帧 / 进度条 / 重置 / 倍速）', () => {
  it('未执行过命令：◀/▶ 与进度条禁用（无历史可回看）', () => {
    expect(byAria('上一帧').disabled).toBe(true);
    expect(byAria('下一帧').disabled).toBe(true);
    expect(container.querySelector('.tl-bar')?.className).toContain('disabled');
  });

  it('执行后（未播放）：进度条可用，右端 = 预估总时长（不再百万 tick 空白）', () => {
    // polarparameter 非 tick（100 个 t 值一 tick 同步生成）+ end_rod 显式 age 20
    // → 预估总时长 = 寿命 20 tick；旧口径「末帧 + 剩余拷贝预算」≈ 百万 tick
    setValue(ta(), "particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 0 6.2832 'dis=0.05;s1=t;s2=0' 0.0628 20 '(vx,vy,vz)=(0.25*exp(0-(t+0.5)/8)*cos(s1),0,0.25*exp(0-(t+0.5)/8)*sin(s1))' 1 null\n");
    click(button('加入播放器'));
    const p = getState().playback;
    expect(p.frames).toBe(1); // 执行即记录初始帧（未播放）
    expect(p.tick).toBe(0);
    expect(p.maxTick).toBe(20); // 右端 = 预估总时长（旧口径 ≈ 百万）
    expect(container.querySelector('.tl-bar')?.className).not.toContain('disabled');
    // 仅一帧：◀▶ 皆无处可去（播放后帧数增长，▶ 才可用——既有「逐帧导航」用例覆盖）
    expect(byAria('上一帧').disabled).toBe(true);
    expect(byAria('下一帧').disabled).toBe(true);
  });

  it('播放记录时间线；暂停后 ◀▶ 逐帧导航（fake timers 驱动 rAF）', () => {
    vi.useFakeTimers();
    try {
      setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 100\n');
      click(button('▶ 播放'));
      act(() => {
        vi.advanceTimersByTime(300); // 数个 tick（faked rAF 每 16ms 一帧）
      });
      const p = getState().playback;
      expect(p.frames).toBeGreaterThanOrEqual(3);
      expect(p.tick).toBe(p.endTick); // 播放中播放头恒在末帧
      // 条右端 = 末帧 tick + 剩余预算可录帧数：播放中滑块不贴最右（总时长大致稳定）
      expect(p.totalCopies).toBeGreaterThan(0);
      expect(p.endTick + Math.floor(p.totalCopies / p.frames)).toBeGreaterThan(p.tick);
      expect(byAria('下一帧').disabled).toBe(true); // 末帧上 ▶ 不可用
      act(() => {
        setPlaying(false);
      });
      const t0 = p.tick;
      // ◀ 回看（帧 tick 严格递增、每 tick 一帧 → 逐帧 -1）
      click(byAria('上一帧'));
      expect(getState().playback.tick).toBe(t0 - 1);
      click(byAria('上一帧'));
      expect(getState().playback.tick).toBe(t0 - 2);
      // ▶ 前进（沿引擎已推进的帧）
      click(byAria('下一帧'));
      expect(getState().playback.tick).toBe(t0 - 1);
      click(byAria('下一帧'));
      expect(getState().playback.tick).toBe(t0);
      // HUD 与场景同步到帧状态（flame 100 个、寿命 20 tick 内全活）
      expect(container.querySelector('.hud')!.textContent).toContain(`tick ${t0}`);
      expect(container.querySelector('.hud')!.textContent).toContain('粒子 100');
    } finally {
      vi.useRealTimers();
    }
  });

  it('重置 → 粒子清零、tick 归零', () => {
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 100\n');
    click(button('加入播放器'));
    expect(container.querySelector('.hud')?.textContent).toContain('粒子 100');
    click(byAria('重置'));
    const hud = container.querySelector('.hud')!;
    expect(hud.textContent).toContain('tick 0');
    expect(hud.textContent).toContain('粒子 0');
    expect(getState().playback.frames).toBe(0); // 重置后时间线清空
  });

  it('播放开关镜像 store.playing（画布播放条按钮高亮切换）', () => {
    const playBtn = container.querySelector('.playback-bar button')!;
    expect(playBtn.textContent).toContain('播放');
    click(playBtn);
    expect(getState().playing).toBe(true);
    const pauseBtn = container.querySelector('.playback-bar button')!;
    expect(pauseBtn.textContent).toContain('暂停');
    click(pauseBtn);
    expect(getState().playing).toBe(false);
  });

  it('倍速下拉 → store.speed 镜像（默认 1×）', () => {
    const sel = container.querySelector('select[aria-label="倍速"]') as HTMLSelectElement;
    expect(sel.value).toBe('1');
    setSelectValue(sel, '4');
    expect(getState().speed).toBe(4);
    expect(sel.value).toBe('4');
  });

  it('「▶ 播放」（粘贴框上）= 重置 + 执行 + 开始播放', async () => {
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 200\n');
    click(button('加入播放器'));
    expect(container.querySelector('.hud')!.textContent).toContain('粒子 200');
    // 一键开播：重置（tick 归零）+ 重新执行 + playing = true
    click(button('▶ 播放'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(getState().playing).toBe(true);
    const hud = container.querySelector('.hud')!;
    expect(hud.textContent).toContain('tick 0');
    expect(hud.textContent).toContain('粒子 200');
    // 收尾：停止播放，避免 rAF 循环影响后续用例
    act(() => {
      setPlaying(false);
    });
  });

  it('活粒子超过挂载期点云容量 → HUD「渲染截断」（挂载后调大上限再生成）', () => {
    // 点云容量在挂载时按 maxParticles（20000）固定；把上限调大到 21000 后
    // 生成 20001 → 活粒子 20001 > 容量 20000 → 截断提示
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 100\n');
    click(button('加入播放器'));
    expect(container.querySelector('.hud')!.textContent).not.toContain('渲染截断');
    act(() => {
      setSim({ maxParticles: 21000 });
    });
    click(byAria('重置'));
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 20001\n');
    click(button('加入播放器'));
    const hud = container.querySelector('.hud')!.textContent;
    expect(hud).toContain('粒子 20001');
    expect(hud).toContain('渲染截断');
  });

  it('播放中寿命耗尽 → 自动停止并停在最后一帧（无 toast；fake timers 驱动 rAF）', () => {
    vi.useFakeTimers();
    try {
      // smoke 零 delta 零速度 + 默认寿命 20 tick → 推进 1.5s（30 tick）后全部消亡 → 末帧
      setValue(ta(), 'particle smoke 0 2 0 0 0 0 0 10\n');
      click(button('▶ 播放'));
      expect(getState().playing).toBe(true);
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(getState().playing).toBe(false);
      // 停在最后一帧：HUD 末帧状态 + 时间线保留（可回看）
      expect(container.querySelector('.hud')!.textContent).toContain('粒子 0');
      const pb = getState().playback;
      expect(pb.frames).toBeGreaterThan(0);
      expect(pb.tick).toBe(pb.endTick);
      // 回归：自动停止不再推「已自动停止」toast
      expect(getState().toasts.filter((t) => t.includes('已自动停止'))).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('停在末帧再点「▶ 播放」= 从头重跑（tick 归零、粒子重新生成）', () => {
    vi.useFakeTimers();
    try {
      setValue(ta(), 'particle smoke 0 2 0 0 0 0 0 10\n');
      click(button('▶ 播放'));
      act(() => {
        vi.advanceTimersByTime(1500); // 播完 → 自动停止、停在末帧
      });
      expect(getState().playing).toBe(false);
      expect(getState().playback.tick).toBe(getState().playback.endTick);
      // 末帧再点播放（画布控制条按钮）→ playFresh：重置 + 执行 + 从头播放
      act(() => {
        click(container.querySelector('.playback-bar button')!);
      });
      expect(getState().playing).toBe(true);
      const hud = container.querySelector('.hud')!;
      expect(hud.textContent).toContain('tick 0');
      expect(hud.textContent).toContain('粒子 10');
      expect(getState().playback.tick).toBe(0);
      act(() => {
        setPlaying(false); // 收尾，避免 rAF 影响后续用例
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('播完后回拉进度条 → 已死亡粒子复现（末帧起活池已清空，帧拷贝须复活）', () => {
    vi.useFakeTimers();
    try {
      // 用户命令（polarparameter end_rod 螺旋，age 20）：推进 1.5s（30 tick）
      // 播完 → 自动停止、活池清空（末帧粒子 0）。回拉进度条中部（≈tick 10）：
      // 帧拷贝粒子 alive=false，若不复活则渲染层拿到空列表（HUD 计数有值、
      // 画面空 —— 用户报「回拉进度条粒子不会复现」）。
      setValue(ta(), "particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 0 6.2832 'dis=0.05;s1=t;s2=0' 0.0628 20 '(vx,vy,vz)=(0.25*exp(0-(t+0.5)/8)*cos(s1),0,0.25*exp(0-(t+0.5)/8)*sin(s1))' 1 null\n");
      click(button('▶ 播放'));
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(getState().playing).toBe(false);
      expect(getState().playback.tick).toBe(getState().playback.endTick);
      // 末帧：粒子全部死亡
      expect(container.querySelector('.hud')!.textContent).toContain('粒子 0');
      // 回拉进度条中部（pointerdown → seek）→ 帧拷贝复活 → 粒子复现。
      // happy-dom 的 getBoundingClientRect 全零 → mock 固定矩形（宽 200px）
      const bar = container.querySelector('.tl-bar')!;
      const rectMock = vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({
        left: 100, top: 0, right: 300, bottom: 10, width: 200, height: 10, x: 100, y: 0, toJSON: () => ({}),
      } as DOMRect);
      try {
        act(() => {
          bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200 }));
          bar.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 200 }));
        });
      } finally {
        rectMock.mockRestore();
      }
      const pb = getState().playback;
      expect(pb.tick).toBeGreaterThan(0);
      expect(pb.tick).toBeLessThan(pb.endTick);
      const hud = container.querySelector('.hud')!;
      expect(hud.textContent).toContain(`tick ${pb.tick}`);
      expect(hud.textContent).toContain('粒子 10');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('设置与视口联动', () => {
  it('网格设置 → viewport.setGrid(size, visible) 随 sim 驱动', () => {
    const Mock = SimViewport as unknown as { gridCalls: [number, boolean][] };
    const before = Mock.gridCalls.length; // 挂载时已按默认 (10, true) 调过
    act(() => setSim({ gridSize: 50 }));
    act(() => setSim({ gridVisible: false }));
    expect(Mock.gridCalls.slice(-2)).toEqual([[50, true], [50, false]]);
    expect(before).toBeGreaterThanOrEqual(1);
  });
});

describe('模板库（复制命令 / 载入并执行）', () => {
  it('展开列出模板，每卡两个按钮；已删按钮不存在', () => {
    click(button('模板库'));
    const cards = container.querySelectorAll('.template-card');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    for (const card of cards) {
      expect(buttonIn(card, '复制命令')).toBeTruthy();
      expect(buttonIn(card, '载入并执行')).toBeTruthy();
    }
    expect(container.textContent).not.toContain('载入到命令列表');
    expect(container.textContent).not.toContain('复制链接');
  });

  it('复制命令写剪贴板并 toast', async () => {
    click(button('模板库'));
    const cards = container.querySelectorAll('.template-card');
    click(buttonIn(cards[0], '复制命令'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(clipboardText).toContain('/particleex');
    expect(getState().toasts.at(-1)).toContain('已复制到剪贴板');
  });

  it('搜索按名称/标签过滤', () => {
    click(button('模板库'));
    const search = container.querySelector('.template-search') as HTMLInputElement;
    setInputValue(search, '涟漪');
    const cards = container.querySelectorAll('.template-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('涟漪波面');
    setInputValue(search, 'end_rod');
    expect(container.querySelectorAll('.template-card').length).toBe(2);
    setInputValue(search, '不存在的模板');
    expect(container.querySelectorAll('.template-card').length).toBe(0);
  });

  it('入口在命令区（与「加入播放器」同一区块）；Esc 关闭、面板内点击不关闭', () => {
    const section = container.querySelector('.pane-section')!;
    expect(buttonIn(section, '模板库')).toBeTruthy();
    expect(buttonIn(section, '加入播放器')).toBeTruthy();
    expect(buttonIn(section, '一键清空')).toBeTruthy();

    click(buttonIn(section, '模板库'));
    const sheet = container.querySelector('.gallery-sheet');
    expect(sheet).toBeTruthy();

    // 面板内点击（搜索框）不应关闭
    act(() => {
      (container.querySelector('.template-search') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(container.querySelector('.gallery-sheet')).toBeTruthy();

    // Esc 关闭
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('.gallery-sheet')).toBeNull();
  });

  it('「载入并执行」= 清空原有命令与粒子后执行（不叠加旧命令/旧粒子）', () => {
    // 先跑一条命令 → 暂停在“有粒子”的状态
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 100\n');
    click(button('加入播放器'));
    expect(container.querySelector('.hud')!.textContent!).not.toContain('粒子 0');

    const tpl = templateById('ring')!;
    const ref = new SimEngine({ ...getState().sim, seed: 1, nativeKinematics: true });
    let expected = 0;
    for (const c of parseCommands(templateText(tpl))) expected += ref.runCommand(c).spawned;

    click(button('模板库'));
    const card = [...container.querySelectorAll('.template-card')].find((c) =>
      c.textContent?.includes('圆周环'),
    )!;
    click(buttonIn(card, '载入并执行'));

    // ① 命令列表 = 模板本身（旧的命令已清空）
    expect(getState().commands.map(serialize)).toEqual(
      parseCommands(templateText(tpl)).map(serialize),
    );
    // ② 粒子只剩模板生成的（引擎回放重置过：HUD 计数 = 模板单独跑的结果）
    expect(container.querySelector('.hud')!.textContent).toContain(`粒子 ${expected}`);
    expect(getState().toasts.at(-1)).toContain('已清空原有命令与粒子');
  });
});

describe('一键清空', () => {
  it('命令输入框清空 + 画面粒子清掉', () => {
    // 先跑一遍命令 → 有粒子
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 100\n');
    click(button('加入播放器'));
    expect(container.querySelector('.hud')!.textContent).toContain('粒子 100');

    click(button('一键清空'));
    expect(getState().commands).toEqual([]);
    expect(ta().value).toBe('');
    expect(container.querySelector('.hud')!.textContent).toContain('粒子 0');
    expect(getState().toasts.at(-1)).toContain('已清空命令输入框与画面粒子');
    // 清空后仍可从模板库载入（面板入口还在）
    click(button('模板库'));
    const card = container.querySelectorAll('.template-card')[0];
    click(buttonIn(card, '载入并执行'));
    expect(getState().commands.length).toBeGreaterThan(0);
  });
});

describe('首帧预热进度（App ↔ 视口 onProgress 通道）', () => {
  // 回归锁定：App 无条件安装 onProgress（曾因 `if (vp.onProgress)` 读到默认
  // null 整体跳过安装 → 进度条永卡「加载渲染核心…」，fe2056d 修复）。

  it('完整模式：视口建立后 App 安装 onProgress（无条件安装）', () => {
    const vp = (SimViewport as unknown as { progressState: { last: { onProgress: unknown } | null } })
      .progressState.last;
    expect(vp).toBeTruthy();
    expect(typeof vp!.onProgress).toBe('function');
  });

  it('完整模式：atlas → ready 进度链 → 视口覆盖进度条 → 就绪后淡出卸载', async () => {
    vi.useFakeTimers();
    try {
      const vp = (SimViewport as unknown as { progressState: { last: { onProgress: ((stage: string, frac: number, label?: string) => void) | null } | null } })
        .progressState.last!;
      // 加载贴图 3/3（frac=1 → label 切「编译着色器」）
      act(() => {
        vp.onProgress!('atlas', 1, '加载贴图 3/3');
      });
      const bar = container.querySelector('.vp-progress');
      expect(bar).toBeTruthy();
      expect(bar!.textContent).toContain('编译着色器');
      expect((bar!.querySelector('.vp-progress-fill') as HTMLElement).style.width).toBe('90%');
      // 着色器编译完成 → 「就绪」+ 400ms 淡出后卸载（450ms 时已卸载）
      act(() => {
        vp.onProgress!('ready', 1);
      });
      expect(container.querySelector('.vp-progress')!.textContent).toContain('就绪');
      // ready 后迟到的 atlas 进度被忽略（双保险：sync 层 readyReported 已源头
      // 拦截，App 层再挡一道）→ 进度条不因迟到进度回跳「加载贴图」
      act(() => {
        vp.onProgress!('atlas', 0.5, '加载贴图 1/2');
      });
      expect(container.querySelector('.vp-progress')!.textContent).toContain('就绪');
      act(() => {
        vi.advanceTimersByTime(450);
      });
      expect(container.querySelector('.vp-progress')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('快速模式（Canvas 2D）：无预热阶段 → 进度条不出现', async () => {
    act(() => {
      setSim({ renderMode: 'fast' });
    });
    await act(async () => {
      await Promise.resolve();
    });
    // render2d 的 onProgress 是空操作字段：App 安装后无任何上报
    expect(container.querySelector('.vp-progress')).toBeNull();
  });

  it('卸载完整视口时 onProgress 置 null（dispose 后迟到 ready 不再污染新挂载）', async () => {
    // 回归：完整模式编译在途时切快速模式（或 StrictMode 双挂载）→ 旧视口
    // compileAsync 的 .then 在 dispose 后仍可执行，若 onProgress 未断开则
    // onProgress('ready') 污染新挂载的 readyRef/进度条。App cleanup 须置 null。
    const SV = SimViewport as unknown as {
      progressState: { last: { onProgress: unknown } | null };
    };
    expect(typeof SV.progressState.last!.onProgress).toBe('function'); // 挂载后已安装
    act(() => setSim({ renderMode: 'fast' })); // 卸载完整视口 → cleanup
    await act(async () => { await Promise.resolve(); });
    expect(SV.progressState.last!.onProgress).toBeNull(); // 已断链
  });

  it('完整模式 WebGL 构造抛错 → 降级快速模式（toast + 无进度条，不永卡「加载渲染核心」）', async () => {
    // 回归：three r185 的 WebGLRenderer 无 WebGL2 时构造直接抛异常（非 getContext
    // null）。App 须在 make() 外包 try/catch，降级快速模式——否则未处理 rejection
    // + 视口永不建立 + 进度条永卡「加载渲染核心」（引擎照常跑但画面空白无提示）。
    const SV = SimViewport as unknown as { throwOnConstruct: boolean };
    // 先切快速模式卸载现有完整视口，再切回完整模式触发重建（构造抛错）
    act(() => setSim({ renderMode: 'fast' }));
    await act(async () => { await Promise.resolve(); });
    SV.throwOnConstruct = true;
    act(() => setSim({ renderMode: 'full' }));
    // effect → import sync → make 抛错 → catch → setSim(fast)；多拍让 microtask 链跑完
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
    expect(getState().sim.renderMode).toBe('fast'); // 已自动降级
    expect(getState().toasts.at(-1)).toContain('降级');
    expect(container.querySelector('.vp-progress')).toBeNull(); // 无永卡进度条
  });
});

describe('大场景卡顿预警（2026-10-09 浏览器实测依据：完整模式 1M 每帧 JS 侧 ~80–120ms）', () => {
  it('full 模式执行 ≥20 万粒子 → 提示可切换快速模式', () => {
    act(() => setSim({ maxParticles: 300000, renderMode: 'full' }));
    setValue(ta(), 'particleex normal flame 0 0 0 1 1 1 1 0 0 0 0 0 0 200000\n');
    click(button('加入播放器'));
    expect(getState().toasts.at(-1)).toMatch(/粒子较多.*快速模式/);
  });

  it('快速模式同规模不提示（无 WebGL 上传，无需引导）', () => {
    act(() => setSim({ maxParticles: 300000, renderMode: 'fast' }));
    setValue(ta(), 'particleex normal flame 0 0 0 1 1 1 1 0 0 0 0 0 0 200000\n');
    click(button('加入播放器'));
    expect(getState().toasts.filter((t) => /粒子较多/.test(t))).toHaveLength(0);
  });

  it('小场景不提示', () => {
    act(() => setSim({ maxParticles: 300000, renderMode: 'full' }));
    setValue(ta(), 'particleex normal flame 0 0 0 1 1 1 1 0 0 0 0 0 0 5\n');
    click(button('加入播放器'));
    expect(getState().toasts.filter((t) => /粒子较多/.test(t))).toHaveLength(0);
  });
});
