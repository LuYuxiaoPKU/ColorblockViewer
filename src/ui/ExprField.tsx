// M5 表达式输入：防抖 ~150ms 调引擎 parse 做实时编译校验（绿/红 + 英文原文 +
// 中文提示），正则切 token 轻量高亮。
//
// 校验语义与执行一致：parse 成功 = 生成期不会因表达式失败；运行期错误
// （/ by zero 等）不在此提示——只有编译期/验证期错误（消息形如
// java.lang.XxxException: msg 或裸引擎错误）能静态判定。
//
// 空串 / "null" 是合法值（命令层 strOrNull / Java ExpressionUtil.parse(null)），
// 不做红标。

import { useEffect, useRef, useState } from 'react';
import { parse } from '../engine';
import { FIELD_NAMES } from '../engine/struct';
import { MATH_FUNC_NAMES } from './exprTokens';

export interface ExprFieldProps {
  label: string;
  value: string | null; // null = 该槽位未填（显示空框；提交时写回 null）
  onChange: (v: string | null) => void;
  hint?: string;
}

// 中文提示映射（计划 §九：英文原文 + 中文映射；未命中 → 原文直显）
// 中文提示映射（计划 §九：英文原文 + 中文映射；未命中 → 原文直显）。
// 消息形如 `java.lang.XxxException: msg` → 模式不锚定行首，直接匹配消息体。
const CN_HINTS: [RegExp, string][] = [
  [/undefine var: .+/, '未定义变量（左侧须先赋值，或使用粒子字段 x/y/z/vx…）'],
  [/function not found: .+/, '未知函数（查「可用函数」提示）'],
  [/bad matrix/, '矩阵格式错误（缺元素，如 (1,2,,3)）'],
  [/the number must/, '数字位置错误（矩阵不能出现在该处）'],
  [/can't deconstruction number/, '解构失败（该值不是矩阵，不能展开赋值）'],
  [/\/ by zero/, '整数除以 0'],
  [/integer overflow/, '整数溢出'],
  [/Bad type on operand stack/, '矩阵解构到局部变量：引擎不支持（复刻 Java VerifyError）'],
  [/bad type/, '类型不匹配'],
  [/Update to non-static final field/, '不能给常量 PI/E 赋值'],
  [/need matrix, function call, assign expression, var, number/, '表达式语法错误（期望赋值/函数/变量/数字）'],
  [/Cannot invoke "com\.noone\.particleex/, '空表达式或 "null" 字面量（此槽位不允许）'],
  [/Index .* out of bounds/, '运行期数组越界（矩阵维度）'],
  [/括号嵌套过深/, '括号嵌套过深：Java 原版会指数级回溯卡死，预览已中止（请拆成浅层表达式）'],
];

export function exprCnHint(msg: string): string {
  for (const [re, cn] of CN_HINTS) if (re.test(msg)) return cn;
  return '';
}

export function ExprField({ label, value, onChange, hint }: ExprFieldProps) {
  const [error, setError] = useState<string | null>(null);
  const timer = useRef(0);

  // 值变化 → 防抖 150ms 重新校验（parse 带缓存，重复文本几乎零成本）
  useEffect(() => {
    window.clearTimeout(timer.current);
    const v = value ?? '';
    if (v === '' || v === 'null') {
      // 空 / "null" 字面量是命令层合法值（strOrNull），不红标
      setError(null);
      return;
    }
    timer.current = window.setTimeout(() => {
      try {
        parse(v);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 150);
    return () => window.clearTimeout(timer.current);
  }, [value]);

  const status = value === '' ? 'empty' : error === null ? 'ok' : 'err';
  const cn = error ? exprCnHint(error) : '';

  return (
    <div className={'expr-field ' + status}>
      <div className="field-label">
        {label}
        {hint ? <span className="expr-hint"> {hint}</span> : null}
      </div>
      <input
        className="cmd-input expr-input"
        value={value ?? ''}
        placeholder="null"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
      {status === 'ok' && <div className="expr-status ok">✓ 表达式可编译</div>}
      {status === 'err' && (
        <div className="expr-status err">
          {error}
          {cn ? <div className="expr-status-cn">{cn}</div> : null}
        </div>
      )}
    </div>
  );
}

// 轻量 token 高亮（只读预览用；输入框本体是普通 input，高亮渲染在下方预览条）。
// 顺序敏感：字段名 > 函数名 > 数字 > 运算符（矩阵括号不整体高亮，
// 括号内的字段/数字仍逐 token 命中）。
const RE = new RegExp(
  [
    '(' + FIELD_NAMES.join('|') + ')', // 1 粒子字段
    '(' + MATH_FUNC_NAMES.join('|') + ')', // 2 函数名
    '(-?\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)', // 3 数字
    '([+\\-*/^%&|!<>=]=?|;|,|=)', // 4 运算符
  ].join('|'),
  'g',
);

export function highlightExpr(src: string): { text: string; cls: string }[] {
  const out: { text: string; cls: string }[] = [];
  let last = 0;
  for (const m of src.matchAll(RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: src.slice(last, i), cls: '' });
    let cls = '';
    if (m[1] !== undefined) cls = 'tok-field';
    else if (m[2] !== undefined) cls = 'tok-func';
    else if (m[3] !== undefined) cls = 'tok-num';
    else cls = 'tok-op';
    out.push({ text: m[0], cls });
    last = i + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last), cls: '' });
  return out;
}

export function ExprHighlight({ src }: { src: string }) {
  if (!src) return null;
  return (
    <div className="expr-preview">
      {highlightExpr(src).map((t, i) =>
        t.cls ? (
          <span key={i} className={t.cls}>
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </div>
  );
}
