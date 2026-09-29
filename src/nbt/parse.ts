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
      // SNBT 裸 key 可含冒号（命名空间分隔，如 minecraft:food）→ 取**最后一个**
      // 顶层冒号作 key/value 分隔（值域为数值/布尔/列表/compound，裸值不含冒号）
      let ci = -1, d2 = 0, q2: string | null = null;
      for (let i2 = 0; i2 < part.length; i2++) {
        const c2 = part[i2];
        if (q2) {
          if (c2 === q2) {
            if (i2 + 1 < part.length && part[i2 + 1] === q2) i2++;
            else q2 = null;
          }
        } else if (c2 === '"' || c2 === "'") q2 = c2;
        else if (c2 === '[' || c2 === '{') d2++;
        else if (c2 === ']' || c2 === '}') d2--;
        else if (c2 === ':' && d2 === 0) ci = i2;
      }
      if (ci < 0) throw new NbtParseError(`字段 "${part}" 缺少冒号`);
      key = part.slice(0, ci);
      if (!/^[a-zA-Z0-9_:\-.]+$/.test(key)) throw new NbtParseError(`字段名无效："${key}"`);
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
  try {
    return parseNum(s);
  } catch (e) {
    // 未加引号的字符串（SnbtGrammar unquotedString = PLAIN_STRING_CHUNK+，
    // 首字符不得为数字类——isAllowedToStartUnquotedString = !canStartNumber；
    // 数字类开头先走 numeric literal 规则）→ 裸块名 stone 是合法字符串值，
    // 而 0xZZ/1abc 仍按数值规则报错
    if (e instanceof NbtParseError && !/^[+-.0-9]/.test(s)) return s;
    throw e;
  }
}

/** 解析 SNBT 数值：
 *  十六进制：0xFF / 0xFF0000 / 0xFFI（无后缀 = INT 无符号取值，B/S/I/L 后缀
 *  按各自位宽语义——见函数内注释；两版字节码同构，见 particleOptions.ts 头注）
 *  十进制：123 / -42 / 1.0 / 1.0f / 1.0d / 1I / 1L（后缀剥除后取数值）
 *  近似边界（文档化）：十进制带 B/S/L 后缀不做 Java 的位宽越界拒绝（如 128B 游戏内
 *  NumberFormatException，此处放行）——type{NBT} schema 无 byte/short 字段，
 *  该写法无实际消费场景。 */
function parseNum(s: string): number {
  if (/^0[xX][0-9a-fA-F_]*[0-9a-fA-F][bBsSiIlLfFdD]?$/.test(s)) {
    // 类型后缀仅 b/s/i/l（B/S/I/L）可跟在十六进制后：F/f/D/d 本身是十六进制数字
    // （SnbtGrammar 的 hex 数字运行对 [0-9a-fA-F] 贪婪 → 0xFF 的尾 F 是数字，
    // 不是 float 后缀）。旧正则 [..fFdD]$ 会把 0x0000FF 的尾 F 当后缀剥掉 → 15。
    // SnbtGrammar 字节码（两版同构，见 particleOptions.ts 头注）：
    //   无后缀 → INT + parseUnsignedInt（0x80000000 → 位模式 -2147483648）
    //   B 后缀 → UnsignedBytes.parseUnsignedByte（>0xFF 拒绝）
    //   S 后缀 → parseUnsignedShort（>0xFFFF 拒绝）
    //   L 后缀 → parseUnsignedLong（>0xFFFFFFFFFFFFFFFF 拒绝，JS 端不深查）
    //   I 后缀 → 有符号 parseInt（>0x7FFFFFFF 拒绝）
    const suf = (s[s.length - 1] || '').toLowerCase();
    const isSuffix = suf === 'b' || suf === 's' || suf === 'i' || suf === 'l';
    // 下划线 = 数字分隔符（两版数字运行谓词 tableswitch 均含 95 '_'，
    // cleanAndAppend 剥离后取值）——先剥再判位数/后缀
    let digits = isSuffix ? s.slice(2, -1) : s.slice(2);
    if (digits.includes('_')) {
      digits = digits.replace(/_/g, '');
      if (!/^[0-9a-fA-F]+$/.test(digits)) throw new NbtParseError(`数值无效："${s}"`);
    }
    const u = parseInt(digits, 16);
    if (suf === 'b' && u > 0xff) throw new NbtParseError(`数值无效："${s}"`);
    if (suf === 's' && u > 0xffff) throw new NbtParseError(`数值无效："${s}"`);
    if (suf === 'i' && u > 0x7fffffff) throw new NbtParseError(`数值无效："${s}"`);
    // L 后缀 = parseUnsignedLong（0..2^64-1 均合法 long）。预览数值域止于 int
    // （schema 无 long 字段；>2^32-1 的 long 值 JS 亦不精确）→ 仅放行 ≤0xFFFFFFFF，
    // 越界拒绝（文档化近似：0xFFFFFFFFFFFFFFFFL = -1 游戏内是合法 long，此处拒）
    if (suf === 'l' && u > 0xffffffff) throw new NbtParseError(`数值无效："${s}"`);
    if (isSuffix) return u; // B/S/I/L 后缀：值本身
    return u >= 0x80000000 ? u - 0x100000000 : u; // 无后缀 INT：parseUnsignedInt 位模式
  }
  const m = s.match(
    /^([+-]?(?:(?:\d+(?:_\d+)*\d*|\d)\.?\d*(?:[eE][+-]?\d+)?|\.\d+))[fFdDIlBsS]?$/,
  );
  if (!m) throw new NbtParseError(`数值无效："${s}"`);
  // 下划线 = 数字分隔符（两版数字运行谓词 tableswitch 均含 95 '_'，
  // cleanAndAppend 剥离后取值）；仅支持整数部分（小数部分下划线 = 文档化近似，
  // type{NBT} 无此用法）。Number() 前剥离
  const v = Number(m[1].replace(/_/g, ''));
  if (!isFinite(v)) throw new NbtParseError(`数值无效："${s}"`);
  return v;
}
