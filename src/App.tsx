// M4 预览骨架：命令粘贴 + 播放（墙钟累加器）+ HUD。M5 会替换左栏为完整
// 表单/双向同步/设置，右栏 HUD 保留。热路径（引擎/Three/播放状态）全在 ref，
// React state 只承担低频显示（tick 数 10Hz 节流）。

import { useEffect, useRef, useState } from 'react';
import { SimEngine } from './sim/engine';
import type { SimConfig } from './sim/types';
import { parseCommands } from './command/parser';
import { SimViewport } from './render/sync';

const TICK_MS = 50; // 20 TPS
const SPEEDS = [1, 2, 4, 8];

function defaultConfig(): SimConfig {
  return { playerPos: { x: 0, y: 0, z: 0 }, defaultLifetime: 20, maxParticles: 20000, seed: 1 };
}

export default function App() {
  const [input, setInput] = useState(
    'particleex normal flame 0 1 0 1 0.5 0.2 1 0 0 0 0.4 0.4 0 600 20\nparticleex parameter flame 0 0.5 0 1 0.9 0.8 1 0 0 0 0 12.56 "x,y,z=4*cos(t*0.2),0,4*sin(t*0.2)" 0.25 40\n',
  );
  const [hud, setHud] = useState({ tick: 0, count: 0, dropped: 0 });
  const [errors, setErrors] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const engineRef = useRef<SimEngine | null>(null);
  const viewportRef = useRef<SimViewport | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playRef = useRef({ running: false, speed: 1, acc: 0, last: 0 });

  if (engineRef.current === null) engineRef.current = new SimEngine(defaultConfig());

  // 挂载：viewport + 渲染循环 + 墙钟累加器
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

  // 播放循环（requestAnimationFrame 内累加墙钟；逻辑 20Hz 与渲染 60Hz 解耦）
  useEffect(() => {
    playRef.current.running = playing;
    playRef.current.speed = speed;
    if (!playing) return;
    let raf = 0;
    const loop = (now: number) => {
      const st = playRef.current;
      const e = engineRef.current!;
      const vp = viewportRef.current;
      if (st.last > 0) {
        st.acc = Math.min(st.acc + (now - st.last) * st.speed, TICK_MS * 4); // cap 防死亡螺旋
        while (st.acc >= TICK_MS) {
          e.tickOnce();
          st.acc -= TICK_MS;
          if (vp) vp.update(e);
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

  // HUD 10Hz 节流
  useEffect(() => {
    const id = window.setInterval(() => {
      const e = engineRef.current!;
      if (!e) return;
      setHud({ tick: e.tick, count: e.aliveCount, dropped: e.dropped });
      setErrors([...e.tickErrors.slice(-5)]);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const refresh = () => {
    const e = engineRef.current!;
    viewportRef.current?.update(e);
    setHud({ tick: e.tick, count: e.aliveCount, dropped: e.dropped });
  };

  const runInput = () => {
    const e = engineRef.current!;
    const collected: string[] = [];
    try {
      for (const cmd of parseCommands(input)) {
        const r = e.runCommand(cmd);
        for (const err of r.errors) collected.push(err);
      }
    } catch (err) {
      collected.push((err as Error).message);
    }
    setErrors(collected.slice(-5));
    refresh();
  };

  const step = () => {
    if (playRef.current.running) return;
    engineRef.current!.tickOnce();
    refresh();
  };

  const reset = () => {
    setPlaying(false);
    engineRef.current!.reset();
    setErrors([]);
    refresh();
  };

  return (
    <div className="app-layout">
      <aside className="pane">
        <h1>ColorBlockViewer</h1>
        <p className="muted">AnotherColorBlock 粒子效果预览（M4 骨架；M5 实现完整表单）</p>
        <label className="field-label">命令（多行，每行一条）</label>
        <textarea
          className="cmd-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={8}
          spellCheck={false}
        />
        <div className="btn-row">
          <button className="primary" onClick={runInput}>执行</button>
          <button onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ 暂停' : '▶ 播放'}</button>
          <button onClick={step} disabled={playing}>单步</button>
          <button onClick={reset}>↺ 重置</button>
        </div>
        <div className="btn-row">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        {errors.length > 0 && (
          <div className="errors">
            {errors.map((m, i) => (
              <div key={i}>{m}</div>
            ))}
          </div>
        )}
      </aside>
      <main className="viewport">
        <div className="viewport-canvas" ref={containerRef} />
        <div className="hud">
          tick {hud.tick} · 粒子 {hud.count} · 丢弃 {hud.dropped}
        </div>
      </main>
    </div>
  );
}
