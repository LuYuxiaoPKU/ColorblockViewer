// 命令解析：token 序列 → 结构化 ParticleCommand。
// ground truth：mod 各 *Command.java 的 brigadier 树——参数顺序、必填性、
// 默认值（按各 executes() 实参）与取值范围逐字核对（M2）：
//   公共尾部链（前缀封闭，可选）：[age, 0] [speedExpression, null] [speedStep, 1.0] [group, null]
//   conditional：expression* [step, 0.1] 在 age 之前（唯一顺序不同的命令）
//   tick*：[step, 0.1] 与 [age] 之间插 [cpt, 10]（非 tick 命令树无 cpt 槽，
//   结构里 cpt 恒 10，仿真不使用）
//   范围：count ≥0；age ∈ [-1, intMax]；cpt ≥1；step/speedStep > 0（ulp(0)）；
//   range/speed/begin/end 任意 double（begin/end 下界 -DBL_MAX）；颜色各 ∈ [0,1]。
// 错误：中文 + 规范用法（计划 §六.5）；Expression 类参数保留原始字符串
// （含字面 "null"——Java 端 ExpressionUtil.parse("null") → null 由仿真层判定，
// 不在解析层吞掉）。

import { tokenize, CommandParseError } from './tokens';
import { parseVec3, parsePlain3, parseRGBA, isNum } from './coords';
import { USAGE } from './schema';
import type { ParticleCommand, NormalCmd, ConditionalCmd, ParameterCmd, GroupCmd, ClearCmd } from './types';

const INT_MAX = 2147483647;
const DBL_MAX = Number.MAX_VALUE;

class Cur {
  i = 0;
  constructor(
    private toks: string[],
    private usage: string,
  ) {}

  eof(): boolean {
    return this.i >= this.toks.length;
  }

  tok(name?: string): string {
    if (this.i >= this.toks.length) {
      throw new CommandParseError(
        name ? `缺少参数 ${name}。用法：${this.usage}` : `缺少参数。用法：${this.usage}`,
      );
    }
    return this.toks[this.i++];
  }

  int(name: string, min: number, max: number): number {
    const t = this.tok(name);
    if (!/^[+-]?\d+$/.test(t)) {
      throw new CommandParseError(`参数 ${name} 应为整数：收到 "${t}"。用法：${this.usage}`);
    }
    const v = Number(t);
    if (v < min || v > max) {
      throw new CommandParseError(`参数 ${name} 超出范围 [${min}, ${max}]：${v}`);
    }
    return v;
  }

  dbl(name: string, min: number, max: number): number {
    const t = this.tok(name);
    if (!isNum(t)) {
      throw new CommandParseError(`参数 ${name} 应为数字：收到 "${t}"。用法：${this.usage}`);
    }
    const v = Number(t);
    if (v < min || v > max) {
      throw new CommandParseError(`参数 ${name} 超出范围 [${min}, ${max}]：${v}`);
    }
    return v;
  }

  str(name: string): string {
    return this.tok(name);
  }

  // 「null」字面量 → null（speedExpression / group / conditionalExpression）
  strOrNull(name: string): string | null {
    const t = this.str(name);
    return t === 'null' || t === '' ? null : t;
  }

  done(): void {
    if (!this.eof()) {
      throw new CommandParseError(
        `参数过多（从 "${this.toks[this.i]}" 开始）。用法：${this.usage}\n提示：参数含空格时请用英文双引号包裹。`,
      );
    }
  }
}

interface Tail {
  age: number;
  speedExpression: string | null;
  speedStep: number;
  group: string | null;
}

// 公共尾部 [age] [speedExpression] [speedStep] [group]
function parseTail(c: Cur): Tail {
  const age = c.eof() ? 0 : c.int('age', -1, INT_MAX);
  const speedExpression = c.eof() ? null : c.strOrNull('speedExpression');
  const speedStep = c.eof() ? 1.0 : c.dbl('speedStep', 5e-324, DBL_MAX);
  const group = c.eof() ? null : c.strOrNull('group');
  return { age, speedExpression, speedStep, group };
}

function parseNormal(toks: string[]): NormalCmd {
  const c = new Cur(toks, USAGE.normal);
  const name = c.str('name');
  const pos = parseVec3([c.str('pos'), c.str('pos'), c.str('pos')], '位置');
  const color = parseRGBA([c.str('color'), c.str('color'), c.str('color'), c.str('color')]);
  const speed = parsePlain3([c.str('speed'), c.str('speed'), c.str('speed')], '速度');
  const range = parsePlain3([c.str('range'), c.str('range'), c.str('range')], '范围');
  for (const [k, v] of Object.entries(range)) if (v < 0) {
    throw new CommandParseError(`参数 range 的 ${k} 应为非负：${v}。用法：${USAGE.normal}`);
  }
  const count = c.int('count', 0, INT_MAX);
  const tail = parseTail(c);
  c.done();
  return { kind: 'normal', name, pos, color, speed, range, count, ...tail };
}

function parseConditional(toks: string[]): ConditionalCmd {
  const c = new Cur(toks, USAGE.conditional);
  const name = c.str('name');
  const pos = parseVec3([c.str('pos'), c.str('pos'), c.str('pos')], '位置');
  const color = parseRGBA([c.str('color'), c.str('color'), c.str('color'), c.str('color')]);
  const speed = parsePlain3([c.str('speed'), c.str('speed'), c.str('speed')], '速度');
  const range = parsePlain3([c.str('range'), c.str('range'), c.str('range')], '范围');
  for (const [k, v] of Object.entries(range)) if (v < 0) {
    throw new CommandParseError(`参数 range 的 ${k} 应为非负：${v}。用法：${USAGE.conditional}`);
  }
  const expression = c.str('expression');
  const step = c.eof() ? 0.1 : c.dbl('step', 5e-324, DBL_MAX);
  const age = c.eof() ? 0 : c.int('age', -1, INT_MAX);
  const speedExpression = c.eof() ? null : c.strOrNull('speedExpression');
  const speedStep = c.eof() ? 1.0 : c.dbl('speedStep', 5e-324, DBL_MAX);
  const group = c.eof() ? null : c.strOrNull('group');
  c.done();
  return {
    kind: 'conditional', name, pos, color, speed, range,
    expression, step, age, speedExpression, speedStep, group,
  };
}

// parameter 家族（polar/tick/rgba 由子命令名决定）
function parseParameter(toks: string[], polar: boolean, tick: boolean, rgba: boolean): ParameterCmd {
  const usage = USAGE[tick ? (rgba ? (polar ? 'rgbatickpolarparameter' : 'rgbatickparameter') : polar ? 'tickpolarparameter' : 'tickparameter') : rgba ? (polar ? 'rgbapolarparameter' : 'rgbaparameter') : polar ? 'polarparameter' : 'parameter'];
  const c = new Cur(toks, usage);
  const name = c.str('name');
  const pos = parseVec3([c.str('pos'), c.str('pos'), c.str('pos')], '位置');
  const color = rgba ? null : parseRGBA([c.str('color'), c.str('color'), c.str('color'), c.str('color')]);
  const speed = parsePlain3([c.str('speed'), c.str('speed'), c.str('speed')], '速度');
  const begin = c.dbl('begin', -DBL_MAX, DBL_MAX);
  const end = c.dbl('end', -DBL_MAX, DBL_MAX);
  const expression = c.str('expression');
  const step = c.eof() ? 0.1 : c.dbl('step', 5e-324, DBL_MAX);
  // cpt 槽仅 tick 变体存在（Java 命令树：非 tick 在 step 后直接是 age，无 cpt；
  // 非 tick 的 cpt 是 executes 实参里的常量 10，仿真不使用）
  const cpt = tick && !c.eof() ? c.int('cpt', 1, INT_MAX) : 10;
  const age = c.eof() ? 0 : c.int('age', -1, INT_MAX);
  const speedExpression = c.eof() ? null : c.strOrNull('speedExpression');
  const speedStep = c.eof() ? 1.0 : c.dbl('speedStep', 5e-324, DBL_MAX);
  const group = c.eof() ? null : c.strOrNull('group');
  c.done();
  return {
    kind: 'parameter', name, pos, polar, tick, rgba, color, speed,
    begin, end, expression, step, cpt, age, speedExpression, speedStep, group,
  };
}

function parseGroup(toks: string[]): GroupCmd {
  if (toks[0] !== 'remove' && toks[0] !== 'change') {
    throw new CommandParseError(`未知 group 子命令 "${toks[0] ?? ''}"。用法：${USAGE['group remove']} / ${USAGE['group change']}`);
  }
  const sub = toks.shift() as 'remove' | 'change';
  if (sub === 'remove') {
    const c = new Cur(toks, USAGE['group remove']);
    const group = c.str('group');
    const expression = c.eof() ? null : c.strOrNull('expression');
    const pos = c.eof() ? null : parseVec3([c.str('pos'), c.str('pos'), c.str('pos')], '位置');
    c.done();
    return { kind: 'group', sub: 'remove', group, expression, pos };
  }
  const c = new Cur(toks, USAGE['group change']);
  const typeTok = c.str('type');
  if (typeTok !== 'parameter' && typeTok !== 'speedexpression') {
    throw new CommandParseError(`参数 type 应为 parameter 或 speedexpression：收到 "${typeTok}"。用法：${USAGE['group change']}`);
  }
  const group = c.str('group');
  const expression = c.str('expression');
  const conditionalExpression = c.eof() ? null : c.strOrNull('conditionalExpression');
  const pos = c.eof() ? null : parseVec3([c.str('pos'), c.str('pos'), c.str('pos')], '位置');
  c.done();
  return { kind: 'group', sub: 'change', type: typeTok, group, expression, conditionalExpression, pos };
}

// 单行命令（可选前缀 /particleex）→ 结构；不识别 → CommandParseError
export function parseCommand(line: string): ParticleCommand {
  let text = line.trim();
  if (text.startsWith('/')) text = text.slice(1);
  const toks = tokenize(text);
  if (toks.length === 0) throw new CommandParseError('空命令');
  if (toks[0] === 'particleex') toks.shift();
  if (toks.length === 0) throw new CommandParseError('缺少子命令。可用：' + Object.keys(USAGE).join(' / '));
  const head = toks[0];
  if (head === 'group') {
    if (toks.length < 2) throw new CommandParseError(`缺少 group 子命令（remove/change）。用法：${USAGE['group remove']}`);
    return parseGroup(toks.slice(1));
  }
  if (head === 'normal') return parseNormal(toks.slice(1));
  if (head === 'conditional') return parseConditional(toks.slice(1));
  if (head === 'clearparticle') {
    const c = new Cur(toks.slice(1), USAGE.clearparticle);
    c.done();
    return { kind: 'clearparticle' } as ClearCmd;
  }
  const paramNames: Record<string, [boolean, boolean, boolean]> = {
    parameter: [false, false, false],
    polarparameter: [true, false, false],
    tickparameter: [false, true, false],
    tickpolarparameter: [true, true, false],
    rgbaparameter: [false, false, true],
    rgbapolarparameter: [true, false, true],
    rgbatickparameter: [false, true, true],
    rgbatickpolarparameter: [true, true, true],
  };
  if (head in paramNames) {
    const [polar, tick, rgba] = paramNames[head];
    return parseParameter(toks.slice(1), polar, tick, rgba);
  }
  throw new CommandParseError(`未知子命令 "${head}"。可用：${Object.keys(USAGE).join(' / ')}`);
}

// 多行：按行分割（兼容 \r\n）、trim、跳过空行与 # 注释；每行独立解析
export function parseCommands(text: string): ParticleCommand[] {
  const out: ParticleCommand[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    out.push(parseCommand(line));
  }
  return out;
}
