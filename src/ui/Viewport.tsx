// Viewport（极简版）：Three 画布 + 播放条（播放/暂停 · 上一帧 · 下一帧 ·
// 可拖拽进度条 · 重置 · 倍速）+ HudStatus（tick / 粒子数 / 丢弃）。
// 播放状态镜像在 store（按钮高亮），rAF 热路径读 App 的 ref。
//
// 进度条语义（timeline 帧缓冲）：
//  - 播放中每 tick 记录一帧 → 条上显示播放位置（playback.tick / endTick）；
//  - 拖拽/点击 = 跳回该帧（App 按帧的粒子快照从当前活池取回真粒子对象回放，
//    已死粒子用帧内拷贝）；
//  - 播放到末帧（粒子寿命全部结束）自动停止并**停在最后一帧**（画面保留）。

import { useRef } from 'react';
import { useAppState, setPlaying, setSpeed } from '../store/appState';

const SPEEDS = [0.125, 0.25, 0.5, 1, 2, 4, 8];

interface PlaybackHandlers {
  onPrev: () => void;
  onNext: () => void;
  onReset: () => void;
  /** 进度条拖拽/点击：t = tick（0..maxTick 整数） */
  onSeek: (t: number) => void;
  /** 预估总时长（tick；App 按命令预估 + 生成器剩余计算）：条右端。
   *  取代旧口径「末帧 + 剩余预算估算」（生成器命令录不满 → 右侧大空白） */
  maxTick: number;
}

/** 首帧预热进度（完整模式）：null = 不显示；indeterminate = chunk 加载中
 *  无真值（滑动条）；fading = 就绪后淡出。 */
export interface VpProgressView {
  label: string;
  frac: number; // 0–1
  indeterminate?: boolean;
  fading?: boolean;
}

export function Viewport({
  containerRef,
  renderCapacity,
  onPrev,
  onNext,
  onReset,
  onSeek,
  maxTick: propMaxTick,
  progress = null,
}: PlaybackHandlers & {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 点云缓冲容量（视口挂载时按当时 maxParticles 固定，运行期改上限不重建缓冲）；
   *  调大上限后活粒子数可超过它 → 渲染截断、此提示如实点亮（文档化近似） */
  renderCapacity: number;
  progress?: VpProgressView | null;
}) {
  const { playing, speed, hud, playback } = useAppState();
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const frames = playback.frames;
  const endTick = playback.endTick;
  // 时间线存在（命令执行后的初始帧 / 播放记录）即可回看
  const disabled = frames <= 0;
  // 条右端 = App 预估总时长（命令最大寿命 + 生成器生成期；生成中按剩余校正）。
  // 未执行过命令（maxTick ≤ 0）或播放超出预估（末帧已越过预估：随机寿命取到
  // 上界附近 / 多命令叠加 / 续播）→ 退化为末帧 tick（右端不再外扩）。
  // 超出已记录范围的拖拽在 App.seek 里 clamp 到已记录的最后帧（时间线是
  // 「历史」，右端之外尚未发生）。
  const maxTick = Math.max(1, propMaxTick > endTick ? Math.round(propMaxTick) : endTick);
  const frac = disabled ? 0 : Math.min(1, Math.max(0, playback.tick / maxTick));

  /** 指针 x → tick（0..maxTick 整数）；拖拽中每 move 一次、松手一次。 */
  const seekFromEvent = (e: { clientX: number }) => {
    const bar = barRef.current;
    if (!bar || disabled) return;
    const r = bar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    onSeek(Math.round(f * maxTick));
  };

  return (
    <main className="viewport">
      <div className="viewport-canvas" ref={containerRef} />
      {progress && (
        <div className={'vp-progress' + (progress.fading ? ' vp-progress-hide' : '')}>
          <span>{progress.label}</span>
          <div className="vp-progress-track">
            <div
              className={'vp-progress-fill' + (progress.indeterminate ? ' indeterminate' : '')}
              style={progress.indeterminate ? undefined : { width: `${Math.round(Math.min(1, Math.max(0, progress.frac)) * 100)}%` }}
            />
          </div>
        </div>
      )}
      <div className="hud">
        tick {hud.tick} · 粒子 {hud.count} · 丢弃 {hud.dropped}
        {renderCapacity > 0 && hud.count > renderCapacity ? ' · 渲染截断' : ''}
      </div>
      <div className="playback-bar">
        <button className={playing ? 'active' : 'primary'} onClick={() => setPlaying(!playing)}>
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button className="small" onClick={onPrev} disabled={disabled || playback.tick <= playback.oldestTick} aria-label="上一帧" title="上一帧（回到时间线上一帧）">
          ◀
        </button>
        <button className="small" onClick={onNext} disabled={disabled || (playback.tick >= endTick && playback.tick >= hud.tick)} aria-label="下一帧" title="下一帧（时间线上向前一帧）">
          ▶
        </button>
        <div
          ref={barRef}
          className={'tl-bar' + (disabled ? ' disabled' : '')}
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={maxTick}
          aria-valuenow={Math.min(playback.tick, maxTick)}
          title={disabled ? '播放后出现可回看的时间线' : '拖动回看播放历史'}
          onPointerDown={(e) => {
            if (disabled) return;
            dragging.current = true;
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成/边界事件无活动指针时捕获失败，不阻断 seek */ }
            seekFromEvent(e);
          }}
          onPointerMove={(e) => {
            if (dragging.current) seekFromEvent(e);
          }}
          onPointerUp={(e) => {
            dragging.current = false;
            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 同上 */ }
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
        >
          <div className="tl-fill" style={{ width: `${frac * 100}%` }} />
          <div className="tl-handle" style={{ left: `${frac * 100}%` }} />
        </div>
        <button className="small" onClick={onReset} aria-label="重置" title="重置：清粒子并重新执行命令">
          ↺
        </button>
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
