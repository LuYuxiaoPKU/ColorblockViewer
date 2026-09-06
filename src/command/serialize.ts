// 命令序列化：结构化 ParticleCommand → 规范命令文本（表单→命令回显与复制）。
// round-trip 约定：parse(serialize(c)) 与 c 语义等价（tests/command/roundtrip.test.ts）。
// 策略：可选尾部参数（age/speedExpression/speedStep/group 等）一律显式写出（默认值也写），
// 保证往返后对象字段完全一致；null 写作字面 `null`（与 MC 建议值一致，解析层
// strOrNull 还原）。表达式/组名等文本字段含空白或引号时加引号（内部引号 `"` → `""`）。

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

// 文本字段：含空白/引号 → 加引号（内部 " → ""）；其余原样
export function fmtStr(s: string | null): string {
  if (s === null) return 'null';
  if (/[ "\t]/.test(s) || s === '') {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function tailOf(c: { age: number; speedExpression: string | null; speedStep: number; group: string | null }): string {
  return ` ${fmtNum(c.age)} ${fmtStr(c.speedExpression)} ${fmtNum(c.speedStep)} ${fmtStr(c.group)}`;
}

function normal(c: NormalCmd): string {
  return `particleex normal ${fmtStr(c.name)} ${fmtPos(c.pos)} ${fmtNum(c.color.r)} ${fmtNum(c.color.g)} ${fmtNum(c.color.b)} ${fmtNum(c.color.a)} ${fmtNum(c.speed.x)} ${fmtNum(c.speed.y)} ${fmtNum(c.speed.z)} ${fmtNum(c.range.x)} ${fmtNum(c.range.y)} ${fmtNum(c.range.z)} ${c.count}${tailOf(c)}`;
}

function conditional(c: ConditionalCmd): string {
  return `particleex conditional ${fmtStr(c.name)} ${fmtPos(c.pos)} ${fmtNum(c.color.r)} ${fmtNum(c.color.g)} ${fmtNum(c.color.b)} ${fmtNum(c.color.a)} ${fmtNum(c.speed.x)} ${fmtNum(c.speed.y)} ${fmtNum(c.speed.z)} ${fmtNum(c.range.x)} ${fmtNum(c.range.y)} ${fmtNum(c.range.z)} ${fmtStr(c.expression)} ${fmtNum(c.step)}${tailOf(c)}`;
}

function parameter(c: ParameterCmd): string {
  const name = c.rgba
    ? (c.polar ? (c.tick ? 'rgbatickpolarparameter' : 'rgbapolarparameter') : c.tick ? 'rgbatickparameter' : 'rgbaparameter')
    : c.polar ? (c.tick ? 'tickpolarparameter' : 'polarparameter') : c.tick ? 'tickparameter' : 'parameter';
  // cpt 槽仅 tick 变体存在（Java 命令树：非 tick 无 cpt 参数，树内固定 10 不使用）；
  // 非 tick 不写 cpt，否则往返解析时 age 会落入 cpt 槽
  const cpt = c.tick ? ` ${c.cpt}` : '';
  const color = c.color ? ` ${fmtNum(c.color.r)} ${fmtNum(c.color.g)} ${fmtNum(c.color.b)} ${fmtNum(c.color.a)}` : '';
  return `particleex ${name} ${fmtStr(c.name)} ${fmtPos(c.pos)}${color} ${fmtNum(c.speed.x)} ${fmtNum(c.speed.y)} ${fmtNum(c.speed.z)} ${fmtNum(c.begin)} ${fmtNum(c.end)} ${fmtStr(c.expression)} ${fmtNum(c.step)}${cpt}${tailOf(c)}`;
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
  const parts = ['particle', fmtStr(c.name)];
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
    case 'normal': return normal(cmd);
    case 'conditional': return conditional(cmd);
    case 'parameter': return parameter(cmd);
    case 'group': return group(cmd);
    case 'vanilla': return vanilla(cmd);
    case 'clearparticle': return 'particleex clearparticle';
  }
}

export function serializeAll(cmds: ParticleCommand[]): string {
  return cmds.map(serialize).join('\n');
}
