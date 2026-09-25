// 数字字段（SettingsDrawer 用）：本地暂存草稿，blur/Enter 提交
// （避免输入中间态 "-"/"." 触发解析失败回跳）。

import { useEffect, useState } from 'react';

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

  // 外部值变化（如设置整体替换）→ 同步草稿
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
