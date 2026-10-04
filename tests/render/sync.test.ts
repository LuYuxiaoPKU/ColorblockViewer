// SimViewport.start 启动门控：WebGL 上下文不可用时不挂 rAF（预览环境 headless
// 标签页下 getContext 可能为 null → 旧实现每 4ms 空转一帧，主线程被打满、
// microtask 饿死 → 进度回调永不执行、进度条卡死在「加载渲染核心」）。
// scene.ts 整体 mock（不依赖真实 WebGL 上下文）；节点环境下 three 的几何/材质
// 构造不碰 document，createPointsLayer 可安全构造。

import { describe, expect, it, vi, afterEach } from 'vitest';
import { _resetAtlasCache } from '../../src/render/points';

const { rendererMock } = vi.hoisted(() => ({
  rendererMock: {
    getContext: vi.fn(),
    compileAsync: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('../../src/render/scene', () => ({
  createScene: () => ({
    renderer: rendererMock,
    scene: { add: vi.fn() },
    camera: {},
    controls: { update: vi.fn(), dispose: vi.fn() },
    resize: vi.fn(),
    setGrid: vi.fn(),
    dispose: vi.fn(),
  }),
}));

import { SimViewport } from '../../src/render/sync';

function mkViewport(): SimViewport {
  return new SimViewport(null as never, 4, '26.2');
}

afterEach(() => {
  rendererMock.getContext.mockReset();
  rendererMock.compileAsync.mockClear();
  vi.unstubAllGlobals();
  _resetAtlasCache();
});

describe('SimViewport.start WebGL 门控', () => {
  it('上下文为 null → 不上 rAF、立即上报 ready（进度条可淡出）', () => {
    rendererMock.getContext.mockReturnValue(null);
    const vp = mkViewport();
    const ready: number[] = [];
    vp.onProgress = (stage, frac) => {
      if (stage === 'ready') ready.push(frac);
    };
    vp.start();
    expect(ready).toEqual([1]);
    expect(rendererMock.getContext).toHaveBeenCalledTimes(1);
    expect(rendererMock.compileAsync).not.toHaveBeenCalled();
  });

  it('上下文正常 → 走编译预热并启动渲染循环，编译完成后上报 ready', async () => {
    rendererMock.getContext.mockReturnValue({});
    // 节点环境无 rAF：stub 为不回调（循环停在首帧，无泄漏）
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const vp = mkViewport();
    let ready = 0;
    vp.onProgress = (stage) => {
      if (stage === 'ready') ready++;
    };
    vp.start();
    expect(rendererMock.compileAsync).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0)); // compileAsync 的微任务落地
    expect(ready).toBe(1);
    vp.stop();
  });

  it('start 幂等（二次调用不重复门控/编译）', () => {
    rendererMock.getContext.mockReturnValue(null);
    const vp = mkViewport();
    vp.start();
    vp.start();
    expect(rendererMock.getContext).toHaveBeenCalledTimes(1);
    expect(rendererMock.compileAsync).not.toHaveBeenCalled();
  });

  it('首次 ready 后不再上报进度（版本切换的图集加载不重新弹进度条）', async () => {
    // 回归：App 的 readyRef 在模式切换重挂视口时会复位 → 版本切换触发的新图集
    // 加载会再次显示进度条（闪回）。视口级 readyReported 是权威门控。
    rendererMock.getContext.mockReturnValue({});
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const vp = mkViewport();
    const events: string[] = [];
    vp.onProgress = (stage) => events.push(stage);
    vp.start();
    await new Promise((r) => setTimeout(r, 0)); // compileAsync 微任务落地
    expect(events).toEqual(['ready']);
    // 直接驱动视口内部层的进度上报（与版本切换图集加载同一链路）：
    // ready 之后必须被 readyReported 拦截
    const inner = (vp as unknown as {
      layer: { _onProgress: ((d: number, t: number) => void) | null };
    }).layer;
    expect(inner._onProgress).not.toBeNull();
    inner._onProgress!(1, 285);
    expect(events).toEqual(['ready']);
    // 版本切换真实链路：setAtlasKey 触发新图集加载 → 进度经 queueMicrotask
    // 投递（points.ts），同样须被 readyReported 拦截
    vp.setAtlasKey('1.21.11');
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual(['ready']);
    vp.stop();
  });

  it('dispose 后 compileAsync 才完成 → 迟到的 ready 不上报（竞态断链）', async () => {
    // 回归：完整模式编译在途时卸载视口（模式切换/StrictMode 双挂载）→ .then
    // 在 stop 后执行，若仍上报 'ready' 会污染新挂载的门控（App cleanup 断
    // onProgress 是另一道保险，此处验视口自身门控）。
    rendererMock.getContext.mockReturnValue({});
    let resolveCompile: () => void = () => {};
    rendererMock.compileAsync.mockReturnValue(new Promise((r) => { resolveCompile = r; }));
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const vp = mkViewport();
    let ready = 0;
    vp.onProgress = (stage) => {
      if (stage === 'ready') ready++;
    };
    vp.start();
    expect(rendererMock.compileAsync).toHaveBeenCalledTimes(1);
    vp.stop(); // 编译在途即卸载
    resolveCompile(); // 此刻编译才完成
    await new Promise((r) => setTimeout(r, 0));
    expect(ready).toBe(0);
  });
});
