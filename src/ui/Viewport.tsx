// Viewport（计划 §九）：Three 画布 + PlaybackBar（▶⏸ 单步 1x/2x/4x/8x ↺回放）
// + HudStatus（tick / 粒子数 / 丢弃）。播放状态镜像在 store（按钮高亮），
// rAF 热路径读 App 的 ref。

import { useAppState, setPlaying, setSpeed } from '../store/appState';

const SPEEDS = [1, 2, 4, 8];

interface PlaybackHandlers {
  onStep: () => void;
  onReset: () => void;
}

export function Viewport({
  containerRef,
  onStep,
  onReset,
}: PlaybackHandlers & { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const { playing, speed, hud } = useAppState();

  return (
    <main className="viewport">
      <div className="viewport-canvas" ref={containerRef} />
      <div className="hud">
        tick {hud.tick} · 粒子 {hud.count} · 丢弃 {hud.dropped}
      </div>
      <div className="playback-bar">
        <button className={playing ? 'active' : 'primary'} onClick={() => setPlaying(!playing)}>
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button onClick={onStep} disabled={playing}>
          单步
        </button>
        <button onClick={onReset}>↺ 回放重置</button>
        <span className="speed-group">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </span>
      </div>
    </main>
  );
}
