// 集成验证（极简版）：粘贴 → 执行 → 播放条（播放/单步/重置/倍速）→ 模板库全流程。
// happy-dom 渲染真实 <App/>；SimViewport（WebGL）mock 掉——Three 路径由
// tests/render/points.test.ts 单元覆盖，这里聚焦 UI↔store↔引擎 联动。
// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../../src/App';
import { getState, replaceCommands, setInputText, setSim, setPlaying, setSpeed, clearToasts } from '../../src/store/appState';
import { serialize, serializeAll } from '../../src/command/serialize';
import { parseCommands } from '../../src/command/parser';
import { templateById, templateText } from '../../src/templates/library';
import { SimEngine } from '../../src/sim/engine';
import { checkCommandsFormat } from '../../src/command/gameFormat';
import { SimViewport } from '../../src/render/sync';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/render/sync', () => {
  const gridCalls: [number, boolean][] = [];
  return {
    SimViewport: class {
      static gridCalls = gridCalls;
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

const SIM_BASE = { playerPos: { x: 0, y: 0, z: 0 }, defaultLifetime: 20, maxParticles: 20000, seed: 1, mcVersion: '26.2', gridSize: 10, gridVisible: true, nativeKinematics: true };

let container: HTMLDivElement;
let root: Root;
/** 剪贴板替身（happy-dom 不提供 writeText）：记录最后一次写入内容 */
let clipboardText = '';

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
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
    expect(container.querySelector('.format-check.ok')!.textContent).toContain('可直接粘回游戏');
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

describe('播放条（播放 / 单步 / 重置 / 倍速）', () => {
  it('单步 → tick 推进', () => {
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 100\n');
    click(button('加入播放器'));
    const tickBefore = Number((container.querySelector('.hud')?.textContent?.match(/tick (\d+)/) ?? [])[1]);
    click(button('单步'));
    const tickAfter = Number((container.querySelector('.hud')?.textContent?.match(/tick (\d+)/) ?? [])[1]);
    expect(tickAfter).toBe(tickBefore + 1);
  });

  it('重置 → 粒子清零、tick 归零', () => {
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 100\n');
    click(button('加入播放器'));
    expect(container.querySelector('.hud')?.textContent).toContain('粒子 100');
    click(button('重置'));
    const hud = container.querySelector('.hud')!;
    expect(hud.textContent).toContain('tick 0');
    expect(hud.textContent).toContain('粒子 0');
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
    expect(cards.length).toBeGreaterThanOrEqual(10);
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
    setInputValue(search, '落叶');
    const cards = container.querySelectorAll('.template-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('落叶飘落');
    setInputValue(search, '原版 /particle');
    expect(container.querySelectorAll('.template-card').length).toBeGreaterThanOrEqual(3);
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
