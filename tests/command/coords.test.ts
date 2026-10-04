// src/command/coords.ts 直测：~ / ^ 相对坐标、纯数值三元组、RGBA 分量边界。
// MC 语义（计划 §2.2 / §六.4）：`~` = 玩家位置、`~n` = 玩家 ± n（含小数整体
// 随玩家平移）；`^`（相对上一次位置）玩家执行时即当前位置 → 预览与 `~` 等价。
// speed/range = DoubleArgumentType/FloatArgumentType，不支持 ~。
// 命令层的集成断言在 tests/command/parse.test.ts。

import { describe, it, expect } from 'vitest';
import { isNum, parseCoord, parseVec3, parsePlain3, parseRGBA } from '../../src/command/coords';
import { CommandParseError } from '../../src/command/tokens';

describe('isNum：DoubleArgumentType 数值文本（1.5 / -3 / +2 / .5 / 1e3）', () => {
  it('合法形态', () => {
    expect(isNum('0')).toBe(true);
    expect(isNum('1.5')).toBe(true);
    expect(isNum('.5')).toBe(true);
    expect(isNum('-3')).toBe(true);
    expect(isNum('+2')).toBe(true);
    expect(isNum('1e3')).toBe(true);
    expect(isNum('2.5E-2')).toBe(true);
  });
  it('非法形态', () => {
    expect(isNum('')).toBe(false);
    expect(isNum('1_0')).toBe(false); // 下划线不是坐标语法
    expect(isNum('0x1F')).toBe(false);
    expect(isNum('abc')).toBe(false);
    expect(isNum('~')).toBe(false);
    expect(isNum('1e')).toBe(false);
    expect(isNum('++1')).toBe(false);
  });
  it('1. 放行（\\d+\\.?\\d* 尾部空；Java Double.parseDouble 同接受）', () => {
    expect(isNum('1.')).toBe(true);
    expect(isNum('1.5.')).toBe(false);
  });
});

describe('parseCoord：~ / ^ 相对与绝对', () => {
  it('裸 ~ / ^ = 玩家位置（v=0, rel=true）', () => {
    expect(parseCoord('~', 'pos')).toEqual({ v: 0, rel: true });
    expect(parseCoord('^', 'pos')).toEqual({ v: 0, rel: true });
  });
  it('~n / ^n = 玩家 ± n（小数随玩家平移）', () => {
    expect(parseCoord('~0.5', 'pos')).toEqual({ v: 0.5, rel: true });
    expect(parseCoord('~-1.5', 'pos')).toEqual({ v: -1.5, rel: true });
    expect(parseCoord('^2', 'pos')).toEqual({ v: 2, rel: true });
  });
  it('绝对值 = 数值本身（rel=false）', () => {
    expect(parseCoord('3', 'pos')).toEqual({ v: 3, rel: false });
    expect(parseCoord('-2.5', 'pos')).toEqual({ v: -2.5, rel: false });
    expect(parseCoord('+1', 'pos')).toEqual({ v: 1, rel: false });
    expect(parseCoord('.5', 'pos')).toEqual({ v: 0.5, rel: false });
    expect(parseCoord('1e3', 'pos')).toEqual({ v: 1000, rel: false });
  });
  it('非法 → CommandParseError（含 what 与原文）', () => {
    expect(() => parseCoord('~a', 'pos')).toThrow(CommandParseError);
    expect(() => parseCoord('x', 'pos')).toThrow(/invalid pos coordinate: x/);
    expect(() => parseCoord('~~1', 'delta')).toThrow(/invalid delta coordinate/);
    expect(() => parseCoord('^~0.5', 'pos')).toThrow(/invalid pos coordinate: \^~0\.5/); // ^ 后只跟数值
  });
});

describe('parseVec3 / parsePlain3', () => {
  it('parseVec3 逐分量解析', () => {
    expect(parseVec3(['1', '~', '-2.5'], 'pos')).toEqual({
      x: { v: 1, rel: false },
      y: { v: 0, rel: true },
      z: { v: -2.5, rel: false },
    });
  });
  it('parsePlain3：纯数值三元组，拒 ~（MC 不支持）', () => {
    expect(parsePlain3(['0.1', '-1', '2e2'], 'speed')).toEqual({ x: 0.1, y: -1, z: 200 });
    expect(() => parsePlain3(['~', '0', '0'], 'speed')).toThrow(CommandParseError);
    expect(() => parsePlain3(['0.5', 'a', '1'], 'range')).toThrow(/invalid range: a/);
  });
});

describe('parseRGBA：分量 ∈ [0,1]（Color4ArgumentType = floatArg(0,1)）', () => {
  it('合法分量', () => {
    expect(parseRGBA(['1', '0', '0.5', '1'])).toEqual({ r: 1, g: 0, b: 0.5, a: 1 });
    expect(parseRGBA(['0.1', '0.2', '0.3', '0.4'])).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 0.4 });
    expect(parseRGBA(['1', '1', '1', '0'])).toEqual({ r: 1, g: 1, b: 1, a: 0 });
  });
  it('越界 / 非法 → 拒绝', () => {
    expect(() => parseRGBA(['1.5', '0', '0', '1'])).toThrow(/out of \[0,1\]: 1.5/);
    expect(() => parseRGBA(['0', '-0.1', '0', '1'])).toThrow(/out of \[0,1\]: -0.1/);
    expect(() => parseRGBA(['a', '0', '0', '1'])).toThrow(CommandParseError);
  });
});
