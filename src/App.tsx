// 应用入口（M5）：左侧 CommandPane（粘贴框/表单双向同步/设置/toast），
// 右侧 Viewport（Three 画布/播放条/HUD）。
//
// 热路径（计划 §九）：引擎与 Three 对象在 ref；播放状态以 store 为 UI 镜像，
// rAF 循环读 ref（playing/speed 变化时重启 effect）。React state 只承担
// 低频显示（HUD 10Hz 轮询）。

import { useEffect, useRef } from 'react';
import { SimEngine } from './sim/engine';
import { SimViewport } from './render/sync';
import { useAppState, setHud, pushToast, getState, clearToasts } from './store/appState';
import { CommandPane } from './ui/CommandPane';
import { Viewport } from './ui/Viewport';

const TICK_MS = 50; // 20 TPS

export default function App() {
  const { playing, speed, sim } = useAppState();

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
    const vp = new SimViewport(containerRef.current, engineRef.current!.config.maxParticles);
    viewportRef.current = vp;
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
        while (st.acc >= TICK_MS) {
          engineRef.current!.tickOnce();
          st.acc -= TICK_MS;
          viewportRef.current?.update(engineRef.current!);
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

  // 「执行」：按当前 commands 逐条 runCommand（命令级错误 toast，后续行继续）
  const run = () => {
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
          AnotherColorBlock 粒子效果预览（简化：所有粒子类型按匀速直线运动；默认寿命为近似值）
        </p>
        <CommandPane onRun={run} />
      </aside>
      <Viewport containerRef={containerRef} onStep={step} onReset={reset} />
    </div>
  );
}
