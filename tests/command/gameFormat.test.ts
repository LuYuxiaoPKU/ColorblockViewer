// 游戏内格式检查（src/command/gameFormat.ts）+ 序列化引号回归。
//
// 背景（用户报告）：粘贴带单引号的命令 → 表单回显把引号吃掉 → 文本在游戏内非法。
// brigadier `string()` 的未加引号字符集只有 0-9 A-Z a-z _ - . +，含 `(` `)` `*`
// `^` `&` `<` `=` 的表达式必须加引号（`'…'`），否则游戏里参数被截断。

import { describe, it, expect } from 'vitest';
import { checkCommandFormat, checkCommandsFormat, UNQUOTED_OK } from '../../src/command/gameFormat';
import { parseCommand } from '../../src/command/parser';
import { serialize } from '../../src/command/serialize';
import {
  DEFAULT_NORMAL,
  DEFAULT_CONDITIONAL,
  DEFAULT_VANILLA,
  DEFAULT_GROUP_CHANGE,
  DEFAULT_GROUP_REMOVE,
  DEFAULT_CLEAR,
  makeParameter,
} from '../../src/store/appState';

// 用户的真实命令（游戏内可运行）：两处表达式都用单引号
const COND =
  "/particleex conditional minecraft:end_rod ~ ~ ~ 1 0.95 0.89 1 0 0 0 8 0.6 8 '(abs(y-0.5*exp(0-(x^2+z^2)/3.24)*cos(5.236*sqrt(x^2+z^2)))<0.05)&(sqrt(x^2+z^2)<8)' 0.1 200 'vy=0.5*exp(0-(sqrt(dx^2+dz^2)-0.06*t-0.03)*(sqrt(dx^2+dz^2)-0.06*t-0.03)/3.24)*(0.3142*sin(5.236*(sqrt(dx^2+dz^2)-0.06*t-0.03))+0.03704*(sqrt(dx^2+dz^2)-0.06*t-0.03)*cos(5.236*(sqrt(dx^2+dz^2)-0.06*t-0.03)))' 1 null";

// 去掉引号后的同一条命令（＝修复前网站的回显结果）：游戏内会被截断
const COND_UNQUOTED = COND.replace(/'/g, '');

describe('serialize：文本参数按 brigadier 规则加引号（引号不再消失）', () => {
  it('用户的 conditional 命令 round-trip 逐字不变（含两处单引号表达式 + 裸写 null）', () => {
    expect(serialize(parseCommand(COND))).toBe(COND);
  });

  it('引号被剥掉的输入 → 回显时**补回**单引号（不消失）', () => {
    const out = serialize(parseCommand(COND_UNQUOTED));
    expect(out).toBe(COND); // 与游戏内合法形式逐字一致
    expect(out).toContain("'(abs(y-");
    expect(out).toContain("'vy=0.5*exp(");
  });

  it('符合未加引号字符集的文本保持裸写（null / 纯标识符 / 纯数字样式）', () => {
    expect(UNQUOTED_OK.test('null')).toBe(true);
    expect(UNQUOTED_OK.test('vy=0.1')).toBe(false); // '=' 不在集合内
    const c = parseCommand('particleex normal flame 0 0 0 1 1 1 1 0 1 0 0.5 0 0.5 5 20 "vy=0.1" 2 g1|g2');
    const out = serialize(c);
    expect(out).toContain("'vy=0.1'"); // 需要引号 → 单引号
    expect(out).toContain("'g1|g2'"); // '|' 不在集合内 → 加引号
    expect(out).toContain('particleex normal flame '); // 粒子名裸写
  });

  it('粒子名（标识符）不加引号：裸写 minecraft:end_rod 才合法', () => {
    const out = serialize(parseCommand('particleex normal minecraft:end_rod 0 0 0 1 1 1 1 0 0 0 1 0 1 5'));
    expect(out).toContain('particleex normal minecraft:end_rod ');
    expect(out).not.toContain("'minecraft:end_rod'");
  });

  it('内部单引号按 readString 语义写成 \'\'（往返后仍是原字符串）', () => {
    const cmd = parseCommand("particleex normal flame 0 0 0 1 1 1 1 0 0 0 1 0 1 5 0 'a''b(c)' 1 g");
    expect((cmd as { speedExpression: string }).speedExpression).toBe('a\'b(c)');
    const out = serialize(cmd);
    expect(out).toContain("'a''b(c)'");
    expect((parseCommand(out) as { speedExpression: string }).speedExpression).toBe('a\'b(c)');
  });
});

describe('checkCommandFormat：游戏内格式查验', () => {
  it('用户命令（带引号）→ 无问题', () => {
    expect(checkCommandFormat(COND)).toEqual([]);
  });

  it('去掉引号 → 精确指出两处文本参数（第 15、18 个）并说明会被截断', () => {
    const issues = checkCommandFormat(COND_UNQUOTED);
    expect(issues).toHaveLength(2);
    expect(issues[0].index).toBe(16); // 词序号（0 起：/particleex conditional + 13 参数 + 表达式）
    expect(issues[0].fatal).toBe(true);
    expect(issues[0].message).toMatch(/第 15 个参数/);
    expect(issues[0].message).toMatch(/「\(」/); // 首个非法字符
    expect(issues[0].message).toContain(`'${issues[0].token}'`); // 给出修正写法
    expect(issues[1].message).toMatch(/第 18 个参数/);
  });

  it('数值/坐标参数被引号包住 → 同样报错（游戏读取器不处理引号）', () => {
    const issues = checkCommandFormat('particleex normal flame 0 0 0 1 1 1 1 0 0 0 1 0 1 \'5\'');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/数值参数/);
    expect(issues[0].message).toMatch(/去掉引号/);
  });

  it('~ 坐标裸写合法（坐标读取器单独处理 ~/^）', () => {
    expect(checkCommandFormat('particleex normal flame ~ ~1 ~ 1 1 1 1 0 0 0 1 0 1 5')).toEqual([]);
  });

  it('原版 /particle 的 NBT 名裸写合法；引号包住标识符 → 报错', () => {
    expect(checkCommandFormat('particle minecraft:flame ~ ~ ~ 0 0 0 0 1 5 normal')).toEqual([]);
    expect(checkCommandFormat("particle 'minecraft:flame' ~ ~ ~ 0 0 0 0 1 5 normal")).toHaveLength(1);
    expect(checkCommandFormat('particle type{block_state:"minecraft:stone"} ~ ~ ~ 0 0 0 0 1 5')).toEqual([]);
  });

  it('group change 的枚举位与组名位分别判定', () => {
    expect(checkCommandFormat('particleex group change parameter g1 "x=1" "age>2"')).toEqual([]);
    const issues = checkCommandFormat("particleex group change 'parameter' g1 x=1");
    expect(issues).toHaveLength(2); // 枚举被引号 + 表达式缺引号
    expect(issues[0].message).toMatch(/枚举字面量/);
    expect(issues[1].message).toMatch(/文本参数/);
  });

  it('未闭合引号 → 单条致命问题（不抛异常，供 UI 提示）', () => {
    const issues = checkCommandFormat("particleex conditional flame 0 0 0 1 1 1 1 0 0 0 1 0 1 'x=1");
    expect(issues).toHaveLength(1);
    expect(issues[0].fatal).toBe(true);
    expect(issues[0].message).toMatch(/unterminated/);
  });

  it('多行文本：只报有问题的行（跳过空行与 # 注释）', () => {
    const text = ['# 注释', '', COND, COND_UNQUOTED, 'particleex clearparticle'].join('\n');
    const reports = checkCommandsFormat(text);
    expect(reports).toHaveLength(1);
    expect(reports[0].line).toBe(4);
    expect(reports[0].issues).toHaveLength(2);
  });
});

describe('表单默认命令（站点自己生成的回显）必须全部通过格式检查', () => {
  const cases: [string, () => unknown][] = [
    ['normal', () => structuredClone(DEFAULT_NORMAL)],
    ['conditional', () => structuredClone(DEFAULT_CONDITIONAL)],
    ['particle（原版）', () => structuredClone(DEFAULT_VANILLA)],
    ['group change', () => structuredClone(DEFAULT_GROUP_CHANGE)],
    ['group remove', () => structuredClone(DEFAULT_GROUP_REMOVE)],
    ['clear', () => ({ ...DEFAULT_CLEAR })],
    ...(
      [
        'parameter', 'polarparameter', 'tickparameter', 'tickpolarparameter',
        'rgbaparameter', 'rgbapolarparameter', 'rgbatickparameter', 'rgbatickpolarparameter',
      ] as const
    ).map((v) => [v, () => makeParameter(v)] as [string, () => unknown]),
  ];

  for (const [label, make] of cases) {
    it(`${label}：serialize → 格式检查零问题`, () => {
      const line = serialize(make() as never);
      expect(checkCommandFormat(line)).toEqual([]);
    });
  }
});
