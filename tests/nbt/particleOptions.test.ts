// src/nbt/particleOptions.ts 直测：schema 校验函数（checkField / checkPosInt /
// checkNestedField）与颜色分量工具（parseColorField / defaultColorComponents）。
// 取证口径见 particleOptions.ts 头注（26.2 命名版逐类 javap；1.21.11 同构）。
// 命令层的集成断言在 tests/command/parse.test.ts（各类型 NBT 用例）。

import { describe, it, expect } from 'vitest';
import {
  checkField,
  checkPosInt,
  checkNestedField,
  parseColorField,
  defaultColorComponents,
  SCALE_MIN,
  SCALE_MAX,
} from '../../src/nbt/particleOptions';

describe('checkField：标量 codec 种类', () => {
  it('rgb / argb：整数字面量位模式（0..0xFFFFFF / -2^31..0xFFFFFFFF）', () => {
    expect(checkField('rgb', 0x00ff00)).toBeNull();
    expect(checkField('rgb', 0x000000)).toBeNull();
    expect(checkField('rgb', 0xffffff)).toBeNull();
    expect(checkField('rgb', -1)).not.toBeNull(); // rgb 非负
    expect(checkField('rgb', 0x1000000)).not.toBeNull(); // > 24 位
    // argb：完整 int32/uint32 位模式（0x80FF0000 → -2130771968 合法）
    expect(checkField('argb', 0x80ff0000)).toBeNull();
    expect(checkField('argb', -2130771968)).toBeNull(); // 0x80FF0000 位模式
    expect(checkField('argb', -1)).toBeNull(); // 0xFFFFFFFF
    expect(checkField('argb', -0x80000000)).toBeNull();
    expect(checkField('argb', 0x100000000)).not.toBeNull();
  });
  it('rgb / argb：VECTOR3F/VECTOR4F 备选（分量 0-1 列表）', () => {
    expect(checkField('rgb', [1, 0, 0])).toBeNull();
    expect(checkField('rgb', [0.5, 0.5, 0.5])).toBeNull();
    expect(checkField('rgb', [1, 0, 0, 1])).not.toBeNull(); // 4 分量不是 RGB
    expect(checkField('rgb', [1.5, 0, 0])).not.toBeNull(); // > 1
    expect(checkField('argb', [1, 1, 0, 0])).toBeNull();
    expect(checkField('argb', [1, 0, 0])).not.toBeNull(); // 3 分量不是 ARGB
  });
  it('scale：范围 [0.01, 4]（ScalableParticleOptionsBase validate）', () => {
    expect(checkField('scale', SCALE_MIN)).toBeNull();
    expect(checkField('scale', SCALE_MAX)).toBeNull();
    expect(checkField('scale', 1)).toBeNull();
    expect(checkField('scale', 0)).not.toBeNull();
    expect(checkField('scale', 0.009)).not.toBeNull();
    expect(checkField('scale', 4.1)).not.toBeNull();
  });
  it('float：任意有限数', () => {
    expect(checkField('float', 0)).toBeNull();
    expect(checkField('float', -3.5)).toBeNull();
    expect(checkField('float', 1e308)).toBeNull();
    expect(checkField('float', NaN)).not.toBeNull();
    expect(checkField('float', Infinity)).not.toBeNull();
  });
  it('int / posint：整数 / 正整数', () => {
    expect(checkField('int', 0)).toBeNull();
    expect(checkField('int', -20)).toBeNull();
    expect(checkField('int', 20.5)).not.toBeNull();
    expect(checkField('int', -0x80000000)).toBeNull(); // -2^31 边界合法
    expect(checkField('int', 0x7fffffff)).toBeNull(); // 2^31-1 边界合法
    // INT codec 越界拒：2147483648L = 合法 long 但 INT 解码失败（shriek{delay:2147483648L}）
    expect(checkField('int', 2147483648)).not.toBeNull();
    expect(checkField('int', -2147483649)).not.toBeNull();
    expect(checkPosInt(1)).toBeNull();
    expect(checkPosInt(0)).not.toBeNull(); // < 1
    expect(checkPosInt(-1)).not.toBeNull();
    expect(checkPosInt(1.5)).not.toBeNull();
  });
});

describe('checkNestedField：嵌套 8 类字段', () => {
  it('vec3：恰 3 个数值（INT 经 DOUBLE 提升 → 数值放行）', () => {
    expect(checkNestedField('vec3', [1, 2, 3])).toBeNull();
    expect(checkNestedField('vec3', [0.5, -1.5, 2])).toBeNull();
    expect(checkNestedField('vec3', [1, 2])).not.toBeNull();
    expect(checkNestedField('vec3', [1, 2, 3, 4])).not.toBeNull();
    expect(checkNestedField('vec3', [1, 'x', 3])).not.toBeNull();
    expect(checkNestedField('vec3', { x: 1, y: 2, z: 3 })).not.toBeNull();
  });
  it('blockState：map 须含 Name 字符串 / 字符串非空即放行（注册表不深校验）', () => {
    expect(checkNestedField('blockState', { Name: 'minecraft:stone' })).toBeNull();
    expect(checkNestedField('blockState', 'stone')).toBeNull();
    expect(checkNestedField('blockState', { Name: 1 })).not.toBeNull();
    expect(checkNestedField('blockState', { other: 'x' })).not.toBeNull();
    expect(checkNestedField('blockState', '')).not.toBeNull();
    expect(checkNestedField('blockState', 1)).not.toBeNull();
  });
  it('itemStack：map 须含 id；count ∈ [1,99]（intRange(1,99)）', () => {
    expect(checkNestedField('itemStack', { id: 'minecraft:stick' })).toBeNull();
    expect(checkNestedField('itemStack', { id: 'minecraft:stick', count: 99 })).toBeNull();
    expect(checkNestedField('itemStack', { id: 'minecraft:stick', count: 100 })).not.toBeNull();
    expect(checkNestedField('itemStack', { id: 'minecraft:stick', count: 0 })).not.toBeNull();
    expect(checkNestedField('itemStack', { id: 'minecraft:stick', count: 2.5 })).not.toBeNull();
    expect(checkNestedField('itemStack', 'stick')).toBeNull();
    expect(checkNestedField('itemStack', { count: 1 })).not.toBeNull(); // 缺 id
  });
  it('positionSource：{block:{pos:[3 整数]}}；entity 分支 → 固定文案', () => {
    expect(checkNestedField('positionSource', { block: { pos: [1, 2, 3] } })).toBeNull();
    expect(checkNestedField('positionSource', { block: { pos: [1, 2, 3.5] } })).not.toBeNull();
    expect(checkNestedField('positionSource', { block: { pos: [1, 2] } })).not.toBeNull();
    expect(checkNestedField('positionSource', { entity: {} })).not.toBeNull();
    expect(checkNestedField('positionSource', { entity: {} })).toBe(
      'Entity position sources are not allowed',
    );
    expect(checkNestedField('positionSource', { other: {} })).not.toBeNull();
    expect(checkNestedField('positionSource', { block: { pos: [1, 2, 3] }, x: 1 })).not.toBeNull();
  });
  it('标量 kind 复用 checkField（trail 的 color/duration、vibration 的 arrival_in_ticks）', () => {
    expect(checkNestedField('rgb', 0xff0000)).toBeNull();
    expect(checkNestedField('rgb', 'bad')).not.toBeNull();
    expect(checkNestedField('posint', 1)).toBeNull();
    expect(checkNestedField('posint', 0)).not.toBeNull();
    expect(checkNestedField('int', 0)).toBeNull();
    expect(checkNestedField('int', 0.5)).not.toBeNull();
    expect(checkNestedField('float', 0.5)).toBeNull();
  });
});

describe('parseColorField：整数字面量 → 0-1 分量', () => {
  it('rgb 24 位取字节序（0xRRGGBB → [R,G,B]）', () => {
    expect(parseColorField(0x00ff00, 'rgb')).toEqual([0, 1, 0]);
    expect(parseColorField(0xff0000, 'rgb')).toEqual([1, 0, 0]);
    expect(parseColorField(0x123456, 'rgb')).toEqual([0x12 / 255, 0x34 / 255, 0x56 / 255]);
  });
  it('argb 32 位（alpha 在前）：负数按无符号位模式（>>> 0）', () => {
    expect(parseColorField(0x80ff0000, 'argb')).toEqual([0x80 / 255, 1, 0, 0]);
    expect(parseColorField(-2130771968, 'argb')).toEqual([0x80 / 255, 1, 0, 0]); // 0x80FF0000 位模式
    expect(parseColorField(-8388608, 'argb')).toEqual([1, 0x80 / 255, 0, 0]); // -8388608 实为 0xFF800000
    expect(parseColorField(-1, 'argb')).toEqual([1, 1, 1, 1]); // 0xFFFFFFFF
  });
  it('向量备选：列表原样（调用方校验长度/范围已在 checkField）', () => {
    expect(parseColorField([1, 0, 0], 'rgb')).toEqual([1, 0, 0]);
  });
  it('非法形态 → null', () => {
    expect(parseColorField('red', 'rgb')).toBeNull();
    expect(parseColorField(0x1000000, 'rgb')).toBeNull();
    expect(parseColorField([0.5], 'rgb')).toBeNull();
    expect(parseColorField([0.5, 0.5], 'rgb')).toBeNull();
  });
});

describe('defaultColorComponents：缺省颜色按位展开', () => {
  it('-1 = 0xFFFFFFFF → 全白（effect/instant_effect 的 color 缺省）', () => {
    expect(defaultColorComponents(-1, 'rgb')).toEqual([1, 1, 1]);
    expect(defaultColorComponents(-1, 'argb')).toEqual([1, 1, 1, 1]);
  });
  it('0xFF0000 = (255,0,0) → 红（REDSTONE dust 的 color 构造实参）', () => {
    expect(defaultColorComponents(0xff0000, 'rgb')).toEqual([1, 0, 0]);
  });
});
