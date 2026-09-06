// SettingsDrawer（计划 §九）：玩家位置 / 默认寿命（标「近似」）/ 粒子上限 / 随机种子。
// 写入 store.sim；App 的 effect 把它应用到引擎 ref（playerPos/寿命/上限即时生效，
// seed 变化 → 引擎重建 PRNG）。

import { useState } from 'react';
import { useAppState, setSim } from '../store/appState';
import { NumField } from './fields';

export function SettingsDrawer() {
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
            <span className="field-row-label">
              默认寿命 <em className="muted">（近似值：MC 中因粒子类型而异，age=0 时生效）</em>
            </span>
            <NumField label="tick" value={sim.defaultLifetime} min={1} integer onChange={(v) => setSim({ defaultLifetime: v })} />
          </div>
          <div className="field-row">
            <span className="field-row-label">粒子上限</span>
            <NumField label="max" value={sim.maxParticles} min={1} integer onChange={(v) => setSim({ maxParticles: v })} />
          </div>
          <div className="field-row">
            <span className="field-row-label">随机种子（变化即重置高斯序列）</span>
            <NumField label="seed" value={sim.seed} integer onChange={(v) => setSim({ seed: v })} />
          </div>
          <div className="field-row">
            <span className="field-row-label">
              游戏版本 <em className="muted">（原版 /particle 的粒子贴图与类型表按它分区）</em>
            </span>
            <select
              value={sim.mcVersion}
              onChange={(e) => setSim({ mcVersion: e.target.value })}
              aria-label="游戏版本"
            >
              <option value="26.2">26.2</option>
              <option value="1.21.11">1.21.11</option>
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}
