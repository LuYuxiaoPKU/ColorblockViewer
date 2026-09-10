// Viewport（计划 §九）：Three 画布 + PlaybackBar（▶⏸ 单步 ⅛×/¼×/½×/1x/2x/4x/8x ↺回放）
// + HudStatus（tick / 粒子数 / 丢弃）。播放状态镜像在 store（按钮高亮），
// rAF 热路径读 App 的 ref。

import { useAppState, setPlaying, setSpeed, getState, pushToast } from '../store/appState';
import { encodeShare, shareUrl } from '../share/encoding';

const SPEEDS = [0.125, 0.25, 0.5, 1, 2, 4, 8];

/** 复制分享链接（当前命令 + 设置 → ?s=）；写剪贴板失败时回退 toast 显示原文 */
function copyShareUrl(): void {
  const { commands, sim } = getState();
  const url = shareUrl(
    encodeShare({ commands, sim }),
    window.location.origin,
    window.location.pathname,
  );
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(
      () => pushToast('分享链接已复制到剪贴板'),
      () => pushToast('复制失败：' + url),
    );
  } else {
    pushToast('分享链接：' + url);
  }
}

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
        <button onClick={onReset}>↺ 回放重置</button>
        <button onClick={copyShareUrl} title="把当前命令与设置编码进 URL，发链接即可还原">
          🔗 复制分享链接
        </button>
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
