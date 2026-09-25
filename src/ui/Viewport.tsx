// Viewport（极简版）：Three 画布 + 播放条（播放/暂停 · 单步 · 重置 · 倍速下拉）
// + HudStatus（tick / 粒子数 / 丢弃）。播放状态镜像在 store（按钮高亮），
// rAF 热路径读 App 的 ref。

import { useAppState, setPlaying, setSpeed } from '../store/appState';

const SPEEDS = [0.125, 0.25, 0.5, 1, 2, 4, 8];

interface PlaybackHandlers {
  onStep: () => void;
  onReset: () => void;
}

export function Viewport({
  containerRef,
  renderCapacity,
  onStep,
  onReset,
}: PlaybackHandlers & {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 点云缓冲容量（挂载时按当时 maxParticles 固定）；活粒子数超过它 → 显示「渲染截断」 */
  renderCapacity: number;
}) {
  const { playing, speed, hud } = useAppState();

  return (
    <main className="viewport">
      <div className="viewport-canvas" ref={containerRef} />
      <div className="hud">
        tick {hud.tick} · 粒子 {hud.count} · 丢弃 {hud.dropped}
        {renderCapacity > 0 && hud.count > renderCapacity ? ' · 渲染截断' : ''}
      </div>
      <div className="playback-bar">
        <button className={playing ? 'active' : 'primary'} onClick={() => setPlaying(!playing)}>
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button onClick={onStep} disabled={playing}>
          单步
        </button>
        <button onClick={onReset}>↺ 重置</button>
        <select
          className="speed-select"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          aria-label="倍速"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
    </main>
  );
}
