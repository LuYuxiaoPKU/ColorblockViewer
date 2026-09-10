// SNBT compact 格式解析器（type{NBT} 命令参数用）。
// 取证 ground truth：
//   1.21.11 混淆版 ls.class（= DustParticleOptions）字节码：
//     CODEC = RecordCodecBuilder { color: RGB_COLOR_CODEC, scale: FLOAT }
//     RGB_COLOR_CODEC = Codec.INT.withAlternative(VECTOR3F, vec3f→int)
//     REDSTONE = new ls(0xFF0000, 1f)   // 红石色 = (255,0,0)
//   26.2 命名版 DustParticleOptions.class 同构（color:I + ScalableParticleOptionsBase）。
//   ScalableParticleOptionsBase: scale ∈ [0.01f, 4.0f]。
// 词法边界与游戏一致：命令参数按 brigadier readUnquotedString/readString 分词
// （见 command/tokens.ts），因此 NBT 载荷内**不含空白**（游戏内命令模式 SNBT
// 同样不容空白）——本解析器遇到空白即报「命令模式 NBT 不容空白」。
// 支持：compound（含嵌套）、list、int（十/十六进制 + 类型后缀）、float、
// 布尔、引号字符串（"" 转义）。非法语法 → NbtParseError（中文消息）。

export class NbtParseError extends Error {
  constructor(msg: string) { super(msg); this.name = 'NbtParseError'; }
}

/** 解析后的 SNBT 值：标量（数字/布尔/字符串）、列表、compound（键→值）。 */
export type NbtVal = number | boolean | string | NbtVal[] | { [key: string]: NbtVal };
export interface NbtField { key: string; val: NbtVal; }

/** 解析 SNBT compound 体（不含外层花括号）。空串 → []（等价 `{}`）。
 *  字段以顶层逗号分隔；key 为裸词 [a-zA-Z0-9_] 或引号字符串。 */
export function parseCompound(body: string): NbtField[] {
  const parts = splitTop(body, ',');
  const out: NbtField[] = [];
  for (const raw of parts) {
    let part = raw;
    if (part.trim() === '') continue;
    if (/\s/.test(part)) throw new NbtParseError('命令模式 NBT 不容空白');
    // key：引号字符串或裸词，其后紧跟顶层 ':'
    let key: string;
    if (part[0] === '"' || part[0] === "'") {
      const q = part[0];
      let i = 1, buf = '';
      while (i < part.length) {
        if (part[i] === q) {
          if (i + 1 < part.length && part[i + 1] === q) { buf += q; i += 2; continue; }
          i++; break;
        }
        buf += part[i]; i++;
      }
      if (i >= part.length || part[i] !== ':') throw new NbtParseError(`字段 "${part}" 格式无效（引号 key 后需紧跟冒号）`);
      key = buf;
      part = part.slice(i + 1);
    } else {
      const ci = findTop(part, ':');
      if (ci < 0) throw new NbtParseError(`字段 "${part}" 缺少冒号`);
      key = part.slice(0, ci);
      if (!/^[a-zA-Z0-9_]+$/.test(key)) throw new NbtParseError(`字段名无效："${key}"`);
      part = part.slice(ci + 1);
    }
    out.push({ key, val: parseVal(part) });
  }
  return out;
}

/** 按顶层（不在 [ ] { } 内、不在引号内）的 sep 分割；允许尾空项（如 `a:1,` 由 trim 跳过）。 */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let d = 0, st = 0, q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) {
        if (i + 1 < s.length && s[i + 1] === q) i++; // 转义引号
        else q = null;
      }
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') d--;
    else if (c === sep && d === 0) { out.push(s.slice(st, i)); st = i + 1; }
  }
  if (q) throw new NbtParseError('引号未闭合');
  if (d !== 0) throw new NbtParseError('花括号/方括号不配对');
  out.push(s.slice(st));
  return out;
}

/** 找第一个不在 [ ] { } 内、不在引号内的 ch；未找到 → -1。 */
function findTop(s: string, ch: string): number {
  let d = 0, q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) {
        if (i + 1 < s.length && s[i + 1] === q) i++;
        else q = null;
      }
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') d--;
    else if (c === ch && d === 0) return i;
  }
  return -1;
}

function parseVal(s: string): NbtVal {
  if (s === '') throw new NbtParseError('值不能为空');
  if (s[0] === '{') {
    // compound 值：须恰好消费到串尾（命令分词已保证无空白截断）
    if (!s.endsWith('}')) throw new NbtParseError(`compound 未闭合："${s}"`);
    const fields = parseCompound(s.slice(1, -1));
    const obj: { [k: string]: NbtVal } = {};
    for (const f of fields) obj[f.key] = f.val;
    return obj;
  }
  if (s[0] === '[') {
    if (!s.endsWith(']')) throw new NbtParseError(`列表未闭合："${s}"`);
    const inner = s.slice(1, -1);
    if (inner.trim() === '') return [];
    return splitTop(inner, ',').map(t => parseVal(t));
  }
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    if (s.length < 2 || s[s.length - 1] !== q) throw new NbtParseError(`字符串未闭合："${s}"`);
    let buf = '';
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i] === q) {
        if (i + 1 < s.length - 1 && s[i + 1] === q) { buf += q; i++; continue; }
        throw new NbtParseError(`字符串未闭合："${s}"`);
      }
      buf += s[i];
    }
    return buf;
  }
  if (s === 'true' || s === 'false') return s === 'true';
  return parseNum(s);
}

/** 解析 SNBT 数值：
 *  十六进制：0xFF / 0xFF0000 / 0xFFI（类型后缀 I/L/F/D/B/S 剥除）
 *  十进制：123 / -42 / 1.0 / 1.0f / 1.0d / 1I / 1L（后缀剥除后取数值） */
function parseNum(s: string): number {
  if (/^0[xX][0-9a-fA-F]+[bBsSiIlLfFdD]?$/.test(s)) {
    return parseInt(s.replace(/[bBsSiIlLfFdD]$/, ''), 16);
  }
  const m = s.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[fFdDIlBsS]?$/);
  if (!m) throw new NbtParseError(`数值无效："${s}"`);
  const v = Number(m[1]);
  if (!isFinite(v)) throw new NbtParseError(`数值无效："${s}"`);
  return v;
}
