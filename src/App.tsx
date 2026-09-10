// 应用入口（M5）：左侧 CommandPane（粘贴框/表单双向同步/设置/toast），
// 右侧 Viewport（Three 画布/播放条/HUD）。
//
// 热路径（计划 §九）：引擎与 Three 对象在 ref；播放状态以 store 为 UI 镜像，
// rAF 循环读 ref（playing/speed 变化时重启 effect）。React state 只承担
// 低频显示（HUD 10Hz 轮询）。

import { useEffect, useRef, useState } from 'react';
import { SimEngine } from './sim/engine';
import { SimViewport } from './render/sync';
import { useAppState, setHud, pushToast, getState, clearToasts, setPlaying, applyInputText } from './store/appState';
import { CommandPane } from './ui/CommandPane';
import { Viewport } from './ui/Viewport';

const TICK_MS = 50; // 20 TPS

export default function App() {
  const { playing, speed, sim } = useAppState();

  const [renderCapacity, setRenderCapacity] = useState(0);
  const engineRef = useRef<SimEngine | null>(null);
  const viewportRef = useRef<SimViewport | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playRef = useRef({ acc: 0, last: 0 });
  const lastErrLen = useRef(0);

  if (engineRef.current === null) {
    engineRef.current = new SimEngine({ ...getState().sim });
  }

  // 挂载：viewport + 渲染循环 + resize
  useEffect(() => {
    if (!containerRef.current) return;
    const vp = new SimViewport(containerRef.current, engineRef.current!.config.maxParticles, engineRef.current!.config.mcVersion);
    viewportRef.current = vp;
    // 点云缓冲容量 = 挂载时 maxParticles（运行期调大上限不扩容缓冲）→ 截断提示
    setRenderCapacity(engineRef.current!.config.maxParticles);
    vp.setPointScale(vp.size, 50); // fov 与 scene.ts 相机一致；首帧前设定像素换算
    vp.start();
    const onResize = () => vp.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      vp.dispose();
      viewportRef.current = null;
    };
  }, []);

  // 设置变更 → 应用到引擎（playerPos/寿命/上限即时；seed → 重建 PRNG）
  useEffect(() => {
    engineRef.current!.updateConfig(sim);
  }, [sim]);

  // 游戏版本变更 → 换粒子图集（贴图/帧表按版本分区；加载完成前圆点回退）
  useEffect(() => {
    viewportRef.current?.setAtlasKey(sim.mcVersion);
  }, [sim.mcVersion]);

  // 网格设置变更 → 重建/显隐网格（纯渲染层，引擎不读）
  useEffect(() => {
    viewportRef.current?.setGrid(sim.gridSize, sim.gridVisible);
  }, [sim.gridSize, sim.gridVisible]);

  // 播放循环（墙钟累加器；逻辑 20Hz 与渲染 60Hz 解耦）
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
          engineRef.current!.tickOnce();
          st.acc -= TICK_MS;
          viewportRef.current?.update(engineRef.current!);
          didTick = true;
        }
        // 自动停止：tick 后无活工作（活粒子清零且无排队 tick 生成器）→ 暂停。
        // age=-1 粒子 lifetime=INT_MAX，实际永不到期；生成器未跑完时不触发。
        if (didTick) {
          const e = engineRef.current!;
          if (!e.hasLiveWork()) {
            setHud({ tick: e.tick, count: e.aliveCount, dropped: e.dropped });
            pushToast('已自动停止：粒子寿命全部结束');
            setPlaying(false);
            return; // 不再调度下一帧；playing 变化触发 effect cleanup
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
  };

  // 「执行」：先把文本框内容应用进真源（粘贴未应用的新行也能直接跑，
  // 否则 run 的是旧 commands、新粘贴的命令不生效），再逐条 runCommand
  // （命令级错误 toast，后续行继续）
  const run = () => {
    const applyErr = applyInputText();
    if (applyErr) pushToast(applyErr);
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
    refresh();
  };

  // 「单步」：手动 tickOnce（暂停时可用）
  const step = () => {
    if (playing) return;
    engineRef.current!.tickOnce();
    refresh();
  };

  // 「回放重置」：引擎全重置（粒子/组/生成器/tick/PRNG）+ 清 toast
  const reset = () => {
    engineRef.current!.reset();
    lastErrLen.current = 0;
    clearToasts();
    refresh();
  };

  return (
    <div className="app-layout">
      <aside className="pane">
        <h1>ColorBlockViewer</h1>
        <p className="muted">
          AnotherColorBlock 粒子效果预览（默认启用原版运动学：end_rod 等类型的摩擦/重力/淡出/随机寿命按 1.21.1 反编译值，可在设置中关闭回退匀速直线）
        </p>
        <CommandPane onRun={run} />
      </aside>
      <Viewport containerRef={containerRef} renderCapacity={renderCapacity} onStep={step} onReset={reset} />
    </div>
  );
}
