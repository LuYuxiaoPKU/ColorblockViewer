// 表单小字段：数字（含整数约束）、可含 ~ 的坐标、颜色四元组。
// 数字字段本地暂存草稿，blur/Enter 提交（避免输入中间态 "-"/"." 触发解析失败回跳）。

import { useEffect, useState } from 'react';
import type { Coord, Vec3, Vec3Plain } from '../command/types';

function fmtNum(v: number): string {
  return Object.is(v, -0) ? '0' : String(v);
}

export interface NumFieldProps {
  /** 行内小标签（与 field-row-label 冗余时可传 ''） */
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
}

export function NumField({ label, value, onChange, min, max, integer }: NumFieldProps) {
  const [draft, setDraft] = useState(fmtNum(value));
  const [bad, setBad] = useState(false);

  // 外部值变化（如表单整体替换）→ 同步草稿
  useEffect(() => {
    setDraft(fmtNum(value));
    setBad(false);
  }, [value]);

  const commit = () => {
    const s = draft.trim();
    if (s === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
      setBad(true);
      return;
    }
    let v = Number(s);
    if (integer && !Number.isInteger(v)) {
      setBad(true);
      return;
    }
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    setBad(false);
    if (v !== value) onChange(v);
    else setDraft(fmtNum(v));
  };

  return (
    <label className={'numfield' + (bad ? ' bad' : '')}>
      <span className="numfield-label">{label}</span>
      <input
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

// ---- 可含 ~ / ^ 的坐标（rel 用玩家位置求值）----

function parseCoord(s: string): Coord | null {
  const m = /^([~^]?)(.*)$/.exec(s.trim());
  if (!m) return null;
  const rest = m[2].trim();
  if (rest !== '' && !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(rest)) return null;
  return { rel: m[1] !== '', v: rest === '' ? 0 : Number(rest) };
}

function fmtCoord(c: Coord): string {
  return c.rel ? (c.v === 0 ? '~' : '~' + fmtNum(c.v)) : fmtNum(c.v);
}

function CoordInput({ label, c, onChange }: { label: string; c: Coord; onChange: (c: Coord) => void }) {
  const [draft, setDraft] = useState(fmtCoord(c));
  const [bad, setBad] = useState(false);

  useEffect(() => {
    setDraft(fmtCoord(c));
    setBad(false);
  }, [c.rel, c.v]);

  const commit = () => {
    const parsed = parseCoord(draft);
    if (!parsed) {
      setBad(true);
      return;
    }
    setBad(false);
    if (parsed.rel !== c.rel || parsed.v !== c.v) onChange(parsed);
  };

  return (
    <label className={'numfield' + (bad ? ' bad' : '')}>
      <span className="numfield-label">{label}</span>
      <input
        value={draft}
        spellCheck={false}
        placeholder="0 或 ~ / ~2"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

export function Vec3Field({ label, pos, onChange }: { label: string; pos: Vec3; onChange: (p: Vec3) => void }) {
  return (
    <div className="field-row">
      <span className="field-row-label">{label}</span>
      <CoordInput label="x" c={pos.x} onChange={(c) => onChange({ ...pos, x: c })} />
      <CoordInput label="y" c={pos.y} onChange={(c) => onChange({ ...pos, y: c })} />
      <CoordInput label="z" c={pos.z} onChange={(c) => onChange({ ...pos, z: c })} />
    </div>
  );
}

export function Vec3PlainField({
  label,
  vec,
  onChange,
  min,
}: {
  label: string;
  vec: Vec3Plain;
  onChange: (v: Vec3Plain) => void;
  min?: number;
}) {
  return (
    <div className="field-row">
      <span className="field-row-label">{label}</span>
      <NumField label="x" value={vec.x} min={min} onChange={(v) => onChange({ ...vec, x: v })} />
      <NumField label="y" value={vec.y} min={min} onChange={(v) => onChange({ ...vec, y: v })} />
      <NumField label="z" value={vec.z} min={min} onChange={(v) => onChange({ ...vec, z: v })} />
    </div>
  );
}

export function RgbaField({
  label,
  rgba,
  onChange,
}: {
  label: string;
  rgba: { r: number; g: number; b: number; a: number };
  onChange: (c: { r: number; g: number; b: number; a: number }) => void;
}) {
  return (
    <div className="field-row">
      <span className="field-row-label">{label}</span>
      <NumField label="r" value={rgba.r} min={0} max={1} onChange={(v) => onChange({ ...rgba, r: v })} />
      <NumField label="g" value={rgba.g} min={0} max={1} onChange={(v) => onChange({ ...rgba, g: v })} />
      <NumField label="b" value={rgba.b} min={0} max={1} onChange={(v) => onChange({ ...rgba, b: v })} />
      <NumField label="a" value={rgba.a} min={0} max={1} onChange={(v) => onChange({ ...rgba, a: v })} />
    </div>
  );
}

// 文本字段（组名 / 粒子名）：直接受控（无中间态问题）
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  list,
  badge,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  list?: string[];
  /** 字段行尾角标（如保真度 ✅/⚠️/❌）；title 悬停说明 */
  badge?: { text: string; title: string };
}) {
  // id 只保留字母数字/-/_（label 里的（）{}|. 等 CSS 选择器特殊字符会破坏
  // `input.list` 的 #id 解析——真实浏览器走 getElementById 无碍，但 happy-dom 用
  // querySelector('#'+id)，非 ASCII 安全字符必须剔除）
  const id = 'dl-' + label.replace(/[^\p{L}\p{N}_-]/gu, '-');
  return (
    <label className="numfield textfield">
      <span className="numfield-label">
        {label}
        {badge ? <span className="field-badge" title={badge.title}>{badge.text}</span> : null}
      </span>
      <input
        value={value}
        list={list ? id : undefined}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      {list ? (
        <datalist id={id}>
          {list.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}
