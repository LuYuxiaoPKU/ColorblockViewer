// M5 集成验证（计划 §十二 M5：粘贴→自动填表→改表→文本更新→播放全流程）。
// happy-dom 渲染真实 <App/>；SimViewport（WebGL）mock 掉——Three 路径由
// tests/render/points.test.ts 单元覆盖，这里聚焦 UI↔store↔引擎 联动。
// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../../src/App';
import { getState, setCommand, removeCommand } from '../../src/store/appState';
import { serializeAll } from '../../src/command/serialize';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/render/sync', () => ({
  SimViewport: class {
    update(): number {
      return 0;
    }
    start() {}
    stop() {}
    resize() {}
    dispose() {}
    setSizeMul() {}
    setAlphaMul() {}
  },
}));

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

beforeEach(() => {
  // store 是模块单例：每个用例前回到单条 normal 命令的确定状态
  while (getState().commands.length > 0) removeCommand(0);
  setCommand(0, {
    kind: 'normal',
    name: 'flame',
    pos: { x: { v: 0, rel: false }, y: { v: 1, rel: false }, z: { v: 0, rel: false } },
    color: { r: 1, g: 0.5, b: 0.2, a: 1 },
    speed: { x: 0, y: 0, z: 0 },
    range: { x: 0.4, y: 0.4, z: 0 },
    count: 100,
    age: 20,
    speedExpression: null,
    speedStep: 1.0,
    group: null,
  } as never);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<App />);
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

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('M5 全流程', () => {
  it('初始：粘贴框文本 = commands 序列化（真源派生）', () => {
    expect(ta().value).toBe(serializeAll(getState().commands));
  });

  it('粘贴 → 应用 → 表单字段自动填充', () => {
    setValue(ta(), 'particleex normal smoke 0 2 0 0.2 0.9 1 0.5 0.5 0.5 3 0.5 0.5 0 42 15 "vy=0.1" 1 g9\n');
    click(button('应用'));
    const cmds = getState().commands;
    expect(cmds.length).toBe(1);
    const c = cmds[0];
    expect(c.kind).toBe('normal');
    if (c.kind !== 'normal') return;
    expect(c.name).toBe('smoke');
    expect(c.count).toBe(42);
    expect(c.age).toBe(15);
    expect(c.speedExpression).toBe('vy=0.1');
    expect(c.group).toBe('g9');
    // 文本重新对齐 canonical 形式
    expect(ta().value).toBe(serializeAll(cmds));
    // 表单里数量框显示 42
    const countInput = [...container.querySelectorAll('.numfield input')].find(
      (i) => i.closest('.numfield')?.querySelector('.numfield-label')?.textContent === '数量',
    ) as HTMLInputElement | undefined;
    expect(countInput?.value).toBe('42');
  });

  it('改表 → 文本更新（双向同步反向）', () => {
    // 直接改 store 模拟表单提交（CommandForm 的 setCommand 路径同此）
    const c = getState().commands[0];
    expect(c.kind).toBe('normal');
    if (c.kind !== 'normal') return;
    act(() => {
      setCommand(0, { ...c, count: 777 });
    });
    expect(ta().value).toContain('777');
  });

  it('粘贴无法结构化 → 命令不动 + 错误显示', () => {
    const before = getState().commands;
    setValue(ta(), 'particleex normal broken\n');
    click(button('应用'));
    expect(getState().commands).toEqual(before);
    expect(container.textContent).toMatch(/用法/);
  });

  it('执行 → 引擎生成粒子 → HUD 显示数量', () => {
    click(button('执行'));
    // 默认命令 count=100 → HUD 「粒子 100」
    const hud = container.querySelector('.hud');
    expect(hud?.textContent).toContain('粒子 100');
  });

  it('单步 → tick 推进', () => {
    click(button('执行'));
    const hud = container.querySelector('.hud')!;
    const tickBefore = Number((hud.textContent?.match(/tick (\d+)/) ?? [])[1]);
    click(button('单步'));
    const tickAfter = Number((container.querySelector('.hud')?.textContent?.match(/tick (\d+)/) ?? [])[1]);
    expect(tickAfter).toBe(tickBefore + 1);
  });

  it('重置 → 粒子清零、tick 归零', () => {
    click(button('执行'));
    expect(container.querySelector('.hud')?.textContent).toContain('粒子 100');
    click(button('回放重置'));
    const hud = container.querySelector('.hud')!;
    expect(hud.textContent).toContain('tick 0');
    expect(hud.textContent).toContain('粒子 0');
  });

  it('播放开关镜像 store.playing（按钮高亮切换）', () => {
    const playBtn = button('播放');
    expect(playBtn.textContent).toContain('播放');
    click(playBtn);
    expect(getState().playing).toBe(true);
    expect(button('暂停').textContent).toContain('暂停');
    click(button('暂停'));
    expect(getState().playing).toBe(false);
  });
});
