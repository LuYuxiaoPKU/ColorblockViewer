// image / imagematrix / video / videomatrix / clearcache / functionlist 解析与
// 执行（2026-10-10 按模组 ImageCommand 字段序 + NBS2schematic 真实生成命令）。
// 寄存器语义：
//  - rotate 命令文本必须 0/90/180/270（模组 RotateArgument），内部按 deg/90 存；
//  - flip 只认 not/horizontally/vertical（数字被拒）；
//  - speed 三槽逐槽可 null（全 null → null）；
//  - 执行：预览无 ./particleImages/ → 报模组口径 invalid image path: <path>。

import { describe, it, expect } from 'vitest';
import { parseCommand, parseCommands } from '../../src/command/parser';
import { serialize } from '../../src/command/serialize';
import { SimEngine } from '../../src/sim/engine';
import { getState } from '../../src/store/appState';
import type { ImageVideoCmd, ImageMatrixCmd, NormalCmd } from '../../src/command/types';

function engine(): SimEngine {
  return new SimEngine({ ...getState().sim, seed: 1, nativeKinematics: true, mcVersion: '26.2' });
}

describe('image 解析', () => {
  it('NBS 歌词实锤命令：18 token 全字段', () => {
    const c = parseCommand('/particleex image minecraft:end_rod 11 8 0 lyric/s0000_l0.png 0.03125 0 90 0 not 10 0 0 0 16 null 1 null') as ImageVideoCmd;
    expect(c.kind).toBe('image');
    expect(c.name).toBe('minecraft:end_rod');
    expect(c.pos).toEqual({ x: { v: 11, rel: false }, y: { v: 8, rel: false }, z: { v: 0, rel: false } });
    expect(c.path).toBe('lyric/s0000_l0.png');
    expect(c.scaling).toBeCloseTo(0.03125, 6);
    expect(c.rotate).toEqual([0, 1, 0]); // 90° → deg/90=1
    expect(c.flip).toBe(0);
    expect(c.dpb).toBeCloseTo(10, 6);
    expect(c.speed).toEqual({ x: 0, y: 0, z: 0 });
    expect(c.age).toBe(16);
    expect(c.speedExpression).toBeNull();
    expect(c.speedStep).toBe(1);
    expect(c.group).toBeNull();
  });

  it('缺省值：scaling 0.1 / flip not / dpb 10 / speed null', () => {
    const c = parseCommand('/particleex image minecraft:flame 0 1 0 test.png') as ImageVideoCmd;
    expect(c.scaling).toBeCloseTo(0.1, 6);
    expect(c.rotate).toEqual([0, 0, 0]);
    expect(c.flip).toBe(0);
    expect(c.dpb).toBeCloseTo(10, 6);
    expect(c.speed).toBeNull();
    expect(c.age).toBe(0);
  });

  it('speed 三槽可以单独 null（该分量 0）', () => {
    const c = parseCommand('/particleex image minecraft:flame 0 0 0 a.png 0.1 0 0 0 not 10 null 1 2 0 null 1 null') as ImageVideoCmd;
    expect(c.speed).toEqual({ x: 0, y: 1, z: 2 });
  });

  it('rotate 非 90 倍数报错', () => {
    expect(() => parseCommand('/particleex image minecraft:flame 0 0 0 a.png 0.1 45 0 0 not 10 0 0 0')).toThrow(/xRotate 应为 90 的倍数/);
  });

  it('flip 数字被拒（只认枚举词）', () => {
    expect(() => parseCommand('/particleex image minecraft:flame 0 0 0 a.png 0.1 0 0 0 0 10 0 0 0')).toThrow(/flip 应为 not\/horizontally\/vertical/);
    expect(() => parseCommand('/particleex image minecraft:flame 0 0 0 a.png 0.1 0 0 0 1 10 0 0 0')).toThrow(); // 数字 1
    // 枚举词三个都接受
    for (const w of ['not', 'horizontally', 'vertical']) {
      const c = parseCommand(`/particleex image minecraft:flame 0 0 0 a.png 0.1 0 0 0 ${w} 10 0 0 0`) as ImageVideoCmd;
      expect([0, 1, 2]).toContain(c.flip);
    }
  });

  it('video 同字段序', () => {
    const c = parseCommand('/particleex video minecraft:flame 0 0 0 clip.mp4 1 0 0 0 not 10 0 0 0') as ImageVideoCmd;
    expect(c.kind).toBe('video');
    expect(c.path).toBe('clip.mp4');
  });

  it('video 参数过多报错（缺 flip 词时）', () => {
    expect(() => parseCommand('/particleex video minecraft:flame 0 0 0 clip.mp4 1 0 0 0 10 0 0 0')).toThrow(/flip/);
  });
});

describe('imageMatrix 解析', () => {
  it('E3 缺省 + 字段序', () => {
    const c = parseCommand('/particleex imagematrix minecraft:flame 0 0 0 a.png 0.1 E3 10 0 0 0') as ImageMatrixCmd;
    expect(c.kind).toBe('imageMatrix');
    expect(c.matrix).toBe('E3');
    expect(c.scaling).toBeCloseTo(0.1, 6);
    expect(c.dpb).toBeCloseTo(10, 6);
    expect(c.speed).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('括号 16 值矩阵字面量', () => {
    const cmd = "/particleex imagematrix minecraft:flame 0 0 0 a.png 0.1 '(1,0,0,0,,0,1,0,0,,0,0,1,-100,,0,0,0,1)' 10 0 0 0";
    const c = parseCommand(cmd) as ImageMatrixCmd;
    expect(c.matrix).toBe('(1,0,0,0,,0,1,0,0,,0,0,1,-100,,0,0,0,1)');
  });

  it('videomatrix', () => {
    const c = parseCommand('/particleex videomatrix minecraft:flame 0 0 0 clip.mp4 0.5 E4 5 null null null') as ImageMatrixCmd;
    expect(c.kind).toBe('videoMatrix');
    expect(c.speed).toBeNull();
  });
});

describe('clearcache / functionlist', () => {
  it('无参解析 + 执行成功', () => {
    expect(parseCommand('/particleex clearcache')).toEqual({ kind: 'clearcache' });
    expect(parseCommand('/particleex functionlist')).toEqual({ kind: 'functionlist' });
    const en = engine();
    expect(en.runCommand(parseCommand('/particleex clearcache')).errors).toEqual([]);
    expect(en.runCommand(parseCommand('/particleex functionlist')).errors).toEqual([]);
    expect(() => parseCommand('/particleex clearcache extra')).toThrow(/参数过多/);
  });
});

describe('round-trip（parse → serialize → parse 稳定）', () => {
  it('image 全字段', () => {
    // path 含 `/` → brigadier 未加引号字符集不允许，serialize 须加引号（游戏内
    // 同规则）；round-trip 源用规范（带引号）文本
    const src = "/particleex image minecraft:end_rod 11 8 0 'lyric/s0000_l0.png' 0.03125 0 90 0 not 10 0 0 0 16 null 1 null";
    expect(serialize(parseCommand(src))).toBe(src);
  });
  it('image 裸 path（无特殊字符）不加引号', () => {
    const src = '/particleex image minecraft:end_rod 0 0 0 a.png 0.1 0 0 0 not 10 0 0 0 5 null 1 g1';
    expect(serialize(parseCommand(src))).toBe(src);
  });
  it('imagematrix 括号矩阵', () => {
    const src = "/particleex imagematrix minecraft:flame 0 0 0 a.png 0.1 '(1,0,0,0,,0,1,0,0,,0,0,1,-100,,0,0,0,1)' 10 0 0 0 5 null 1 x";
    expect(serialize(parseCommand(src))).toBe(src);
  });
  it('clearcache / functionlist', () => {
    expect(serialize(parseCommand('/particleex clearcache'))).toBe('/particleex clearcache');
    expect(serialize(parseCommand('/particleex functionlist'))).toBe('/particleex functionlist');
  });
});

describe('exec image：预览无图片资源 → 模组口径报错', () => {
  it('image 执行报 invalid image path', () => {
    const en = engine();
    const r = en.runCommand(parseCommand('/particleex image minecraft:end_rod 0 0 0 a.png 0.1 0 0 0 not 10 0 0 0'));
    expect(r.errors).toEqual(['invalid image path: a.png']);
    expect(en.aliveCount).toBe(0);
  });
  it('imagematrix 同样', () => {
    const en = engine();
    const r = en.runCommand(parseCommand('/particleex imagematrix minecraft:flame 0 0 0 a.png 0.1 E3 10 0 0 0'));
    expect(r.errors).toEqual(['invalid image path: a.png']);
  });
});

describe('NBS2schematic 真实生成命令回归（生成端 ↔ 引擎互检协议）', () => {
  it('① 触发型圆环（polarparameter）', () => {
    const en = engine();
    const r = en.runCommand(parseCommand('particleex polarparameter minecraft:end_rod ~0 ~2 ~6 1 0.95 0.89 1 0 0 0 0 6.2832 \'dis=0.05;s1=t;s2=0\' 0.0628 20 \'(vx,vy,vz)=(0.25*exp(0-(t+0.5)/8)*cos(s1),0,0.25*exp(0-(t+0.5)/8)*sin(s1))\' 1 null'));
    expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
    expect(r.spawned).toBeGreaterThan(0);
  });
  it('① 触发型默认追加（conditional 十字线）', () => {
    const en = engine();
    const r = en.runCommand(parseCommand("particleex conditional minecraft:end_rod ~0 ~2 ~6 1 0.95 0.89 1 0 0 0 0.5 0.5 0.5 '(abs(y)==0.5&!(abs(z)<0.5))|(abs(x)==0.5&(!(abs(z)<0.5)|!(abs(y)<0.5)))' 0.1 0 'vy=0.2' 1 null"));
    expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
    expect(r.spawned).toBeGreaterThan(0);
  });
  it('② 连接型弧线（tickpolarparameter 双引号表达式）', () => {
    const en = engine();
    const r = en.runCommand(parseCommand('particleex tickpolarparameter minecraft:end_rod ~0 ~2 ~6 1 0.95 0.89 1 0 0 0 0 1.011363636 "s1,s2,dis=0,0,4*t" 0.022727273 9 10 null 1.0 null'));
    expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
    expect(r.spawned).toBeGreaterThan(0);
  });
  it('③ 背景型 bg——模组命令树已确认无此子命令（2026-10-10）', () => {
    // NBS 用户模板用 /particleex bg …（背景型）；模组侧确认命令树无 bg
    // （11 个一级子命令无背景语义），该模板在游戏内同样无效——生成端
    // 提醒已记录（候选映射：long-life + group 或 video/normal 持久效果）。
    expect(() => parseCommand('particleex bg minecraft:portal ~ ~0.5 ~ 0.5 0.1 0.1 0 0 0 0 10 0.4 1.0 null')).toThrow(/未知子命令 "bg"/);
  });
  it('④ 消失型（conditional #Cube + 保险组）与保险 remove', () => {
    const en = engine();
    const r = en.runCommand(parseCommand("particleex conditional minecraft:end_rod ~0 ~2 ~6 1 0.95 0.89 1 0 0 0 0.5 0.5 0.5 '(abs(y)==0.5&!(abs(z)<0.5))|(abs(x)==0.5&(!(abs(z)<0.5)|!(abs(y)<0.5)))' 0.1 2 'vy=0.05' 1.0 nbs2sfx_vanish_2"));
    expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
    const r2 = en.runCommand(parseCommand('particleex group remove nbs2sfx_vanish_2'));
    expect(r2.errors, JSON.stringify(r2.errors)).toEqual([]);
  });
  it('④ 歌词 image（真实 18 token 命令）', () => {
    const en = engine();
    const r = en.runCommand(parseCommand('particleex image minecraft:end_rod 11 8 0 lyric/s0000_l0.png 0.03125 0 90 0 not 10 0 0 0 16 null 1 null'));
    expect(r.errors).toEqual(['invalid image path: lyric/s0000_l0.png']); // 预览无图片资源
  });
  it('⑤ bg 替代默认形态（NBS 护栏置换后的 normal，可作 UI placeholder 示例）', () => {
    const en = engine();
    const r = en.runCommand(parseCommand('particleex normal minecraft:portal ~ ~0.5 ~ 0.5 0.1 0.1 0 0 0 0 1 1 1 100 10 null 1.0 null'));
    expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
    expect(r.spawned, 'spawned').toBe(100);
    // 字段序核验：pos 相对 (0,0.5,0) / color 4 槽 / speed 3 槽 / range 3 槽 / count / age=10
    const c = parseCommand('particleex normal minecraft:portal ~ ~0.5 ~ 0.5 0.1 0.1 0 0 0 0 1 1 1 100 10 null 1.0 null') as NormalCmd;
    expect(c.color).toEqual({ r: 0.5, g: 0.1, b: 0.1, a: 0 });
    expect(c.age).toBe(10);
    expect(c.speedStep).toBe(1);
    expect(c.group).toBeNull();
  });
  it('multi-line 全量解析（NBS 五类命令行集合，bg 除外）', () => {
    const cmds = parseCommands(`particleex polarparameter minecraft:end_rod ~0 ~2 ~6 1 0.95 0.89 1 0 0 0 0 6.2832 'dis=0.05;s1=t;s2=0' 0.0628 20 '(vx,vy,vz)=(0.25*exp(0-(t+0.5)/8)*cos(s1),0,0.25*exp(0-(t+0.5)/8)*sin(s1))' 1 null
particleex tickpolarparameter minecraft:end_rod ~0 ~2 ~6 1 0.95 0.89 1 0 0 0 0 1.011363636 "s1,s2,dis=0,0,4*t" 0.022727273 9 10 null 1.0 null
particleex group remove nbs2sfx_vanish_2`);
    expect(cmds.map((c) => c.kind)).toEqual(['parameter', 'parameter', 'group']);
    expect(cmds[1].kind === 'parameter' && cmds[1].tick && cmds[1].polar).toBe(true);
  });
});