// CommandForm：按命令 kind 渲染字段（计划 §九）。每次改动构造新对象 →
// setCommand → store 重新派生粘贴框文本（commands 为唯一真源）。

import { useState } from 'react';
import type {
  ParticleCommand,
  NormalCmd,
  ConditionalCmd,
  ParameterCmd,
  GroupCmd,
  ClearCmd,
  VanillaCmd,
  Vec3,
} from '../command/types';
import {
  setCommand,
  insertCommandAfter,
  removeCommand,
  parameterVariantName,
  makeParameter,
  DEFAULT_GROUP_REMOVE,
} from '../store/appState';
import { ExprField } from './ExprField';
import { NumField, Vec3Field, Vec3PlainField, RgbaField, TextField } from './fields';
import { VANILLA_PARTICLE_TYPES } from '../render/particleTypes';

// 粒子名建议（渲染层 TWEAKS 覆盖的类型；MC 的 ParticleArgument 允许任意注册名，
// 输入框不强制枚举）
const PARTICLE_SUGGESTIONS = [
  'flame', 'smoke', 'heart', 'portal', 'end_rod', 'snowflake',
  'sparkle', 'crit', 'crimson_spore', 'dandelion', 'bubble', 'wax_on',
];

// 可选尾部（normal/conditional/parameter 共有）：age / 速度表达式 / speedStep / group
type Tail = { age: number; speedExpression: string | null; speedStep: number; group: string | null };

function TailFields({ tail, onPatch }: { tail: Tail; onPatch: (p: Partial<Tail>) => void }) {
  return (
    <>
      <NumField label="age（寿命，-1 永久 / 0 默认）" value={tail.age} min={-1} max={2147483647} integer onChange={(v) => onPatch({ age: v })} />
      <ExprField label="速度表达式（每 tick；可设 x/y/z、vx/vy/vz、cr/cg/cb/alpha、destroy…）" value={tail.speedExpression} onChange={(v) => onPatch({ speedExpression: v })} />
      <NumField label="speedStep" value={tail.speedStep} min={1e-300} onChange={(v) => onPatch({ speedStep: v })} />
      <TextField label="group（| 分隔多组，null 无）" value={tail.group ?? ''} placeholder="null" onChange={(v) => onPatch({ group: v === '' || v === 'null' ? null : v })} />
    </>
  );
}

function NormalForm({ cmd, i }: { cmd: NormalCmd; i: number }) {
  const up = (p: Partial<NormalCmd>) => setCommand(i, { ...cmd, ...p });
  return (
    <>
      <TextField label="粒子名" value={cmd.name} list={PARTICLE_SUGGESTIONS} onChange={(v) => up({ name: v })} />
      <Vec3Field label="位置（~ = 玩家位置）" pos={cmd.pos} onChange={(pos) => up({ pos })} />
      <RgbaField label="颜色 0-1" rgba={cmd.color} onChange={(color) => up({ color })} />
      <Vec3PlainField label="速度（每 tick）" vec={cmd.speed} onChange={(speed) => up({ speed })} />
      <Vec3PlainField label="范围（高斯标准差 ≥0）" vec={cmd.range} min={0} onChange={(range) => up({ range })} />
      <NumField label="数量" value={cmd.count} min={0} integer onChange={(v) => up({ count: v })} />
      <TailFields tail={cmd} onPatch={up} />
    </>
  );
}

function ConditionalForm({ cmd, i }: { cmd: ConditionalCmd; i: number }) {
  const up = (p: Partial<ConditionalCmd>) => setCommand(i, { ...cmd, ...p });
  return (
    <>
      <TextField label="粒子名" value={cmd.name} list={PARTICLE_SUGGESTIONS} onChange={(v) => up({ name: v })} />
      <Vec3Field label="位置（~ = 玩家位置）" pos={cmd.pos} onChange={(pos) => up({ pos })} />
      <RgbaField label="颜色 0-1" rgba={cmd.color} onChange={(color) => up({ color })} />
      <Vec3PlainField label="速度（每 tick）" vec={cmd.speed} onChange={(speed) => up({ speed })} />
      <Vec3PlainField label="范围（扫描盒 ≥0）" vec={cmd.range} min={0} onChange={(range) => up({ range })} />
      <ExprField label="条件表达式（invoke != 0 才生成；字段 x/y/z/s1/s2/dis）" value={cmd.expression} onChange={(v) => up({ expression: v ?? '0' })} />
      <NumField label="step（扫描步长）" value={cmd.step} min={1e-300} onChange={(v) => up({ step: v })} />
      <TailFields tail={cmd} onPatch={up} />
    </>
  );
}

function ParameterForm({ cmd, i }: { cmd: ParameterCmd; i: number }) {
  const up = (p: Partial<ParameterCmd>) => setCommand(i, { ...cmd, ...p });
  const variant = parameterVariantName(cmd);
  return (
    <>
      <label className="numfield">
        <span className="numfield-label">变体</span>
        <select value={variant} onChange={(e) => up(makeParameter(e.target.value))}>
          {VARIANTS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <TextField label="粒子名" value={cmd.name} list={PARTICLE_SUGGESTIONS} onChange={(v) => up({ name: v })} />
      <Vec3Field label="位置（~ = 玩家位置）" pos={cmd.pos} onChange={(pos) => up({ pos })} />
      {cmd.color ? <RgbaField label="颜色 0-1" rgba={cmd.color} onChange={(color) => up({ color })} /> : null}
      <Vec3PlainField label="速度（每 tick）" vec={cmd.speed} onChange={(speed) => up({ speed })} />
      <div className="field-row">
        <NumField label="begin" value={cmd.begin} onChange={(v) => up({ begin: v })} />
        <NumField label="end" value={cmd.end} onChange={(v) => up({ end: v })} />
      </div>
      <ExprField
        label="表达式（t 从 begin 到 end 步进 step；字段 x/y/z、cr/cg/cb/alpha、vx/vy/vz…）"
        value={cmd.expression}
        onChange={(v) => up({ expression: v ?? '0' })}
      />
      <NumField label="step" value={cmd.step} min={1e-300} onChange={(v) => up({ step: v })} />
      {cmd.tick ? <NumField label="cpt（每 tick 生成数）" value={cmd.cpt} min={1} integer onChange={(v) => up({ cpt: v })} /> : null}
      <TailFields tail={cmd} onPatch={up} />
    </>
  );
}

const VARIANTS = [
  'parameter', 'polarparameter', 'tickparameter', 'tickpolarparameter',
  'rgbaparameter', 'rgbapolarparameter', 'rgbatickparameter', 'rgbatickpolarparameter',
];

function GroupForm({ cmd, i }: { cmd: GroupCmd; i: number }) {
  const up = (c: GroupCmd) => setCommand(i, c);
  if (cmd.sub === 'remove') {
    const r = cmd as Extract<GroupCmd, { sub: 'remove' }>;
    return (
      <>
        <TextField label="组名（| 分隔多组）" value={r.group} onChange={(v) => up({ ...r, group: v })} />
        <ExprField label="条件表达式（null = 移除全部）" value={r.expression} onChange={(v) => up({ ...r, expression: v })} />
        {r.pos ? (
          <Vec3Field label="ref 位置（~ = 玩家位置）" pos={r.pos} onChange={(pos: Vec3) => up({ ...r, pos })} />
        ) : (
          <button className="small" onClick={() => up({ ...r, pos: { x: { v: 0, rel: true }, y: { v: 0, rel: true }, z: { v: 0, rel: true } } })}>
            + 添加 ref 位置
          </button>
        )}
      </>
    );
  }
  const c = cmd as Extract<GroupCmd, { sub: 'change' }>;
  return (
    <>
      <label className="numfield">
        <span className="numfield-label">change 类型</span>
        <select value={c.type} onChange={(e) => up({ ...c, type: e.target.value as 'parameter' | 'speedexpression' })}>
          <option value="parameter">parameter（改位置/颜色/速度）</option>
          <option value="speedexpression">speedexpression（替换速度表达式）</option>
        </select>
      </label>
      <TextField label="组名（| 分隔多组）" value={c.group} onChange={(v) => up({ ...c, group: v })} />
      <ExprField
        label={c.type === 'parameter' ? '表达式（字段 x/y/z=相对 ref 位移、vx/vy/vz、cr/cg/cb/alpha…）' : '速度表达式（替换后每 tick 执行）'}
        value={c.expression}
        onChange={(v) => up({ ...c, expression: v ?? '0' })}
      />
      <ExprField label="条件表达式（null = 全部；invoke != 0 才应用）" value={c.conditionalExpression} onChange={(v) => up({ ...c, conditionalExpression: v })} />
      {c.pos ? (
        <Vec3Field label="ref 位置（~ = 玩家位置）" pos={c.pos} onChange={(pos: Vec3) => up({ ...c, pos })} />
      ) : (
        <button className="small" onClick={() => up({ ...c, pos: { x: { v: 0, rel: true }, y: { v: 0, rel: true }, z: { v: 0, rel: true } } })}>
          + 添加 ref 位置
        </button>
      )}
    </>
  );
}

function ClearForm() {
  return <p className="muted">clearparticle 无参数：移除全部粒子与组。</p>;
}

// 原版 /particle（MC 26.2）：name 必填；pos/delta/speed/count 槽位可独立清除
// （清空 → null = 命令树默认）；NBT 载荷（type{...}）不解析、按类型名近似渲染；
// force/viewers 槽位解析层拒绝（无多人分发）。
function VanillaForm({ cmd, i }: { cmd: VanillaCmd; i: number }) {
  const up = (p: Partial<VanillaCmd>) => setCommand(i, { ...cmd, ...p });
  return (
    <>
      <TextField
        label="粒子类型名（26.2 注册表，支持 type{NBT}）"
        value={cmd.name}
        list={VANILLA_PARTICLE_TYPES}
        placeholder="flame / dust{Red:1f,Green:0f,Blue:0f,Size:1f}"
        onChange={(v) => up({ name: v })}
      />
      {cmd.pos ? (
        <Vec3Field
          label="pos（~ = 玩家位置；空 = 玩家位置）"
          pos={cmd.pos}
          onChange={(pos: Vec3) => up({ pos })}
        />
      ) : (
        <button className="small" onClick={() => up({ pos: { x: { v: 0, rel: true }, y: { v: 0, rel: true }, z: { v: 0, rel: true } } })}>
          + 添加 pos（默认 ~ ~ ~）
        </button>
      )}
      {cmd.delta ? (
        <Vec3PlainField
          label="delta（各轴随机偏移标准差）"
          vec={cmd.delta}
          onChange={(delta) => up({ delta })}
        />
      ) : (
        <button className="small" onClick={() => up({ delta: { x: 0, y: 0, z: 0 } })}>
          + 添加 delta（默认 0 0 0）
        </button>
      )}
      <div className="field-row">
        <span className="field-row-label">speed（随机速度标准差 ≥0）</span>
        {cmd.speed !== null ? (
          <>
            <NumField label="值" value={cmd.speed} min={0} onChange={(v) => up({ speed: v })} />
            <button className="small" onClick={() => up({ speed: null })} title="清除（回到命令树默认 0）">
              ✕
            </button>
          </>
        ) : (
          <button className="small" onClick={() => up({ speed: 0 })}>
            + 设置（默认 0）
          </button>
        )}
      </div>
      <div className="field-row">
        <span className="field-row-label">count（0 = 单粒子）</span>
        {cmd.count !== null ? (
          <>
            <NumField label="值" value={cmd.count} min={0} integer onChange={(v) => up({ count: v })} />
            <button className="small" onClick={() => up({ count: null })} title="清除（回到命令树默认 0）">
              ✕
            </button>
          </>
        ) : (
          <button className="small" onClick={() => up({ count: 0 })}>
            + 设置（默认 0）
          </button>
        )}
      </div>
      <label className="numfield">
        <span className="numfield-label">normal（强制显示，无视粒子数量设置）</span>
        <input
          type="checkbox"
          checked={cmd.normal}
          onChange={(e) => up({ normal: e.target.checked })}
        />
      </label>
    </>
  );
}

export function CommandForm({ cmd, i }: { cmd: ParticleCommand; i: number }) {
  const [open, setOpen] = useState(true);
  const title =
    cmd.kind === 'normal' ? 'normal'
    : cmd.kind === 'conditional' ? 'conditional'
    : cmd.kind === 'parameter' ? parameterVariantName(cmd as ParameterCmd)
    : cmd.kind === 'group' ? 'group ' + cmd.sub
    : cmd.kind === 'vanilla' ? 'particle（原版）'
    : 'clearparticle';

  return (
    <div className="cmd-form">
      <div className="cmd-form-head">
        <button className="small" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'}
        </button>
        <span className="cmd-form-title">
          #{i + 1} {title}
        </span>
        <span className="spacer" />
        <button
          className="small"
          onClick={() =>
            insertCommandAfter(
              i,
              cmd.kind === 'group' && (cmd as GroupCmd).sub === 'remove' ? { ...DEFAULT_GROUP_REMOVE } : { kind: 'clearparticle' } as ClearCmd,
            )
          }
          title="在此后新增 clear"
        >
          +
        </button>
        <button className="small" onClick={() => removeCommand(i)} title="删除">
          ✕
        </button>
      </div>
      {open ? (
        <div className="cmd-form-body">
          {cmd.kind === 'normal' && <NormalForm cmd={cmd} i={i} />}
          {cmd.kind === 'conditional' && <ConditionalForm cmd={cmd} i={i} />}
          {cmd.kind === 'parameter' && <ParameterForm cmd={cmd} i={i} />}
          {cmd.kind === 'group' && <GroupForm cmd={cmd} i={i} />}
          {cmd.kind === 'vanilla' && <VanillaForm cmd={cmd} i={i} />}
          {cmd.kind === 'clearparticle' && <ClearForm />}
        </div>
      ) : null}
    </div>
  );
}
