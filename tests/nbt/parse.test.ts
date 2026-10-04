// src/nbt/parse.ts 直测：parseCompound / parseVal / parseNum 的数值字面量语义。
// 取证口径见 parse.ts 头注（SnbtGrammar 两版字节码同构 + CFR 反编译 2026-10-04）。
// 命令层的集成断言在 tests/command/parse.test.ts「SNBT hex 语义」用例；
// 这里直接锁解析函数本身（不经 parseCommand 的命令树/类型校验）。

import { describe, it, expect } from 'vitest';
import { parseCompound, NbtParseError } from '../../src/nbt/parse';
import type { NbtField } from '../../src/nbt/parse';

const num = (s: string): number => {
  const fields: NbtField[] = parseCompound(`a:${s}`);
  return fields[0].val as number;
};
const expectNum = (s: string, v: number) => expect(num(s)).toBe(v);
const expectReject = (s: string) => expect(() => num(s)).toThrow(NbtParseError);

describe('parseNum：十六进制（parseUnsignedInt 位模式）', () => {
  it('无后缀 < 2^31 = 值本身', () => {
    expectNum('0xFF', 255);
    expectNum('0x7FFFFFFF', 0x7fffffff);
    expectNum('0x0', 0);
    expectNum('0xABCDEF', 0xabcdef);
  });
  it('无后缀 ≥ 2^31 = INT 位模式（parseUnsignedInt）', () => {
    expectNum('0x80000000', -2147483648);
    expectNum('0xFFFFFFFF', -1);
    expectNum('0x80FF0000', -2130771968);
  });
  it('B 后缀 = UnsignedBytes.parseUnsignedByte（>0xFF 拒）', () => {
    expectNum('0xFFB', 255);
    expectNum('0x0FB', 15);
    expectReject('0x100B');
  });
  it('S 后缀 = parseUnsignedShort（>0xFFFF 拒）', () => {
    expectNum('0xFFFFS', 0xffff);
    expectReject('0x10000S');
  });
  it('I 后缀 = parseInt 位模式（>0xFFFFFFFF 拒；≥2^31 取 int 位模式）', () => {
    expectNum('0x7FFFFFFFI', 0x7fffffff);
    expectNum('0x80000000I', -2147483648);
    expectNum('0xFFFFFFFFI', -1);
    expectReject('0x100000000I');
  });
  it('L 后缀 = 预览域止于 int（≤0xFFFFFFFF 放行，越界拒）', () => {
    expectNum('0xFFFFFFFFL', 0xffffffff);
    expectReject('0x100000000L');
  });
  it('尾 F 是 hex 数字不是 float 后缀（0x0000FF = 255，回归旧 bug → 15）', () => {
    expectNum('0x0000FF', 255);
    expectNum('0x0000FFD', 0xffd);
  });
  it('下划线分隔符：位置形态（首/尾拒、连续允）', () => {
    expectNum('0xFF_00_00', 0xff0000);
    expectNum('0x1_000', 0x1000);
    expectNum('0x1__0', 0x10);
    expectReject('0x_FF');
    expectReject('0xFF_');
    expectReject('0x__');
  });
  it('0x 后无数字 / 空 → 拒', () => {
    expectReject('0x');
    expectReject('0xG');
  });
});

describe('parseNum：二进制（BINARY base → UNSIGNED INT 位模式）', () => {
  it('无后缀 = 值（≤2^31-1）/ 位模式（≥2^31）', () => {
    expectNum('0b101', 5);
    expectNum('0b11111111', 255);
    expectNum('0b10000000000000000000000000000000', -2147483648);
    expectNum('0b11111111111111111111111111111111', -1);
  });
  it('B/S/I/L 后缀位宽同 hex 分支', () => {
    expectNum('0b11111111B', 255);
    expectReject('0b100000000B');
    expectNum('0b1111111111111111S', 0xffff);
    expectNum('0b10000000000000000000000000000000I', -2147483648);
    expectNum('0b11111111111111111111111111111111I', -1);
  });
  it('数字运行仅 {0,1,_}：尾 f 不是数字（0b101f 拒——无 f/F/d/D 整数后缀）', () => {
    expectReject('0b101f');
    expectReject('0b101d');
  });
  it('下划线首/尾拒、中间允', () => {
    expectNum('0b1_0', 2);
    expectReject('0b_1');
    expectReject('0b1_');
  });
  it('减号：UNSIGNED 分道 + Sign.MINUS → 游戏拒（预览同拒）', () => {
    expectReject('-0b101');
    expectReject('-0xFF');
  });
});

describe('parseNum：十进制（SIGNED base；前导零仅纯整数拒）', () => {
  it('整数 / 浮点 / 指数 / 后缀', () => {
    expectNum('123', 123);
    expectNum('-42', -42);
    expectNum('1.5', 1.5);
    expectNum('.5', 0.5);
    expectNum('1e3', 1000);
    expectNum('1.5e-2', 0.015);
    expectNum('1.0f', 1);
    expectNum('2.0d', 2);
    expectNum('5I', 5);
    expectReject('3000000000I'); // 十进制 I 后缀 > intMax 拒绝（文档化近似③）
  });
  it('前导零：纯整数（含带 B/S/I/L 后缀）拒；0 后跟数字/下划线同拒（trailing data）；浮点路径无此检查（0123.4 放行）', () => {
    expectReject('0123');
    expectReject('+05');
    expectReject('0123B');
    expectReject('0_5');
    expectNum('0', 0);
    expectNum('0123.4', 123.4);
    expectNum('0.123', 0.123);
    expectNum('01.5f', 1.5);
  });
  it('下划线：首/尾拒、连续允（整数/小数/指数部分统一）', () => {
    expectNum('1_000', 1000);
    expectNum('1_0_0', 100);
    expectNum('1__0', 10); // 连续下划线游戏放行（NumberRunParseRule 只查首/尾）
    expectNum('0.1_5', 0.15);
    expectNum('0.0__5', 0.05);
    expectNum('1.5__5', 1.55);
    expectNum('1e1__5', 1e15); // 指数体同为数字运行：1e15
    expectReject('1_000_');
    expectReject('0.5_');
    expectReject('0._5f');
    expectReject('1.0e_5');
    expectReject('1_e0');
  });
  it('加号与游戏一致：+5 / +1.0f 放行、+05 按前导零拒', () => {
    expectNum('+5', 5);
    expectNum('+1.0f', 1);
    expectReject('+05');
  });
  it('十进制 B/S/I/L 后缀位宽 = SIGNED 解析域（越界游戏拒，预览一致）', () => {
    expectNum('127B', 127);
    expectReject('128B');
    expectNum('32767S', 32767);
    expectReject('70000S');
    expectNum('2147483647I', 0x7fffffff);
    expectReject('3000000000I');
    expectNum('4294967295L', 0xffffffff);
    expectReject('9007199254740993L'); // 预览域止于 int/uint32（命令结果一致）
    // float/指数体 + B/S/I/L 后缀无匹配（游戏 integer 后缀要求纯整数体）→ 拒
    expectReject('1.5B');
    expectReject('1.0e2S');
  });
  it('非法形态 → 拒（数字类开头不回退字符串）', () => {
    expectReject('1.0e');
    expectReject('1.0.0');
    expectReject('12.34.56');
    expectReject('0x');
    expectReject('0xG');
    expectReject('1abc');
    expectReject('1_');
    // 非数字类开头 = unquoted 字符串值（_ 在字符集内；数字类才走 numeric 报错）
    expect(num('abc')).toBe('abc');
    expect(num('_1')).toBe('_1');
  });
});

describe('parseVal：字符串 / 布尔 / 裸串回退', () => {
  it(`布尔 / 引号字符串（单引号 '' 转义；双引号串预览按 "" 双写近似——文档化近似①）`, () => {
    expect(parseCompound('a:true')['0'].val).toBe(true);
    expect(parseCompound('a:false')['0'].val).toBe(false);
    expect(parseCompound('a:"hello"')['0'].val).toBe('hello');
    expect(parseCompound(`a:'it''s'`)['0'].val).toBe("it's");
    // 文档化近似①：游戏内双引号串转义 = \"（反斜杠+引号），预览按 "" 双写
    // 近似——含反斜杠的字符串预览拒（块名/物品名不含反斜杠，无实际消费场景）
    expect(() => parseCompound('a:"a\\"b"')).toThrow(NbtParseError);
  });
  it('裸串回退：数字类开头先走 numeric 规则（报错），其余 = 字符串值', () => {
    expect(parseCompound('a:stone')['0'].val).toBe('stone');
    // 裸 key 取**最后一个**顶层冒号作分隔（文档化近似⑥：游戏 unquoted 字符集
    // 不含冒号——minecraft:food 游戏内读成 minecraft → trailing data 拒；
    // 游戏里 data component key 须带引号 "minecraft:food"）
    const f = parseCompound('a:minecraft:food')['0'];
    expect(f.key).toBe('a:minecraft');
    expect(f.val).toBe('food');
    // 数字类开头 → 走数值规则：0xZZ / 1abc 仍是数值报错（不回退字符串）
    expect(() => parseCompound('a:0xZZ')).toThrow(NbtParseError);
    expect(() => parseCompound('a:1abc')).toThrow(NbtParseError);
  });
  it('嵌套容器', () => {
    expect(parseCompound('a:[1,2,3]')['0'].val).toEqual([1, 2, 3]);
    expect(parseCompound('a:[]')['0'].val).toEqual([]);
    expect(parseCompound('a:{b:1}')['0'].val).toEqual({ b: 1 });
    expect(parseCompound('a:{}')['0'].val).toEqual({});
    expect(parseCompound('a:[{b:1},[2]]')['0'].val).toEqual([{ b: 1 }, [2]]);
  });
  it('空值 / 未闭合 / 不配对 → 拒', () => {
    expect(() => parseCompound('a:')).toThrow(NbtParseError);
    expect(() => parseCompound('a:{b:1')).toThrow(NbtParseError);
    expect(() => parseCompound('a:[1,2')).toThrow(NbtParseError);
    expect(() => parseCompound('a:"abc')).toThrow(NbtParseError);
  });
});
