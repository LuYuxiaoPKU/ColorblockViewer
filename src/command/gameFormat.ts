// 游戏内命令格式检查（「查验这个格式」）：判断一行命令粘回游戏后是否**逐参数合法**。
//
// 为什么需要它：预览的分词是**宽松**的（未加引号的词读到空白为止），而游戏的
// brigadier `string()` 参数用的是 `readUnquotedString` —— 只允许
// `0-9 A-Z a-z _ - . +`，遇到 `( ) * ^ & < = , ; ! / ~` 等字符就**停下**，
// 于是 `...(abs(y-...)<0.05)&(...)...` 这类裸写表达式在游戏里会被截断、后续参数
// 全部错位（报 "Expected double" 之类）。预览仍然接受这种输入（方便直接粘贴
// 未整理的文本），但必须**明确告诉用户**它不能直接用于游戏。
//
// 判定按**参数位**逐一进行（用 schema 里的用法布局）：文本位（表达式/组名）
// 缺引号 → 报错级提示；数值位被引号包住 → 同样报错（`'"5"'` 游戏内解析失败）；
// 粒子名/标识符位不加引号（裸写 `minecraft:end_rod` 才合法）。

import { tokenizeWithMeta, CommandParseError } from './tokens';

/** brigadier `StringReader.isAllowedInUnquotedString` 允许的字符集 */
export const UNQUOTED_OK = /^[0-9A-Za-z_.+-]+$/;

export interface FormatIssue {
  /** 词序号（0 起，含子命令等前缀词） */
  index: number;
  token: string;
  /** true = 游戏内无法解析（必须改）；false = 提示级 */
  fatal: boolean;
  message: string;
}

export interface LineFormatReport {
  /** 1 起行号 */
  line: number;
  text: string;
  issues: FormatIssue[];
}

type ArgKind = 'text' | 'number' | 'coord' | 'identifier' | 'enum';

/** 各子命令的参数位类型（对齐 schema.ts 的用法布局；前缀词由调用方剥离）。
 *  - text       → brigadier `string()`：需引号（表达式 / 组名 / 条件表达式）
 *  - number     → 数值（double/int）：实际类型各子命令不同，但**都不要引号**
 *  - coord      → 坐标（`~`/`^` 相对坐标由 Vec3 读取器处理，也不加引号）
 *  - identifier → resource location（允许 `:` `/`）→ 不加引号
 *  - enum       → 字面枚举（`parameter|speedexpression`、`normal`）→ 不加引号 */
const NAME: ArgKind[] = ['identifier'];
const POS: ArgKind[] = ['coord', 'coord', 'coord'];
/** n 个数值位 */
const nums = (n: number): ArgKind[] => Array.from({ length: n }, () => 'number' as ArgKind);
/** 公共尾部（前缀封闭）：[age] [速度表达式] [speedStep] [group] */
const TAIL: ArgKind[] = ['number', 'text', 'number', 'text'];

const LAYOUTS: Record<string, ArgKind[]> = {
  // 名 位置 颜色 速度 范围 数量 [age] [速度表达式] [speedStep] [group]
  normal: [...NAME, ...POS, ...nums(4 + 3 + 3 + 1), ...TAIL],
  // 名 位置 颜色 速度 范围 表达式 step [age] [速度表达式] [speedStep] [group]
  conditional: [...NAME, ...POS, ...nums(4 + 3 + 3), 'text', ...nums(1), ...TAIL],
  // 名 位置 颜色 速度 begin end 表达式 step（[cpt] 仅 tick） [age] [速度表达式] [speedStep] [group]
  parameter: [...NAME, ...POS, ...nums(4 + 3 + 2), 'text', ...nums(1), ...TAIL],
  polarparameter: [...NAME, ...POS, ...nums(4 + 3 + 2), 'text', ...nums(1), ...TAIL],
  tickparameter: [...NAME, ...POS, ...nums(4 + 3 + 2), 'text', ...nums(2), ...TAIL],
  tickpolarparameter: [...NAME, ...POS, ...nums(4 + 3 + 2), 'text', ...nums(2), ...TAIL],
  // rgba 变体无颜色位
  rgbaparameter: [...NAME, ...POS, ...nums(3 + 2), 'text', ...nums(1), ...TAIL],
  rgbapolarparameter: [...NAME, ...POS, ...nums(3 + 2), 'text', ...nums(1), ...TAIL],
  rgbatickparameter: [...NAME, ...POS, ...nums(3 + 2), 'text', ...nums(2), ...TAIL],
  rgbatickpolarparameter: [...NAME, ...POS, ...nums(3 + 2), 'text', ...nums(2), ...TAIL],
  // group remove <组> [表达式] [位置]
  'group remove': ['text', 'text', ...POS],
  // group change <parameter|speedexpression> <组> <表达式> [条件表达式] [位置]
  'group change': ['enum', 'text', 'text', 'text', ...POS],
  clearparticle: [],
};

/** 原版 `/particle`：粒子名(+NBT) 位置 delta 速度 数量 [normal] */
const VANILLA_LAYOUT: ArgKind[] = [...NAME, ...POS, ...nums(3 + 1 + 1), 'enum'];

const KIND_HINT: Record<string, string> = {
  text: '文本参数（表达式/组名）',
  number: '数值参数',
  coord: '坐标参数',
  identifier: '标识符参数（粒子名）',
  enum: '枚举字面量',
};

function kindFor(sub: string, vanilla: boolean, argIndex: number): ArgKind | null {
  const layout = vanilla ? VANILLA_LAYOUT : LAYOUTS[sub];
  if (!layout) return null;
  return layout[argIndex] ?? null; // 超出已知布局（多余参数）→ 不检查（解析层会报错）
}

/** 检查一行命令的**游戏内格式**（引号使用是否正确）。返回问题列表（空 = 可直接粘回游戏）。 */
export function checkCommandFormat(line: string): FormatIssue[] {
  const issues: FormatIssue[] = [];
  let toks: { value: string; quoted: boolean }[];
  try {
    toks = tokenizeWithMeta(line);
  } catch (err) {
    if (err instanceof CommandParseError) {
      return [{ index: 0, token: '', fatal: true, message: err.message }];
    }
    throw err;
  }
  if (toks.length === 0) return issues;

  // 前缀词：/particleex <sub> | /particle
  let i = 0;
  let sub = '';
  let vanilla = false;
  const first = toks[0].value.replace(/^\//, '');
  if (first === 'particleex') {
    i = 1;
    sub = toks[1]?.value ?? '';
    if (sub === 'group') {
      sub = `group ${toks[2]?.value ?? ''}`;
      i = 3;
    } else {
      i = 2;
    }
  } else if (first === 'particle') {
    vanilla = true;
    i = 1;
  } else {
    return issues; // 非命令（注释/空行）→ 不检查
  }

  for (let k = i; k < toks.length; k++) {
    const t = toks[k];
    const kind = kindFor(sub, vanilla, k - i);
    if (kind === null) continue;
    const legal = UNQUOTED_OK.test(t.value);
    if (kind === 'text') {
      if (!t.quoted && !legal) {
        const bad = t.value.split('').find((ch) => !/[0-9A-Za-z_.+-]/.test(ch)) ?? '';
        issues.push({
          index: k,
          token: t.value,
          fatal: true,
          message: `第 ${k - i + 1} 个参数是${KIND_HINT.text}，含未加引号字符「${bad}」——游戏内 brigadier 会在此截断（未加引号字符串只允许 0-9 A-Z a-z _ - . +），必须写成 '${t.value}'`,
        });
      }
    } else if (t.quoted) {
      issues.push({
        index: k,
        token: t.value,
        fatal: true,
        message: `第 ${k - i + 1} 个参数是${KIND_HINT[kind]}，游戏内读取器不处理引号 → 请去掉引号写成 ${t.value}`,
      });
    }
  }
  return issues;
}

/** 多行文本检查：跳过空行与 `#` 注释行；只返回**有问题**的行。 */
export function checkCommandsFormat(text: string): LineFormatReport[] {
  const reports: LineFormatReport[] = [];
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const issues = checkCommandFormat(trimmed);
    if (issues.length > 0) reports.push({ line: n + 1, text: trimmed, issues });
  }
  return reports;
}
