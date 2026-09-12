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
import { checkCommandsFormat } from '../../src/command/gameFormat';
import { SimViewport } from '../../src/render/sync';
import { PARTICLE_DATA } from '../../src/render/particleData';

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

  it('粘贴未点「应用」直接点「执行」→ 新粘贴命令生效（而非旧 commands）', () => {
    // 回归：执行按钮曾在未应用文本时直接跑旧真源 → 粘贴的命令「不生效」
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 37\n');
    expect(getState().commands[0]?.kind).toBe('normal'); // 尚未应用
    click(button('执行'));
    expect(ta().value).toBe(serializeAll(getState().commands)); // 执行后文本对齐真源
    const hud = container.querySelector('.hud');
    expect(hud?.textContent).toContain('粒子 37'); // 而非默认 normal 的 100
  });

  it('用户真实指令（/ 前缀 + 单引号表达式）粘贴→应用→回显保留斜杠', () => {
    const raw = "/particleex conditional minecraft:end_rod ~1 ~2 ~ 1 0.95 0.89 1 0 0 0 0.5 0.5 0.5 '(abs(y)==0.5&!(abs(z)<0.5))|(abs(x)==0.5&(!(abs(z)<0.5)|!(abs(y)<0.5)))' 0.1 20 'vy=0.05' 1.0 null\n";
    setValue(ta(), raw);
    click(button('应用'));
    const c = getState().commands[0];
    expect(c.kind).toBe('conditional');
    if (c.kind !== 'conditional') return;
    expect(c.name).toBe('minecraft:end_rod');
    expect(c.pos.y).toEqual({ v: 2, rel: true });
    expect(c.expression).toBe("(abs(y)==0.5&!(abs(z)<0.5))|(abs(x)==0.5&(!(abs(z)<0.5)|!(abs(y)<0.5)))");
    expect(c.speedExpression).toBe('vy=0.05');
    expect(c.group).toBeNull();
    // 应用后 textarea 回写真源：斜杠保留（回归：曾「斜杠消失」）
    expect(ta().value).toBe(serializeAll(getState().commands));
    expect(ta().value.startsWith('/particleex conditional minecraft:end_rod')).toBe(true);
  });

  it('用户报告的完整命令：polarparameter 螺旋，粘贴后直接执行 → 201 粒子', () => {
    // begin=-10 end=10 step=0.1 → 201 个 t 值；y=2 半径 ~1 的圆环（end_rod 贴图）
    setValue(ta(), 'particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 -10 10 dis=1;s1=2*t;s2=0 0.1 20 i=0.1;(vx,vy,vz)=((i)*cos(s1),0,(i)*sin(s1)) 1 null\n');
    click(button('执行'));
    expect(getState().commands.length).toBe(1);
    expect(getState().commands[0]?.kind).toBe('parameter');
    const hud = container.querySelector('.hud');
    expect(hud?.textContent).toContain('粒子 201');
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

  it('vanilla 表单：粒子类型名行尾保真度角标（✅ 已核对 / ⚠️ 近似 / ❌ 未收录）', () => {
    act(() => {
      setCommand(0, { ...structuredClone(DEFAULT_VANILLA), name: 'end_rod' });
    });
    const badge = () => container.querySelector('.field-badge')?.textContent ?? '';
    expect(badge()).toContain('已核对'); // 26.2 运动学表内
    act(() => {
      setCommand(0, { ...structuredClone(DEFAULT_VANILLA), name: 'firefly' });
    });
    expect(badge()).toContain('近似'); // 注册表内但运动学未逐条核对（approx 清单）
    act(() => {
      setCommand(0, { ...structuredClone(DEFAULT_VANILLA), name: 'no_such_type' });
    });
    expect(badge()).toContain('未收录');
    // 切到 1.21.11：end_rod 仍是唯一表内类型（§10 证据边界）；smoke 在 26.2
    // 表内但 1.21.11 分区无表项 → 近似（版本分区生效）
    act(() => setSim({ mcVersion: '1.21.11' }));
    act(() => {
      setCommand(0, { ...structuredClone(DEFAULT_VANILLA), name: 'end_rod' });
    });
    expect(badge()).toContain('已核对');
    act(() => {
      setCommand(0, { ...structuredClone(DEFAULT_VANILLA), name: 'smoke' });
    });
    expect(badge()).toContain('近似');
    act(() => setSim({ mcVersion: '26.2' }));
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
    // 未超容量 → 无截断提示
    expect(hud?.textContent).not.toContain('渲染截断');
  });

  it('活粒子数超过缓冲容量 → HUD 显示「渲染截断」', () => {
    // 缓冲容量在挂载时按当时 maxParticles（默认 20000）固定；运行期调高上限
    // 不会扩容缓冲，超出部分不渲染（syncToPoints 截断）→ 需要提示
    act(() => setSim({ maxParticles: 25000 }));
    setValue(ta(), 'particle flame 0 2 0 0.5 0.5 0.5 0.3 10050\nparticle flame 0 2 0 0.5 0.5 0.5 0.3 10050\n');
    click(button('应用'));
    click(button('执行'));
    const hud = container.querySelector('.hud');
    expect(hud?.textContent).toContain('粒子 20100');
    expect(hud?.textContent).toContain('渲染截断');
  });

  it('网格设置 → viewport.setGrid(size, visible) 随 sim 驱动', () => {
    const Mock = SimViewport as unknown as { gridCalls: [number, boolean][] };
    const before = Mock.gridCalls.length; // 挂载时已按默认 (10, true) 调过
    act(() => setSim({ gridSize: 50 }));
    act(() => setSim({ gridVisible: false }));
    expect(Mock.gridCalls.slice(-2)).toEqual([[50, true], [50, false]]);
    expect(before).toBeGreaterThanOrEqual(1);
    // 恢复基线（后续用例不受影响）
    act(() => setSim({ gridSize: 10, gridVisible: true }));
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

  // 游戏内格式检查（用户报告：回显把表达式引号吃掉 → 粘回游戏失败）
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

  it('应用缺引号文本 → 表单回显自动补单引号（引号不再消失）', () => {
    const head = 'particleex conditional minecraft:end_rod ~ ~ ~ 1 0.95 0.89 1 0 0 0 8 0.6 8 ';
    const tail = ' 0.1 200 vy=0.05 1 null';
    setValue(ta(), head + '(abs(y-0.5)<0.05)&(sqrt(x^2+z^2)<8)' + tail);
    click(button('应用'));
    expect(getState().input).toContain("'(abs(y-0.5)<0.05)&(sqrt(x^2+z^2)<8)'");
    expect(getState().input).toContain("'vy=0.05'");
    expect(checkCommandsFormat(getState().input)).toEqual([]); // 回显本身即游戏内合法格式
  });

  // 模板库（模板展示 + 复制/载入）
  it('模板库：展开列出模板，复制命令写剪贴板并 toast', async () => {
    click(button('模板库'));
    const cards = container.querySelectorAll('.template-card');
    expect(cards.length).toBeGreaterThanOrEqual(10);

    click(buttonIn(cards[0], '复制命令'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(clipboardText).toContain('/particleex');
    expect(getState().toasts.at(-1)).toContain('已复制到剪贴板');
  });

  it('模板库：载入到命令列表 → 真源追加 + 粘贴框文本同步', () => {
    click(button('模板库'));
    const card = container.querySelectorAll('.template-card')[0];
    const before = getState().commands.length;
    click(buttonIn(card, '载入到命令列表'));
    expect(getState().commands.length).toBeGreaterThan(before);
    expect(ta().value).toContain('/particleex');
    expect(getState().toasts.at(-1)).toContain('已载入模板');
    // 追加的命令自身必须是游戏内合法格式
    expect(checkCommandsFormat(getState().input)).toEqual([]);
  });

  it('模板库：搜索按名称/标签过滤', () => {
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

  it('模板库：复制链接 → ?t=<id> 直达链接', async () => {
    click(button('模板库'));
    const card = container.querySelectorAll('.template-card')[0];
    click(buttonIn(card, '复制链接'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(clipboardText).toContain('?t=');
    expect(clipboardText).toContain('ripple');
    expect(getState().toasts.at(-1)).toContain('链接已复制到剪贴板');
  });

  it('模板库：入口在命令区头部；Esc 关闭、面板内点击不关闭', () => {
    // 入口与「执行」同一行（不再沉在左栏底部）
    const head = container.querySelector('.pane-section-head')!;
    expect(buttonIn(head, '模板库')).toBeTruthy();
    expect(buttonIn(head, '执行')).toBeTruthy();

    click(buttonIn(head, '模板库'));
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

  it('精选模板入口：常驻一行 chips，「全部 N 个」打开面板；chip 一键载入并执行', () => {
    const featured = container.querySelector('.template-featured')!;
    expect(featured.className).not.toContain('empty');
    expect(featured.textContent).toContain('精选模板');

    click(buttonIn(featured, '全部'));
    expect(container.querySelector('.gallery-sheet')).toBeTruthy();
    click(buttonIn(container.querySelector('.gallery-sheet')!, '关闭'));

    const before = getState().commands.length;
    click(buttonIn(container.querySelector('.template-featured')!, '圆周环'));
    expect(getState().commands.length).toBeGreaterThan(before);
    expect(getState().toasts.at(-1)).toContain('已载入模板');
  });

  it('命令列表清空 → 精选入口变「从模板开始」引导', () => {
    act(() => {
      while (getState().commands.length > 0) removeCommand(0);
    });
    const featured = container.querySelector('.template-featured')!;
    expect(featured.className).toContain('empty');
    expect(featured.textContent).toContain('从模板开始');

    click(buttonIn(featured, '螺旋上升'));
    expect(getState().commands.length).toBeGreaterThan(0);
    expect(checkCommandsFormat(getState().input)).toEqual([]);
  });
});
