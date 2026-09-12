// 命令序列化：结构化 ParticleCommand → 规范命令文本（表单→命令回显与复制）。
// round-trip 约定：parse(serialize(c)) 与 c 语义等价（tests/command/parse.test.ts
// 往返段）。
// 策略：可选尾部参数（age/speedExpression/speedStep/group 等）一律显式写出（默认值也写），
// 保证往返后对象字段完全一致；null 写作字面 `null`（与 MC 建议值一致，解析层
// strOrNull 还原）。**文本参数按 brigadier 未加引号字符集加单引号**（见 fmtStr）：
// 表达式含 `( ) * ^ & < = ,` 等字符时游戏内必须加引号，否则参数被截断——回显
// 必须保持「可直接粘回游戏」的格式（2026-09-12 用户报告：引号曾被吃掉）。
// 行首带 `/`：与游戏内输入一致（解析层剥除 `/` 前缀，parseCommands 支持），
// 粘贴→应用回显后斜杠不丢，用户可直接复制回游戏。

import type {
  ParticleCommand,
  NormalCmd,
  ConditionalCmd,
  ParameterCmd,
  GroupCmd,
  VanillaCmd,
  Coord,
} from './types';

function fmtNum(v: number): string {
  if (Object.is(v, -0)) return '0';
  return String(v);
}

function fmtCoord(c: Coord): string {
  if (!c.rel) return fmtNum(c.v);
  return c.v === 0 ? '~' : '~' + fmtNum(c.v);
}

function fmtPos(p: { x: Coord; y: Coord; z: Coord }): string {
  return `${fmtCoord(p.x)} ${fmtCoord(p.y)} ${fmtCoord(p.z)}`;
}

// 纯数值三元组（vanilla 的 delta，命令树 vec3(0) 绝对值）
function fmtPlain3(p: { x: number; y: number; z: number }): string {
  return `${fmtNum(p.x)} ${fmtNum(p.y)} ${fmtNum(p.z)}`;
}

// Brigadier StringReader.isAllowedInUnquotedString：未加引号的 `string()` 参数
// **只允许** 0-9 A-Z a-z _ - . + —— 其余字符（( ) * ^ & < = , ; ! / 空格 …）会让
// readUnquotedString 在此**停下**：游戏里表现为「参数被截断 / 后续参数错位」。
// 所以表达式这类参数必须用引号包起来，否则复制回游戏就废了（用户报告：
// 表单回显把引号吃掉 → 文本在游戏内非法）。
const UNQUOTED_OK = /^[0-9A-Za-z_.+-]+$/;

/** `string()` 文本参数（表达式 / 组名 / 条件表达式）：按 brigadier 规则加引号 ——
 *  需要时用**单引号**（与用户游戏内习惯一致；词内 `'` → `''` 转义，与
 *  readString 语义一致）。`null` 字面量本身符合未加引号字符集 → 保持裸写。 */
export function fmtStr(s: string | null): string {
  if (s === null) return 'null';
  if (UNQUOTED_OK.test(s)) return s;
  return "'" + s.replace(/'/g, "''") + "'";
}

/** 粒子名参数：**不加引号**。`minecraft:end_rod` 这类 resource location 由
 *  标识符参数读取（允许 `:` `.` `_` `-` /），裸写在游戏内合法；加引号反而
 *  会让标识符读取器读到 `'` 而报错。NBT 载荷（`type{…}`）同样裸写。 */
export function fmtName(s: string): string {
  return s;
}

function tailOf(c: { age: number; speedExpression: string | null; speedStep: number; group: string | null }): string {
  return ` ${fmtNum(c.age)} ${fmtStr(c.speedExpression)} ${fmtNum(c.speedStep)} ${fmtStr(c.group)}`;
}

function normal(c: NormalCmd): string {
  return `particleex normal ${fmtName(c.name)} ${fmtPos(c.pos)} ${fmtNum(c.color.r)} ${fmtNum(c.color.g)} ${fmtNum(c.color.b)} ${fmtNum(c.color.a)} ${fmtNum(c.speed.x)} ${fmtNum(c.speed.y)} ${fmtNum(c.speed.z)} ${fmtNum(c.range.x)} ${fmtNum(c.range.y)} ${fmtNum(c.range.z)} ${c.count}${tailOf(c)}`;
}

function conditional(c: ConditionalCmd): string {
  return `particleex conditional ${fmtName(c.name)} ${fmtPos(c.pos)} ${fmtNum(c.color.r)} ${fmtNum(c.color.g)} ${fmtNum(c.color.b)} ${fmtNum(c.color.a)} ${fmtNum(c.speed.x)} ${fmtNum(c.speed.y)} ${fmtNum(c.speed.z)} ${fmtNum(c.range.x)} ${fmtNum(c.range.y)} ${fmtNum(c.range.z)} ${fmtStr(c.expression)} ${fmtNum(c.step)}${tailOf(c)}`;
}

function parameter(c: ParameterCmd): string {
  const name = c.rgba
    ? (c.polar ? (c.tick ? 'rgbatickpolarparameter' : 'rgbapolarparameter') : c.tick ? 'rgbatickparameter' : 'rgbaparameter')
    : c.polar ? (c.tick ? 'tickpolarparameter' : 'polarparameter') : c.tick ? 'tickparameter' : 'parameter';
  // cpt 槽仅 tick 变体存在（Java 命令树：非 tick 无 cpt 参数，树内固定 10 不使用）；
  // 非 tick 不写 cpt，否则往返解析时 age 会落入 cpt 槽
  const cpt = c.tick ? ` ${c.cpt}` : '';
  const color = c.color ? ` ${fmtNum(c.color.r)} ${fmtNum(c.color.g)} ${fmtNum(c.color.b)} ${fmtNum(c.color.a)}` : '';
  return `particleex ${name} ${fmtName(c.name)} ${fmtPos(c.pos)}${color} ${fmtNum(c.speed.x)} ${fmtNum(c.speed.y)} ${fmtNum(c.speed.z)} ${fmtNum(c.begin)} ${fmtNum(c.end)} ${fmtStr(c.expression)} ${fmtNum(c.step)}${cpt}${tailOf(c)}`;
}

function group(c: GroupCmd): string {
  if (c.sub === 'remove') {
    return `particleex group remove ${fmtStr(c.group)} ${fmtStr(c.expression)}${c.pos ? ' ' + fmtPos(c.pos) : ''}`;
  }
  return `particleex group change ${c.type} ${fmtStr(c.group)} ${fmtStr(c.expression)} ${fmtStr(c.conditionalExpression)}${c.pos ? ' ' + fmtPos(c.pos) : ''}`;
}

// 原版 /particle：槽位链前缀封闭——null 槽位（命令树默认值）不写，
// 后面的非 null 槽位前必须补齐前面的 null 槽位（写成命令树默认值），
// 保证往返后结构一致（round-trip 约定）。
function vanilla(c: VanillaCmd): string {
  // 槽位默认值（命令树缺省）
  const defPos = { x: { v: 0, rel: true }, y: { v: 0, rel: true }, z: { v: 0, rel: true } };
  // NBT 载荷：原样拼回（解析层已校验语法；含 `}`/空白由解析器按 SNBT 读回）
  const nameTok = c.nbt !== null ? c.name + '{' + c.nbt + '}' : fmtName(c.name);
  const parts = ['particle', nameTok];
  // pos
  if (c.pos !== null) parts.push(fmtPos(c.pos));
  else if (c.delta !== null || c.speed !== null || c.count !== null || c.normal) parts.push(fmtPos(defPos));
  // delta
  if (c.delta !== null) parts.push(fmtPlain3(c.delta));
  else if (c.speed !== null || c.count !== null || c.normal) {
    parts.push(fmtPlain3({ x: 0, y: 0, z: 0 }));
  }
  // speed
  if (c.speed !== null) parts.push(fmtNum(c.speed));
  else if (c.count !== null || c.normal) parts.push('0');
  // count
  if (c.count !== null) parts.push(String(c.count));
  else if (c.normal) parts.push('0');
  // normal
  if (c.normal) parts.push('normal');
  return parts.join(' ');
}

export function serialize(cmd: ParticleCommand): string {
  switch (cmd.kind) {
    case 'normal': return '/' + normal(cmd);
    case 'conditional': return '/' + conditional(cmd);
    case 'parameter': return '/' + parameter(cmd);
    case 'group': return '/' + group(cmd);
    case 'vanilla': return '/' + vanilla(cmd);
    case 'clearparticle': return '/particleex clearparticle';
  }
}

export function serializeAll(cmds: ParticleCommand[]): string {
  return cmds.map(serialize).join('\n');
}
