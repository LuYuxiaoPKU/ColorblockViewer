// 播放时长预估（UI 进度条右端）：parser.estimateMaxAge / estimateDuration +
// 引擎 lastGenerators（生成器剩余生成期）。纯 UI 估算，非引擎 1:1 字段。
//
// 口径：
//  - estimateMaxAge：age>0 = age；age=-1 = INT_MAX（永活）；age=0 = 该类型
//    已知最大寿命（原版运动学寿命公式按**最不利随机数**求值：F→1 / 下一随机数
//    上界 nextInt(n)=n−1 / ctx.scale=1；未建模类型 = 默认寿命）。
//    注意 divPlus 族（flame 等）F→1 时 (int)(N/1.0)=N 取整值（上界 N+K，
//    如 flame = 12），非 N+1。
//  - estimateDuration：
//    - tick 变体（tickparameter/tickpolarparameter/…）= 生成期（⌊(end−begin)/step⌋+1
//      个 t 值 ÷ 每 tick cpt 个，向上取整）+ 首批粒子最大寿命
//    - 非 tick 命令（parameter/polarparameter/normal/conditional/vanilla）= 仅寿命
//      （生成期一 tick 同步跑完）
//    - group/clear = 0
//
// 槽位顺序（ground truth：Java brigadier 命令树，见 parser.ts 头部注释）：
//   name pos(3) color(4) speed(3) begin end expression [step]
//   [cpt ← 仅 tick 变体] [age] [speedExpression] [speedStep] [group]
//   非 tick 在 step 后**直接是 age**（命令树无 cpt 槽；结构里 cpt 恒 10 不使用）。
//   用户原命令 `… 0.0314 120 'speedExpr' 1 null` 即 step=0.0314、age=120。

import { describe, expect, it } from 'vitest';
import { SimEngine } from '../../src/sim/engine';
import { estimateDuration, estimateMaxAge, parseCommand } from '../../src/command/parser';

const INT_MAX = 2147483647;

function parse(line: string) {
  return parseCommand(line);
}

describe('estimateMaxAge', () => {
  it('age>0 = age；age=-1 = INT_MAX（永活）', () => {
    expect(estimateMaxAge('flame', 37, 20)).toBe(37);
    expect(estimateMaxAge('flame', -1, 20)).toBe(INT_MAX);
  });

  it('age=0：原版运动学表按最不利随机数（flame = (int)(8/(F·0.8+0.2))+4 → F=1 = 12）', () => {
    expect(estimateMaxAge('flame', 0, 20)).toBe(12);
  });

  it('age=0：end_rod = 60 + I(12) → 上界 71（nextInt 上界 = n−1）', () => {
    expect(estimateMaxAge('minecraft:end_rod', 0, 20)).toBe(71);
  });

  it('age=0：未建模类型 = 默认寿命', () => {
    expect(estimateMaxAge('not_a_real_particle', 0, 20)).toBe(20);
    expect(estimateMaxAge('not_a_real_particle', 0, 33)).toBe(33);
  });
});

describe('estimateDuration', () => {
  it('vanilla：仅类型寿命（原版 /particle 无 age 槽；flame 上界 12）', () => {
    const c = parse('particle flame 0 2 0 0.5 0.5 0.5 0.3 37');
    expect(estimateDuration(c, 20)).toBe(12);
  });

  it('normal：age 显式优先（age 25 → 25）', () => {
    // name=flame pos(3)=0 2 0 color(4)=1 0 0 1 speed(3)=0 0 0 range(3)=0.1 0.1 0.1
    // count=50 age=25
    const n = parse('particleex normal flame 0 2 0 1 0 0 1 0 0 0 0.1 0.1 0.1 50 25');
    expect(estimateDuration(n, 20)).toBe(25);
  });

  it('非 tick polarparameter（age=0 → end_rod 上界 71）：仅寿命（一 tick 同步生成）', () => {
    // pos(3) color(4) speed(3)=0 0 0 begin=0 end=10 expr step=0.1 age=0 speedExpr speedStep=1
    const c = parse("particleex polarparameter minecraft:end_rod 0 2 0 1 0.95 0.89 1 0 0 0 0 10 'dis=1;s1=2*t;s2=0' 0.1 0 'i=0.1;(vx,vy,vz)=((i)*cos(s1),0,(i)*sin(s1))' 1 null");
    expect(estimateDuration(c, 20)).toBe(71);
  });

  it('用户报告命令（polarparameter 非 tick，step=0.0314 age=120）：仅寿命 = 120', () => {
    const c = parse("/particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 0 6.2832 'dis=0.05;s1=t;s2=0' 0.0314 120 '(vx,vy,vz)=(0.32*exp(0-(t+0.5)/25)*cos(s1),0,0.32*exp(0-(t+0.5)/25)*sin(s1))' 1 null");
    expect(estimateDuration(c, 20)).toBe(120);
  });

  it('圆周环模板命令（polarparameter 非 tick，age=20）：仅寿命 = 20', () => {
    const c = parse("/particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 0 6.2832 'dis=0.05;s1=t;s2=0' 0.0628 20 '(vx,vy,vz)=(0.25*exp(0-(t+0.5)/8)*cos(s1),0,0.25*exp(0-(t+0.5)/8)*sin(s1))' 1 null");
    expect(estimateDuration(c, 20)).toBe(20);
  });

  it('tickpolarparameter（显式 cpt=120 age=20）：生成期 + 寿命', () => {
    // begin=0 end=6.2832 step=0.0628 → ⌊6.2832/0.0628⌋+1 = 101 个 t 值；
    // cpt=120 → ⌈101/120⌉ = 1 tick 生成期；age=20
    const c = parse("particleex tickpolarparameter minecraft:end_rod 0 2 0 1 0.95 0.89 1 0 0 0 0 6.2832 'dis=0.05;s1=t;s2=0' 0.0628 120 20 '(vx,vy,vz)=(0.32*exp(0-(t+0.5)/25)*cos(s1),0,0.32*exp(0-(t+0.5)/25)*sin(s1))' 1 null");
    expect(estimateDuration(c, 20)).toBe(1 + 20);
  });

  it('tickparameter（cpt=3 age 缺省 0 → flame 上界 12）：生成期 = ⌈100/3⌉ = 34', () => {
    // pos(3) color(4)=1 0 0 1 speed(3)=0 0 2 begin=0 end=99 step=1 cpt=3（age 缺省）
    const c = parse("particleex tickparameter flame 0 2 0 1 0 0 1 0 0 2 0 99 'x=t' 1 3");
    expect(estimateDuration(c, 20)).toBe(34 + 12);
  });

  it('begin > end：无生成 → 仅寿命（不出现负数）', () => {
    // begin=2 end=-1 → total=0 → 仅寿命
    const c = parse("particleex tickparameter flame 0 2 0 1 0 0 1 0 0 0 2 -1 'x=t' 1 3");
    expect(estimateDuration(c, 20)).toBe(12);
  });

  it('age=-1（永活，normal 有 age 槽）：右端 = INT_MAX（UI 层超出预估时按末帧退化）', () => {
    const c = parse('particleex normal flame 0 2 0 1 0 0 1 0 0 0 0.1 0.1 0.1 10 -1');
    expect(estimateDuration(c, 20)).toBe(INT_MAX);
  });

  it('group / clearparticle：无粒子贡献 = 0', () => {
    expect(estimateDuration(parse('particleex group remove g'), 20)).toBe(0);
    expect(estimateDuration(parse('particleex clearparticle'), 20)).toBe(0);
  });
});

describe('引擎 lastGenerators（App 剩余生成期预估的数据源）', () => {
  const cfg = { playerPos: { x: 0, y: 0, z: 0 }, defaultLifetime: 20, maxParticles: 100000, seed: 1, mcVersion: '26.2' as const, gridSize: 10, gridVisible: true, nativeKinematics: true, renderMode: 'full' as const };

  it('tickpolarparameter 执行：注册生成器 t/end/step/cpt 快照', () => {
    const e = new SimEngine({ ...cfg });
    const cmd = parse("particleex tickpolarparameter minecraft:end_rod 0 2 0 1 0.95 0.89 1 0 0 0 0 6.2832 'dis=0.05;s1=t;s2=0' 0.0628 120 20 '(vx,vy,vz)=(0.32*exp(0-(t+0.5)/25)*cos(s1),0,0.32*exp(0-(t+0.5)/25)*sin(s1))' 1 null");
    e.runCommand(cmd);
    expect(e.lastGenerators).toHaveLength(1);
    const g = e.lastGenerators[0];
    expect(g.end).toBe(6.2832);
    expect(g.step).toBe(0.0628);
    expect(g.cpt).toBe(120);
    expect(g.t).toBeGreaterThan(0); // 命令期首跑一批（cpt 120 ≥ 101 个 t 值 → 跑完）
    expect(e.queuedGenerators).toBe(0); // 首跑已耗尽 → 不排队
  });

  it('生成器未完成：t 停在剩余起点（App 用 (end−t)/step/cpt 估剩余）', () => {
    const e = new SimEngine({ ...cfg });
    // begin=0 end=99 step=1 → 100 个 t 值，cpt=3 → 命令期首跑 3 个（t=0,1,2）
    e.runCommand(parse("particleex tickparameter flame 0 2 0 1 0 0 1 0 0 2 0 99 'x=t' 1 3"));
    const g = e.lastGenerators[0];
    expect(g.t).toBeCloseTo(3);
    // 剩余 = ⌊(99−3)/1⌋ / 3 = 32 tick
    expect(Math.floor((g.end - g.t) / g.step) / g.cpt).toBe(32);
    expect(e.queuedGenerators).toBe(1);
  });

  it('reset 清空 lastGenerators（重跑命令不叠旧生成器）', () => {
    const e = new SimEngine({ ...cfg });
    e.runCommand(parse("particleex tickparameter flame 0 2 0 1 0 0 1 0 0 2 0 99 'x=t' 1 3"));
    expect(e.lastGenerators).toHaveLength(1);
    e.reset();
    expect(e.lastGenerators).toHaveLength(0);
  });

  it('非 tick 命令不产生 lastGenerators', () => {
    const e = new SimEngine({ ...cfg });
    e.runCommand(parse('particle flame 0 2 0 0.5 0.5 0.5 0.3 37'));
    expect(e.lastGenerators).toHaveLength(0);
  });
});
