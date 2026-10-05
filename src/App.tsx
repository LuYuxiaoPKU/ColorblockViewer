// 应用入口（M5）：左侧 CommandPane（粘贴框/表单双向同步/设置/toast），
// 右侧 Viewport（完整模式 = WebGL 点云画布 / 快速模式 = Canvas 2D 圆点；
// 播放条/HUD/时间线进度条）。
//
// 热路径（计划 §九）：引擎与渲染视口在 ref；播放状态以 store 为 UI 镜像，
// rAF 循环读 ref（playing/speed 变化时重启 effect）。React state 只承担
// 低频显示（HUD 10Hz 轮询）。
//
// 时间线（sim/timeline.ts）：播放中每 tick 记录一帧快照（活粒子 + 计数），
// 进度条可拖拽回放、◀▶ 逐帧导航；播放到末帧（寿命全部结束）自动停止并
// 停在最后一帧（画面保留）。
//
// 渲染模式（sim.renderMode）：'full' 动态加载 three（≈700KB 独立 chunk），
// 'fast' 走 Canvas 2D（不加载 three、无 WebGL）。两模式共用 color.ts 色值口径
// 与引擎 1:1 仿真，仅外观（贴图/帧动画 vs 圆点）不同。

import { useEffect, useRef, useState } from 'react';
import { SimEngine } from './sim/engine';
import { Timeline } from './sim/timeline';
import type { SimParticle } from './sim/types';
import type { SnapshotSource } from './render/sync';
import {
  useAppState,
  setHud,
  setPlayback,
  pushToast,
  getState,
  clearToasts,
  setPlaying,
  applyInputText,
  setSim,
} from './store/appState';
import { CommandPane } from './ui/CommandPane';
import { Viewport } from './ui/Viewport';

const TICK_MS = 50; // 20 TPS

/** 两种渲染视口的公共接口（SimViewport / Render2DViewport 结构兼容）：
 *  App 只依赖它，不直接 import 具体渲染模块（按需动态加载）。 */
interface ViewportApi {
  size: number;
  update(source: SnapshotSource): number;
  setGrid(size: number, visible: boolean): void;
  setAtlasKey(key: string): void;
  setPointScale(heightPx: number, fovDeg: number): void;
  resize(): void;
  start(): void;
  dispose(): void;
  /** 首帧预热进度。完整模式：'atlas' 贴图加载 / 'ready' 编译完成；
   *  快速模式：无预热阶段，App 在 start 后直接上报一次 'ready'（空操作字段，
   *  两模式恒存在——曾因快速模式缺字段导致 `if (vp.onProgress)` 整体跳过，
   *  进度条永卡「加载渲染核心…」）。 */
  onProgress: ((stage: 'atlas' | 'ready', frac: number, label?: string) => void) | null;
}

/** 视口覆盖进度条（完整模式首帧预热）：import = 渲染核心 chunk 加载中
 *  （无真值，indeterminate 滑动条）；atlas/compile 带归一化进度。 */
interface VpProgress {
  label: string;
  frac: number; // 0–1（overall 归一化后）
  indeterminate?: boolean;
  fading?: boolean;
}

export default function App() {
  const { playing, speed, sim } = useAppState();

  const [renderCapacity, setRenderCapacity] = useState(0);
  const [vpProgress, setVpProgress] = useState<VpProgress | null>(null);
  const readyRef = useRef(false);
  const engineRef = useRef<SimEngine | null>(null);
  const viewportRef = useRef<ViewportApi | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playRef = useRef({ acc: 0, last: 0 });
  const lastErrLen = useRef(0);
  // 时间线（ref 热路径；store 的 playback 只是 UI 镜像）：
  //   tl = 帧缓冲；playheadTick = 当前显示帧的 tick（seek 游标）。
  const timelineRef = useRef<Timeline | null>(null);
  const playheadTick = useRef(0);

  if (engineRef.current === null) {
    engineRef.current = new SimEngine({ ...getState().sim });
  }
  if (timelineRef.current === null) {
    timelineRef.current = new Timeline(engineRef.current.config.maxParticles);
  }

  // 挂载（或渲染模式切换）：**按需加载**对应渲染层——
  // 完整模式：three ≈700KB → 独立 chunk，不阻塞首屏；快速模式：Canvas 2D
  // （render2d，不碰 three）。命令面板/设置先可用，视口到达后再建 + 启动渲染
  // 循环；期间 viewportRef 为 null，其余 effect 的 `?.` 调用自动跳过，加载
  // 完成后补一次当前设置（图集按版本、网格）以对齐状态。
  useEffect(() => {
    let disposed = false;
    let vp: ViewportApi | null = null;
    let fadeTimer = 0;
    const mode = sim.renderMode;
    readyRef.current = false;
    // 完整模式：立即显示「加载渲染核心」indeterminate 条（three chunk ~700KB
    // 加载中，浏览器不给 chunk 进度事件 → 不假装 0→100）；快速模式无预热阶段。
    if (mode === 'full') {
      setVpProgress({ label: '加载渲染核心…', frac: 0, indeterminate: true });
    } else {
      setVpProgress(null);
    }
    // 工厂经 Promise 解析后再建（disposed 先判，避免卸载后建视口）；
    // 两分支统一为 Promise<() => ViewportApi>（联合 Promise 本身不可调用）
    const load: Promise<() => ViewportApi> =
      mode === 'fast'
        ? import('./render/render2d').then((m) => () =>
            new m.Render2DViewport(containerRef.current!, engineRef.current!.config.maxParticles, engineRef.current!.config.mcVersion),
          )
        : import('./render/sync').then((m) => () =>
            new m.SimViewport(containerRef.current!, engineRef.current!.config.maxParticles, engineRef.current!.config.mcVersion),
          );
    void load.then((make) => {
      if (disposed || !containerRef.current) return;
      try {
        vp = make();
      } catch (err) {
        // 完整模式 WebGL 上下文创建失败（无 GPU/被禁用）：three 的 WebGLRenderer
        // 构造直接抛异常（非 getContext null —— 该路径 r185 不可达）。不兜底则
        // 未处理 rejection + 视口永不建立 + 进度条永卡「加载渲染核心」（引擎照
        // 常跑但画面空白、无提示）。降级快速模式：引擎 1:1 照常（Canvas 2D 圆点），
        // 只丢贴图外观。
        if (mode === 'full') {
          console.error('WebGL 初始化失败，降级快速模式：', err); // 吞异常前留痕（浏览器控制台可见，同 points.ts 图集失败）
          pushToast('WebGL 不可用（无 GPU 或被浏览器禁用）：已降级为快速模式（Canvas 2D）');
          setSim({ renderMode: 'fast' }); // 触发上方 effect 重跑 → 建快速模式视口
        }
        return;
      }
      viewportRef.current = vp;
      // 点云缓冲容量 = 挂载时 maxParticles（运行期调大上限不扩容缓冲）→ 截断提示
      setRenderCapacity(engineRef.current!.config.maxParticles);
      // 预热进度 → 视口覆盖条。overall 归一化：import 0–0.10 / atlas 0.10–0.90 /
      // compile 0.90–1.00（贴图加载是首屏大头）。atlas 完成（frac=1）后 label
      // 自动切「编译着色器」（compile 与贴图加载并行，完成先后不定）；'ready'
      // （着色器编译完成）→ 淡出 400ms 后卸载；ready 后迟到进度忽略。
      // 无条件安装：字段此刻尚未赋值（SimViewport 默认 null）——按字段当前值做
      // 守卫会整体跳过安装、进度条永卡「加载渲染核心」（快速模式的空操作字段
      // 同样被赋值，只是内部从不调用 → 无进度、无条，行为不变）。
      vp.onProgress = (stage, frac, label) => {
        if (stage === 'ready') {
          readyRef.current = true;
          setVpProgress({ label: '就绪', frac: 1, fading: true });
          fadeTimer = window.setTimeout(() => {
            if (readyRef.current) setVpProgress(null);
          }, 400);
        } else if (!readyRef.current) {
          setVpProgress({
            label: frac >= 1 ? '编译着色器…' : label ?? '加载贴图…',
            frac: Math.max(0.1, 0.1 + frac * 0.8),
          });
        }
      };
      vp.setPointScale(vp.size, 50); // 完整模式：fov 与 scene.ts 相机一致；快速模式空操作
      const cfg = engineRef.current!.config;
      vp.setAtlasKey(cfg.mcVersion); // 加载期间版本/网格变更由 ?. 跳过 → 这里补齐
      vp.setGrid(cfg.gridSize, cfg.gridVisible);
      vp.update(engineRef.current!); // 初始快照（模式切换后暂停态立即恢复显示，不空等下一 tick）
      // start 内部 compileAsync（预热着色器，把 GL 编译从首帧 render 提前）
      vp.start();
    });
    const onResize = () => viewportRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      window.clearTimeout(fadeTimer);
      window.removeEventListener('resize', onResize);
      // 断链：迟到的 compileAsync .then 若在 dispose 后执行，onProgress('ready')
      // 会污染**新**挂载的 readyRef/进度条（旧闭包回调指向 App 的共享状态）——
      // 完整模式编译在途时切快速模式、StrictMode 双挂载都会触发。置 null 后
      // 旧视口的一切迟到上报被 ?. 丢弃。
      if (vp) vp.onProgress = null;
      vp?.dispose();
      viewportRef.current = null;
      readyRef.current = false;
    };
  }, [sim.renderMode]);

  // 设置变更 → 应用到引擎（playerPos/寿命/上限即时；seed → 重建 PRNG）
  useEffect(() => {
    engineRef.current!.updateConfig(sim);
    timelineRef.current!.setMaxParticles(sim.maxParticles); // 帧内截断按当前上限
  }, [sim]);

  // 游戏版本变更 → 换粒子图集（贴图/帧表按版本分区；加载完成前圆点回退）
  useEffect(() => {
    viewportRef.current?.setAtlasKey(sim.mcVersion);
  }, [sim.mcVersion]);

  // 网格设置变更 → 重建/显隐网格（纯渲染层，引擎不读）
  useEffect(() => {
    viewportRef.current?.setGrid(sim.gridSize, sim.gridVisible);
  }, [sim.gridSize, sim.gridVisible]);

  // 时间线镜像 → store（播放头/末帧/最旧帧/帧数；UI 进度条与 ◀▶ 按钮读它）
  const syncPlayback = () => {
    const e = engineRef.current!;
    const tl = timelineRef.current!;
    setPlayback({ tick: playheadTick.current, endTick: tl.endTick, oldestTick: tl.oldestTick, frames: tl.length });
    setHud({ tick: e.tick, count: e.aliveCount, dropped: e.dropped });
  };

  // 播放循环（墙钟累加器；逻辑 20Hz 与渲染 60Hz 解耦）。每 tick：
  // 引擎 tickOnce → 视口刷新 → 时间线记录一帧（含末帧标记）→ 镜像 store。
  useEffect(() => {
    if (!playing) return;
    const st = playRef.current;
    st.acc = 0;
    st.last = 0;
    let raf = 0;
    const loop = (now: number) => {
      if (st.last > 0) {
        st.acc = Math.min(st.acc + (now - st.last) * speed, TICK_MS * 4); // cap 防死亡螺旋
        let didTick = false;
        while (st.acc >= TICK_MS) {
          const e = engineRef.current!;
          e.tickOnce();
          st.acc -= TICK_MS;
          viewportRef.current?.update(e);
          // 时间线记录（每 tick 至多一帧；帧满丢最旧）。end = tick 后无活工作
          // （寿命全部结束且生成器跑完）→ 末帧标记。
          const end = !e.hasLiveWork();
          timelineRef.current!.push(e.snapshot(), e.tick, e.dropped, end);
          playheadTick.current = e.tick;
          syncPlayback();
          didTick = true;
          if (end) {
            // 自动停止：停在最后一帧（画面保留末帧快照；时间线不清空，
            // 可拖条回看/◀▶ 导航；再按播放从头重跑 = playFresh 语义不变）。
            st.last = now;
            setPlaying(false);
            return; // 不再调度下一帧；playing 变化触发 effect cleanup
          }
        }
        if (didTick) {
          // tick 期错误 toast（10Hz 轮询兜底之外的即时路径）
          const e = engineRef.current!;
          if (e.tickErrors.length > lastErrLen.current) {
            for (let i = lastErrLen.current; i < e.tickErrors.length; i++) {
              pushToast('tick ' + e.tick + ': ' + e.tickErrors[i]);
            }
            lastErrLen.current = e.tickErrors.length;
          }
        }
      }
      st.last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      playRef.current.last = 0;
      cancelAnimationFrame(raf);
    };
  }, [playing, speed]);

  // HUD / tickErrors 10Hz 轮询（热路径不经过 React state）
  useEffect(() => {
    const id = window.setInterval(() => {
      const e = engineRef.current!;
      setHud({ tick: e.tick, count: e.aliveCount, dropped: e.dropped });
      syncPlayback(); // 播放头/帧数兜底（播放循环已写，值未变不触发重渲染）
      if (e.tickErrors.length > lastErrLen.current) {
        for (let i = lastErrLen.current; i < e.tickErrors.length; i++) {
          pushToast('tick ' + e.tick + ': ' + e.tickErrors[i]);
        }
        lastErrLen.current = e.tickErrors.length;
      }
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const refresh = () => {
    const e = engineRef.current!;
    viewportRef.current?.update(e);
    setHud({ tick: e.tick, count: e.aliveCount, dropped: e.dropped });
    syncPlayback();
  };

  // 「执行」：先把文本框内容应用进真源（粘贴未应用的新行也能直接跑，
  // 否则 run 的是旧 commands、新粘贴的命令不生效），再逐条 runCommand
  // （命令级错误 toast，后续行继续）
  const run = () => {
    // applyInputText 失败时自己已推 toast（store 层统一入口）——这里不再重推
    // （曾双推：同一条错误占 toast 配额 2 条）
    applyInputText();
    const e = engineRef.current!;
    for (const cmd of getState().commands) {
      try {
        const r = e.runCommand(cmd);
        for (const err of r.errors) pushToast(err);
        if (r.dropped > 0) pushToast(`粒子上限：丢弃 ${r.dropped} 个`);
      } catch (err) {
        pushToast((err as Error).message);
      }
    }
    // 执行改变了场景 → 时间线起点失效（旧帧对应旧命令的状态）：清空、
    // 播放头归零。下一 tick 起重新记录。
    timelineRef.current!.clear();
    playheadTick.current = 0;
    refresh();
  };

  // 「上一帧 / 下一帧」：seek 时间线 ±1 tick（◀▶ 按钮）
  const stepTo = (delta: number) => {
    seek(Math.max(0, playheadTick.current + delta));
  };

  // 「seek」（进度条拖拽/点击、◀▶）：跳回时间线里 tick 最近（≤t）的一帧。
  // 回放实现（前端无 1:1 约束，文档化近似）：按帧的粒子列表从**当前活池**
  // 取回真粒子对象（渲染读 13 个字段都在真对象上，帧拷贝仅兜底已死粒子）。
  // seek 后场景停在历史状态；再播放 = 从该状态继续演进（不重放命令）。
  const seek = (t: number) => {
    const tl = timelineRef.current!;
    const frame = tl.findFrame(t);
    if (!frame) return;
    const e = engineRef.current!;
    const alive: SimParticle[] = e.snapshot();
    const byId = new Map<number, SimParticle>();
    for (const p of alive) byId.set(p.id, p);
    // 每帧粒子：id 命中当前活池 → 真粒子对象（渲染读 13 字段都在上面）；
    // 否则用帧内浅拷贝（已死粒子 / 拷贝缺运动学字段 —— 见 engine.setPool 注释）
    const resolved: SimParticle[] = frame.particles.map((c) => byId.get((c as unknown as SimParticle).id) ?? (c as unknown as SimParticle));
    e.setPool(resolved);
    e.setTick(frame.tick); // HUD tick 与场景状态对齐（续播从该 tick 演进）
    playheadTick.current = frame.tick;
    playRef.current.acc = 0; // 防止 seek 期间累计的墙钟在续播时补跑历史 tick
    viewportRef.current?.update(e);
    setHud({ tick: frame.tick, count: frame.count, dropped: frame.dropped });
    setPlayback({ tick: frame.tick, endTick: tl.endTick, oldestTick: tl.oldestTick, frames: tl.length });
  };

  // 「回放重置」：引擎全重置（粒子/组/生成器/tick/PRNG）+ 时间线清空 + 清 toast
  const reset = () => {
    engineRef.current!.reset();
    timelineRef.current!.clear();
    playheadTick.current = 0;
    lastErrLen.current = 0;
    clearToasts();
    refresh();
  };

  // 「清空并执行」（模板库「载入并执行」用）：先清空现有粒子/生成器/tick
  // （→ 回放重置），再按已替换好的命令真源跑一遍 —— 换模板 = 干净重来，
  // 不叠加旧命令与旧粒子。
  const runFresh = () => {
    reset();
    run();
  };

  // 「▶ 播放」（粘贴框上的播放入口）：重置 + 执行 + 开始播放——
  // 粘贴即播，不用先跑一遍再点画布播放。
  const playFresh = () => {
    reset();
    run();
    setPlaying(true);
  };

  return (
    <div className="app-layout">
      <aside className="pane">
        <h1>ColorBlockViewer</h1>
        <p className="muted">
          ColorBlock 粒子效果预览（默认启用原版运动学：end_rod 等类型的摩擦/重力/淡出/随机寿命按 1.21.1 反编译值，可在设置中关闭回退匀速直线）
        </p>
        <CommandPane onRun={run} onRunFresh={runFresh} onReset={reset} onPlayFresh={playFresh} />
      </aside>
      <Viewport
        containerRef={containerRef}
        renderCapacity={renderCapacity}
        onPrev={() => stepTo(-1)}
        onNext={() => stepTo(1)}
        onReset={reset}
        onSeek={(t) => seek(t)}
        progress={vpProgress}
      />
    </div>
  );
}
