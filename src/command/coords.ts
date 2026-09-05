// 坐标解析（计划 §六.4）：`~`/`~n`/`^`/`^n` 记 rel=true（执行期用可配置玩家位置求值），
// 纯数字为绝对值。MC 语义（计划 §2.2）：`~` = 玩家位置；`~n` = 玩家 ± n（整个
// 数值，含小数，都随玩家平移：`~0.5` = p+0.5，`~-1.5` = p-1.5）。
// 预览中 `^`（MC 语义「相对上一次位置」，玩家执行时即当前位置）与 `~` 等价，统一 rel。
// 这里只解析出 rel + 数值，求值放执行期（玩家位置可配置，解析期不定）。

import type { Coord } from './types';
import { CommandParseError } from './tokens';

// 整数/小数文本校验（MC DoubleArgumentType 子集：允许 1.5、-3、+2、.5、1e3）
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function isNum(text: string): boolean {
  return NUM_RE.test(text);
}

export function parseCoord(text: string, what: string): Coord {
  const t = text;
  if (t === '~' || t === '^') return { v: 0, rel: true };
  if (t.startsWith('~') || t.startsWith('^')) {
    const rest = t.slice(1);
    if (rest === '' ) return { v: 0, rel: true };
    if (!NUM_RE.test(rest)) {
      throw new CommandParseError(`invalid ${what} coordinate: ${text}`);
    }
    // 求值期：rel ? playerPos + v : v
    return { v: Number(rest), rel: true };
  }
  if (!NUM_RE.test(t)) {
    throw new CommandParseError(`invalid ${what} coordinate: ${text}`);
  }
  return { v: Number(t), rel: false };
}

// 三个坐标（命令位置 / group 的 pos）
export function parseVec3(texts: [string, string, string], what: string): {
  x: Coord;
  y: Coord;
  z: Coord;
} {
  return {
    x: parseCoord(texts[0], what),
    y: parseCoord(texts[1], what),
    z: parseCoord(texts[2], what),
  };
}

// 纯数值三元组（speed / range；MC 用 DoubleArgumentType/FloatArgumentType，不支持 ~）
export function parsePlain3(texts: [string, string, string], what: string): {
  x: number;
  y: number;
  z: number;
} {
  const vals: number[] = [];
  for (const t of texts) {
    if (!NUM_RE.test(t)) throw new CommandParseError(`invalid ${what}: ${t}`);
    vals.push(Number(t));
  }
  return { x: vals[0], y: vals[1], z: vals[2] };
}

// 颜色 r g b a，各 0.0~1.0（Color4ArgumentType：FloatArgumentType.floatArg(0,1)）
export function parseRGBA(texts: [string, string, string, string]): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  const vals: number[] = [];
  for (const t of texts) {
    if (!NUM_RE.test(t)) throw new CommandParseError(`invalid color component: ${t}`);
    const v = Number(t);
    if (v < 0 || v > 1) throw new CommandParseError(`color component out of [0,1]: ${t}`);
    vals.push(v);
  }
  return { r: vals[0], g: vals[1], b: vals[2], a: vals[3] };
}
