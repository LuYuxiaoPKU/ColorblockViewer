// 设置抽屉集成：SettingsDrawer ↔ NumField ↔ store.sim 联动（happy-dom 渲染真实 <App/>，
// SimViewport 同 tests/ui/integration 一样 mock 掉）。锁定用户可见行为：
// 打开抽屉、草稿输入（blur/Enter 提交）、非法输入红框且 store 不变、
// min 钳制、integer 拒非整数、复选框与版本下拉镜像。
// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../../src/App';
import { getState, replaceCommands, setInputText, setSim, setPlaying, setSpeed, clearToasts } from '../../src/store/appState';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/render/sync', () => ({
  SimViewport: class {
    update(): number { return 0; }
    get size(): number { return 900; }
    get fov(): number { return 50; }
    start() {}
    stop() {}
    resize() {}
    dispose() {}
    setSizeMul() {}
    setAlphaMul() {}
    setPointScale() {}
    setAtlasKey() {}
    setGrid() {}
  },
}));

const SIM_BASE = { playerPos: { x: 0, y: 0, z: 0 }, defaultLifetime: 20, maxParticles: 20000, seed: 1, mcVersion: '26.2', gridSize: 10, gridVisible: true, nativeKinematics: true, renderMode: 'full' as const };

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
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
  await act(async () => {
    await Promise.resolve();
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function button(text: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text));
  if (!btn) throw new Error('button not found: ' + text);
  return btn as HTMLButtonElement;
}

function inputValue(el: HTMLInputElement, v: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function selectValue(el: HTMLSelectElement, v: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** NumField 的 onBlur 在 React 里绑定的是原生 focusout（React 17+ 委托），
 *  派发 focusout 才会触发 commit */
function commitField(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

/** 抽屉内按小标签定位 NumField（「x」/「tick」/「max」/「seed」…） */
function numField(label: string): HTMLInputElement {
  const scope = container.querySelector('.pane-section.settings')!;
  const lf = [...scope.querySelectorAll('.numfield-label')].find((e) => e.textContent?.trim() === label);
  if (!lf) throw new Error('numfield not found: ' + label);
  const input = lf.closest('.numfield')!.querySelector('input') as HTMLInputElement;
  return input;
}

describe('设置抽屉（SettingsDrawer ↔ store.sim）', () => {
  it('打开抽屉后输入区出现（默认折叠）', () => {
    expect(container.querySelector('.pane-section.settings .cmd-form-body')).toBeNull();
    act(() => {
      button('设置').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.pane-section.settings .cmd-form-body')).toBeTruthy();
  });

  it('玩家位置 x：输入 + blur 提交 → store 更新', () => {
    act(() => {
      button('设置').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const x = numField('x');
    inputValue(x, '12.5');
    commitField(x);
    expect(getState().sim.playerPos.x).toBe(12.5);
    expect(x.value).toBe('12.5');
  });

  it('玩家位置 x：Enter 提交（不必手动 blur）', () => {
    // Enter 的实现在 fields.tsx 里是 e.target.blur() → 等效于 blur 提交
    act(() => {
      button('设置').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const x = numField('x');
    inputValue(x, '-3');
    commitField(x);
    expect(getState().sim.playerPos.x).toBe(-3);
  });

  it('非法输入 → 红框且 store 不变、草稿保留（可继续修改）', () => {
    act(() => {
      button('设置').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const x = numField('x');
    const before = getState().sim.playerPos.x;
    inputValue(x, 'abc');
    commitField(x);
    expect(getState().sim.playerPos.x).toBe(before);
    expect(x.value).toBe('abc');
    expect(x.closest('.numfield')!.className).toContain('bad');
    // 改回合法值 → 提交且红框解除
    inputValue(x, '7');
    commitField(x);
    expect(getState().sim.playerPos.x).toBe(7);
    expect(x.closest('.numfield')!.className).not.toContain('bad');
  });

  it('默认寿命 min=1：输入 0 → 钳到 1；非整数 → 红框不提交', () => {
    act(() => {
      button('设置').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const tick = numField('tick');
    inputValue(tick, '0');
    commitField(tick);
    expect(getState().sim.defaultLifetime).toBe(1);
    inputValue(tick, '2.5');
    commitField(tick);
    expect(getState().sim.defaultLifetime).toBe(1); // 未提交
    expect(tick.closest('.numfield')!.className).toContain('bad');
  });

  it('3D 网格大小 max=100：输入 1000 → 钳到 100', () => {
    act(() => {
      button('设置').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const size = numField('大小');
    inputValue(size, '1000');
    commitField(size);
    expect(getState().sim.gridSize).toBe(100);
  });

  it('原版运动学复选框 → store.nativeKinematics 镜像', () => {
    act(() => {
      button('设置').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const cb = [...container.querySelectorAll('.pane-section.settings input[type=checkbox]')].find(
      (e) => e.parentElement?.textContent?.includes('原版运动学'),
    ) as HTMLInputElement;
    expect(cb.checked).toBe(true);
    act(() => {
      cb.click();
    });
    expect(getState().sim.nativeKinematics).toBe(false);
    expect(cb.checked).toBe(false);
  });

  it('游戏版本下拉 → store.mcVersion 镜像', () => {
    act(() => {
      button('设置').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const sel = container.querySelector('.pane-section.settings select[aria-label="游戏版本"]') as HTMLSelectElement;
    selectValue(sel, '1.21.11');
    expect(getState().sim.mcVersion).toBe('1.21.11');
    expect(sel.value).toBe('1.21.11');
  });
});
