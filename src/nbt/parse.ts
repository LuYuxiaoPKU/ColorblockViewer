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
// 文档化近似（CFR 反编译 SnbtGrammar/SnbtOperations 坐实的缺口，场景极低频不修）：
// ① 字符串反斜杠转义（游戏内 \n \t \" \\ \xHH \uHHHH \UHHHHHHHH \N{name} 会
//    转换，预览把反斜杠当普通字符——"a\"b" 按未闭合拒；块名/物品名等本场景
//    字符串值不含反斜杠，无实际消费场景）；
// ② 单引号字符串的 '' 转义（游戏内单引号串不支持 '' 转义——首个 ' 即闭串，
//    'a''b' 游戏拒；本解析器放行为 a'b'）；
// ③ 内置操作 bool(x)/uuid(x)（游戏内裸词 bool(1) 可调用，本解析器无此路径——
//    type{NBT} 的 22 个粒子 options codec 均无 boolean/UUID 字段，用不到）；
// ④ 带 f/F 后缀的浮点按 double 解析（游戏内转 float32，如 0.1f 游戏内 =
//    0.10000000149011612，预览 = 0.1；~2^-23 相对差，不影响可视化）；
// ⑤ 十进制带 B/S/I/L 后缀的位宽越界**与游戏一致拒绝**（SIGNED 解析域：B ±127 /
//    S ±32767 / I ±2^31-1，越界 = Java NumberFormatException 同拒；float/指数
//    体 + 后缀游戏无匹配 → 拒）；L 后缀游戏 = long 域（±2^63-1），预览域止于
//    int/uint32（-2^31..2^32-1，越界拒——schema 无 long 字段，命令结果一致）。
// ⑥ unquoted 字符串含冒号（brigadier 1.3.10 readUnquotedString 字符集
//    = [0-9A-Za-z_.+-]，无冒号——minecraft:food 游戏内读成 minecraft 后
//    trailing data 拒，data component key 须带引号 "minecraft:food"；
//    预览宽松：取**最后一个**顶层冒号作 key/value 分隔）。

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
      // 文档化近似⑥：游戏 unquoted 字符集不含冒号（readUnquotedString 到冒号停 +
      // trailing data 拒，data component key 须带引号）→ 取**最后一个**顶层冒号
      // 作 key/value 分隔，键/值可各含冒号（宽松放行）
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
 *  十进制整数后缀 = SIGNED 解析域（signedOrDefault：decimal base → SIGNED；
 *  parseByte/Short/Int/Long(radix 10) 溢出 = 游戏 NumberFormatException 拒）：
 *  B ±127、S ±32767、I ±2^31-1、L -2^31..2^32-1（预览域止于 int/uint32：
 *  schema 无 long 字段，int 范围外的 long 值游戏里亦被 INT codec 拒——
 *  命令结果一致，文档化近似仅 L 的 2^32..2^63-1 段）；float/指数体 +
 *  B/S/I/L 后缀游戏无匹配 → 拒。
 *  ④ `+` 号字面量与游戏一致（canStartNumber 含 '+'：+5 / +1.0f 解析放行；
 *  +05 仍按前导零拒）——与 parseNum 的 `[+-]?` 正则吻合，无近似。
 *  ⑤ hex/二进制的显式符号：游戏内 **减号** 被拒（IntegerLiteral.create：
 *  signedOrDefault(HEX/BINARY)=UNSIGNED + Sign.MINUS → ERROR_EXPECTED_NON_NEGATIVE
 *  _NUMBER——-0xFF / -0b101 游戏拒，预览拒，一致）；**加号** 游戏放行
 *  （+0xFF = 无符号 255），预览拒（hex/二进制正则不带符号）——NBT 值域内
 *  正数均可无符号写法，命令结果一致，文档化近似。 */
function parseNum(s: string): number {
  // 二进制字面量（integer_literal: 0 → b/B → binary_numeral，两版同构）：
  // 数字运行仅 {0,1,_}（无 a-f → 尾 f/F/d/D 不是数字，0b101f 游戏拒——
  // 无 f/F/d/D 整数后缀）；无后缀 = BINARY base → signedOrDefault 兜底 UNSIGNED
  //（同 hex：INT 位模式，0b1000…0（32 位）→ -2147483648）；B/S/I/L 后缀位宽
  // 语义同 hex 分支（I 走有符号 parseInt：>0xFFFFFFFF 拒，≥2^31 取 int 位模式）
  if (/^0[bB][01](?:[_01]*[01])?[bBsSiIlL]?$/.test(s)) {
    const suf = (s[s.length - 1] || '').toLowerCase();
    const isSuffix = suf === 'b' || suf === 's' || suf === 'i' || suf === 'l';
    let digits = isSuffix ? s.slice(2, -1) : s.slice(2);
    const u = parseInt(digits.replace(/_/g, ''), 2);
    if (suf === 'b' && u > 0xff) throw new NbtParseError(`数值无效："${s}"`);
    if (suf === 's' && u > 0xffff) throw new NbtParseError(`数值无效："${s}"`);
    if (suf === 'i' && u > 0xffffffff) throw new NbtParseError(`数值无效："${s}"`);
    if (suf === 'l' && u > 0xffffffff) throw new NbtParseError(`数值无效："${s}"`);
    // 无后缀 = parseUnsignedInt（>0xFFFFFFFF 抛 NumberFormatException 游戏拒——
    // 33 位二进制 0b1000…0（33 个 0）= 2^32 必须拒，否则 JS 静默回绕成 0）
    if (!isSuffix && u > 0xffffffff) throw new NbtParseError(`数值无效："${s}"`);
    if (isSuffix) return suf === 'i' && u >= 0x80000000 ? u - 0x100000000 : u;
    return u >= 0x80000000 ? u - 0x100000000 : u; // 无后缀 INT：parseUnsignedInt 位模式
  }
  if (/^0[xX][0-9a-fA-F](?:[_0-9a-fA-F]*[0-9a-fA-F])?[bBsSiIlLfFdD]?$/.test(s)) {
    // 类型后缀仅 b/s/i/l（B/S/I/L）可跟在十六进制后：F/f/D/d 本身是十六进制数字
    // （SnbtGrammar 的 hex 数字运行对 [0-9a-fA-F] 贪婪 → 0xFF 的尾 F 是数字，
    // 不是 float 后缀）。旧正则 [..fFdD]$ 会把 0x0000FF 的尾 F 当后缀剥掉 → 15。
    // SnbtGrammar 字节码（两版同构，见 particleOptions.ts 头注）：
    //   无后缀 → INT + parseUnsignedInt（0x80000000 → 位模式 -2147483648）
    //   B 后缀 → UnsignedBytes.parseUnsignedByte（>0xFF 拒绝）
    //   S 后缀 → parseUnsignedShort（>0xFFFF 拒绝）
    //   L 后缀 → parseUnsignedLong（>0xFFFFFFFFFFFFFFFF 拒绝，JS 端不深查）
    //   I 后缀 → 有符号 parseInt（>0xFFFFFFFF 拒绝；0x80000000I 等放行且取
    //   int 位模式 -2147483648——与无后缀同形，schema 无 int 字段必拒）
    const suf = (s[s.length - 1] || '').toLowerCase();
    const isSuffix = suf === 'b' || suf === 's' || suf === 'i' || suf === 'l';
    // 下划线 = 数字分隔符（两版数字运行谓词 tableswitch 均含 95 '_'，
    // cleanAndAppend 剥离后取值）。NumberRunParseRule 字节码：run 的**首/尾字符
    // 为下划线 → underscoreNotAllowedError**；连续下划线允许（1_0_0 放行）
    let digits = isSuffix ? s.slice(2, -1) : s.slice(2);
    const u = parseInt(digits.replace(/_/g, ''), 16);
    if (suf === 'b' && u > 0xff) throw new NbtParseError(`数值无效："${s}"`);
    if (suf === 's' && u > 0xffff) throw new NbtParseError(`数值无效："${s}"`);
    if (suf === 'i' && u > 0xffffffff) throw new NbtParseError(`数值无效："${s}"`);
    // L 后缀 = parseUnsignedLong（0..2^64-1 均合法 long）。预览数值域止于 int
    // （schema 无 long 字段；>2^32-1 的 long 值 JS 亦不精确）→ 仅放行 ≤0xFFFFFFFF，
    // 越界拒绝（文档化近似：0xFFFFFFFFFFFFFFFFL = -1 游戏内是合法 long，此处拒）
    if (suf === 'l' && u > 0xffffffff) throw new NbtParseError(`数值无效："${s}"`);
    // 无后缀 = parseUnsignedInt（>0xFFFFFFFF 抛 NumberFormatException 游戏拒——
    // 0x100000000（2^32）必须拒，否则 JS 静默回绕成 0）
    if (!isSuffix && u > 0xffffffff) throw new NbtParseError(`数值无效："${s}"`);
    if (isSuffix) return suf === 'i' && u >= 0x80000000 ? u - 0x100000000 : u; // I 后缀：parseInt 位模式
    return u >= 0x80000000 ? u - 0x100000000 : u; // 无后缀 INT：parseUnsignedInt 位模式
  }
  // 十进制各数字运行（整数/小数/指数部分）均为 decimalNumeral run →
  // NumberRunParseRule：run 的**首/尾字符为下划线**拒、连续下划线允许
  // （1__0 游戏放行——与 hex/binary 分支同形态）
  const m = s.match(
    /^([+-]?(?:(?:\d(?:[0-9_]*\d)?|\d)(?:\.(?:\d(?:[0-9_]*\d)?|\d))?(?:[eE][+-]?\d(?:[0-9_]*\d)?)?|\.\d+(?:[0-9_]*\d)?))([fFdDIlBsSL])?$/,
  );
  if (!m) throw new NbtParseError(`数值无效："${s}"`);
  // 下划线 = 数字分隔符（cleanAndAppend 剥离后取值）；Number() 前剥离
  const v = Number(m[1].replace(/_/g, ''));
  if (!isFinite(v)) throw new NbtParseError(`数值无效："${s}"`);
  // 前导零拒绝（integer_literal 的 decimal 分支：0 cut fail(ERROR_LEADING_ZERO_NOT_ALLOWED)
  // ——仅**整数 literal**（无 `.` 无 e/E，含带 B/S/I/L 后缀）有该 fail；
  // float_literal 无此分支 → 0123 拒、0123.4 放行、0 放行）。
  // 0 后跟数字**或下划线**同样拒（游戏：0 消费后 decimalNumeral run 首字符
  // 为数字→前导零 fail / 为下划线→underscoreNotAllowed；回退 marker 只吃掉
  // 裸 0，0123/0_5 的尾部皆成 trailing data → 整体拒）
  if (!/\./.test(m[1]) && !/[eE]/.test(m[1]) && /^[+-]?0[\d_]/.test(m[1])) {
    throw new NbtParseError(`数值无效："${s}"`);
  }
  // 十进制整数后缀（signedOrDefault：decimal base → SIGNED；integer 后缀须纯整数
  // 体——游戏里 float/指数 + B/S/I/L 无匹配 → 拒）：
  const suf = (m[2] || '').toLowerCase();
  const isIntSuf = suf === 'b' || suf === 's' || suf === 'i' || suf === 'l';
  if (isIntSuf && (/\./.test(m[1]) || /[eE]/.test(m[1]))) {
    throw new NbtParseError(`数值无效："${s}"`);
  }
  // 位宽 = SIGNED 解析域（parseByte/Short/Int 溢出 → NumberFormatException 游戏拒）：
  if (suf === 'b' && (v < -128 || v > 127)) throw new NbtParseError(`数值无效："${s}"`);
  if (suf === 's' && (v < -32768 || v > 32767)) throw new NbtParseError(`数值无效："${s}"`);
  if (suf === 'i' && (v < -0x80000000 || v > 0x7fffffff)) throw new NbtParseError(`数值无效："${s}"`);
  // L：游戏 = long 域（±2^63-1）；预览域止于 int/uint32（schema 无 long 字段、JS
  // 精度）→ -0x80000000..0xFFFFFFFF 放行，越界拒。命令结果一致：int 范围外的
  // long 值游戏里亦被 INT codec 拒（schema 无 long 字段）。
  if (suf === 'l' && (v < -0x80000000 || v > 0xffffffff)) throw new NbtParseError(`数值无效："${s}"`);
  return v;
}
