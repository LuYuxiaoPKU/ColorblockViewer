// SettingsDrawer（计划 §九）：玩家位置 / 默认寿命（标「近似」）/ 粒子上限 / 随机种子。
// 写入 store.sim；App 的 effect 把它应用到引擎 ref（playerPos/寿命/上限即时生效，
// seed 变化 → 引擎重建 PRNG）。

import { useState } from 'react';
import { useAppState, setSim } from '../store/appState';
import { NumField } from './fields';
import { REFERENCE_LABELS, REFERENCE_TYPES } from '../render/reference';
import type { SimConfig } from '../sim/types';

export function SettingsDrawer({
  freeMode,
  onToggleFreeMode,
  onResetView,
}: {
  freeMode: boolean;
  onToggleFreeMode: (on: boolean) => void;
  onResetView: () => void;
}) {
  const { sim } = useAppState();
  const [open, setOpen] = useState(false);

  return (
    <div className="pane-section settings">
      <div className="pane-section-head">
        <button className="small" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} 设置
        </button>
      </div>
      {open ? (
        <div className="cmd-form-body">
          <div className="field-row">
            <span className="field-row-label">玩家位置（~ 的基准）</span>
            <NumField label="x" value={sim.playerPos.x} onChange={(v) => setSim({ playerPos: { ...sim.playerPos, x: v } })} />
            <NumField label="y" value={sim.playerPos.y} onChange={(v) => setSim({ playerPos: { ...sim.playerPos, y: v } })} />
            <NumField label="z" value={sim.playerPos.z} onChange={(v) => setSim({ playerPos: { ...sim.playerPos, z: v } })} />
          </div>
          <div className="field-row">
            <NumField
              label={
                <>
                  默认寿命 <em className="muted">（近似值：因粒子类型而异，仅 age=0 时生效）</em>
                </>
              }
              value={sim.defaultLifetime}
              min={1}
              integer
              onChange={(v) => setSim({ defaultLifetime: v })}
            />
          </div>
          <div className="field-row">
            <NumField label="粒子上限" value={sim.maxParticles} min={1} integer onChange={(v) => setSim({ maxParticles: v })} />
          </div>
          <div className="field-row">
            <NumField label="随机种子" value={sim.seed} integer onChange={(v) => setSim({ seed: v })} />
          </div>
          <div className="field-row">
            <span className="field-row-label">游戏版本</span>
            <select
              value={sim.mcVersion}
              onChange={(e) => setSim({ mcVersion: e.target.value })}
              aria-label="游戏版本"
            >
              <option value="26.2">26.2</option>
              <option value="1.21.11">1.21.11</option>
            </select>
          </div>
          <div className="field-row">
            <span className="field-row-label">渲染模式</span>
            <select
              value={sim.renderMode}
              onChange={(e) => setSim({ renderMode: e.target.value as 'full' | 'fast' })}
              aria-label="渲染模式"
            >
              <option value="full">完整（WebGL）</option>
              <option value="fast">快速（Canvas 2D）</option>
            </select>
          </div>
          {/* 参照物/视角移动是完整模式 3D 专属（快速模式无 3D 道具与相机）→ 仅完整模式显示 */}
          {sim.renderMode === 'full' && (
            <div className="field-row">
              <span className="field-row-label">
                参照物（仅完整模式）
              </span>
              <select
                value={sim.reference}
                onChange={(e) => setSim({ reference: e.target.value as SimConfig['reference'] })}
                aria-label="参照物"
              >
                {REFERENCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {REFERENCE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {sim.renderMode === 'full' && (
            <div className="field-row">
              <span className="field-row-label">视角移动</span>
              <button
                type="button"
                className={freeMode ? 'active small' : 'small'}
                onClick={() => onToggleFreeMode(!freeMode)}
              >
                {freeMode ? '移动中 · 按 Esc 退出' : '启动'}
              </button>
              <button type="button" className="small" onClick={onResetView}>
                复位
              </button>
              <em className="muted">（点击画面锁定鼠标：WASD 平移 · 空格上升/Shift 下降 · 转鼠标转向 · R 回位）</em>
            </div>
          )}
          <div className="field-row">
            <NumField label="网格大小" value={sim.gridSize} min={2} max={100} integer onChange={(v) => setSim({ gridSize: v })} />
            <label className="check-inline">
              <input
                type="checkbox"
                checked={sim.gridVisible}
                onChange={(e) => setSim({ gridVisible: e.target.checked })}
              />
              显示网格线
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}
