// M5 集成验证（计划 §十二 M5：粘贴→自动填表→改表→文本更新→播放全流程）。
// happy-dom 渲染真实 <App/>；SimViewport（WebGL）mock 掉——Three 路径由
// tests/render/points.test.ts 单元覆盖，这里聚焦 UI↔store↔引擎 联动。
// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../../src/App';
import { getState, setCommand, removeCommand, setSim, DEFAULT_VANILLA } from '../../src/store/appState';
import { serializeAll } from '../../src/command/serialize';
import { PARTICLE_DATA } from '../../src/render/particleData';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/render/sync', () => ({
  SimViewport: class {
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

  it('粘贴原版 /particle → 解析成功 + 文本对齐 + 执行后 HUD 有粒子', () => {
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 37\n');
    click(button('应用'));
    const cmds = getState().commands;
    expect(cmds.length).toBe(1);
    expect(cmds[0].kind).toBe('vanilla');
    expect(ta().value).toBe(serializeAll(cmds));
    click(button('执行'));
    const hud = container.querySelector('.hud');
    expect(hud?.textContent).toContain('粒子 37');
  });

  it('粘贴原版命令（~ 相对坐标）→ 真源结构正确', () => {
    setValue(ta(), 'particle heart ~ ~1 ~\n');
    click(button('应用'));
    expect(getState().commands[0].kind).toBe('vanilla');
    const c = getState().commands[0];
    if (c.kind !== 'vanilla') return;
    expect(c.name).toBe('heart');
    expect(c.pos).toEqual({ x: { v: 0, rel: true }, y: { v: 1, rel: true }, z: { v: 0, rel: true } });
  });

  it('vanilla 表单渲染：粒子名下拉 + 槽位添加按钮', () => {
    act(() => {
      setCommand(0, { ...structuredClone(DEFAULT_VANILLA), name: 'smoke' });
    });
    // 标题
    expect(container.textContent).toContain('particle（原版）');
    // 类型名下拉（datalist 含 26.2 注册表类型）
    const nameInput = [...container.querySelectorAll('input')].find(
      (i) => i.closest('label')?.querySelector('.numfield-label')?.textContent?.startsWith('粒子类型名'),
    ) as HTMLInputElement | undefined;
    expect(nameInput).toBeTruthy();
    expect(nameInput!.value).toBe('smoke');
    const dl = document.getElementById(nameInput!.getAttribute('list')!);
    const opts = [...(dl?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'));
    expect(opts).toContain('end_rod');
    expect(opts).toContain('ambient_entity_effect');
    expect(opts.length).toBeGreaterThanOrEqual(120);
    // 空槽位 → 「+ 添加」按钮
    expect(button('+ 添加 pos')).toBeTruthy();
    expect(button('+ 添加 delta')).toBeTruthy();
  });

  it('vanilla 表单：游戏版本切换 → 粒子名下拉与标签按版本分区', () => {
    act(() => {
      setCommand(0, { ...structuredClone(DEFAULT_VANILLA), name: 'smoke' });
    });
    const findNameInput = () =>
      [...container.querySelectorAll('input')].find(
        (i) => i.closest('label')?.querySelector('.numfield-label')?.textContent?.startsWith('粒子类型名'),
      ) as HTMLInputElement;
    // 默认 26.2
    let dl = document.getElementById(findNameInput().getAttribute('list')!);
    let opts = [...(dl?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'));
    expect(container.textContent).toContain('粒子类型名（26.2 注册表，支持 type{NBT}）');
    expect(opts).toContain('ambient_entity_effect');
    // 切到 1.21.11：下拉换成 1.21.11 注册表（26.2 独有类型消失）
    act(() => setSim({ mcVersion: '1.21.11' }));
    dl = document.getElementById(findNameInput().getAttribute('list')!);
    opts = [...(dl?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'));
    expect(container.textContent).toContain('粒子类型名（1.21.11 注册表，支持 type{NBT}）');
    expect(opts.length).toBe(PARTICLE_DATA['1.21.11'].types.length);
    expect(opts).toContain('end_rod');
    // 26.2 独有类型在 1.21.11 下拉里消失（注册表随版本增长）
    const onlyIn262 = PARTICLE_DATA['26.2'].types.filter(
      (t) => !PARTICLE_DATA['1.21.11'].types.includes(t),
    );
    expect(onlyIn262.length).toBeGreaterThan(0);
    expect(opts).not.toContain(onlyIn262[0]);
    // 切回 26.2（后续用例基线）
    act(() => setSim({ mcVersion: '26.2' }));
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
