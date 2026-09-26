// spawn.ts（命令执行 → 粒子生成）与 structFill.ts（ParticleStruct 填充）
// 直接测试：目前这两层只经 SimEngine 端到端间接覆盖，此处用 stub sink /
// 假 PRNG 隔离单测各导出函数。
//
// 锁定的关键语义（1:1 移植 + 预览防护）：
//  - struct 填充：跨 invoke 不清零（只写 Java 逐字赋值的字段）；
//    fillPerTick 的 vx/vy/vz NaN 哨兵与「age 从不赋值 → 恒 0」；
//    group change 的 cexe 路径不写 age/t、group remove 的 remove 路径写 age=t；
//  - 高斯消费顺序：normal 每粒子 3 次、vanilla count>0 每粒子 6 次
//    （位置 xyz 先、速度 xyz 后），vanilla count==0 零次且速度=speed×delta 确定值；
//  - parseOptionalExpr 的 'null'/'空'/null 特判（不解析不抛）；
//  - spawnOne 速度表达式解析失败 → 记 errors、不生成、**不中断**后续粒子；
//    命令级表达式错误 → 抛给调用方；
//  - 步长守卫（预览运行时防护，非 1:1 后果）：t+step===t 定点中止；
//  - group change 的 do-while 死粒子 NPE（cexe==null 时游戏内崩溃，预览
//    记录同文案错误并终止）；
//  - NBT 渲染色/大小倍数/ trail·vibration 附加消费。
//
// 表达式全部浅层（golden 深嵌套括号挂死约束）。

import { describe, expect, it } from 'vitest';
import { parse } from '../../src/engine';
import { ParticleStruct } from '../../src/engine/struct';
import { parseCommand } from '../../src/command/parser';
import type { NormalCmd, ConditionalCmd, ParameterCmd, VanillaCmd } from '../../src/command/types';
import {
  resolveVec3,
  wireParse,
  execNormal,
  execConditional,
  execParameter,
  runGeneratorStep,
  execVanilla,
  execGroupRemove,
  execGroupChange,
  type SpawnRequest,
  type SpawnSink,
  type GroupEngineView,
} from '../../src/sim/spawn';
import {
  fillFirstMove,
  fillPerTick,
  fillConditionalPoint,
  fillParameterPoint,
  fillGroupRelative,
  fillGroupChangeParam,
  computeSpawnStep,
} from '../../src/sim/structFill';
import { GroupIndex } from '../../src/sim/groups';
import { SimRandom } from '../../src/sim/rng';
import type { SimParticle, TickGenerator } from '../../src/sim/types';

// ---------- 测试替身 ----------

/** 直接构造 NormalCmd（不走 parseCommand：坏速度表达式等无法经命令解析的形态） */
const makeNormal = (over: Partial<NormalCmd> = {}): NormalCmd => ({
  kind: 'normal', name: 'flame',
  pos: { x: { v: 0, rel: false }, y: { v: 0, rel: false }, z: { v: 0, rel: false } },
  color: { r: 1, g: 1, b: 1, a: 1 },
  speed: { x: 0, y: 0, z: 0 }, range: { x: 0, y: 0, z: 0 },
  count: 1, age: 0, speedExpression: null, speedStep: 1, group: null,
  ...over,
});

/** 假 PRNG：nextGaussian 按调用次序出值（序列可预测、可断言消费顺序） */
class FakeRand {
  values: number[] = [];
  calls = 0;
  nextGaussian(): number {
    this.calls++;
    return this.values.shift() ?? 0;
  }
}

/** stub sink：收集 spawn 请求与生成器；rand 用结构性类型（FakeRand 与
 *  SimRandom 均满足 —— spawn 层只调 nextGaussian） */
function makeSink(
  rand: { nextGaussian(): number },
  playerPos: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): SpawnSink & { spawns: SpawnRequest[]; gens: TickGenerator[] } {
  const spawns: SpawnRequest[] = [];
  const gens: TickGenerator[] = [];
  return {
    spawns,
    gens,
    result: { spawned: 0, dropped: 0, errors: [] },
    playerPos,
    groups: new GroupIndex(),
    rand: rand as unknown as SimRandom, // 只用到 nextGaussian，结构上足够
    spawn: (req) => { spawns.push(req); },
    addGenerator: (g) => { gens.push(g); },
  };
}

function makeParticle(over: Partial<SimParticle> = {}): SimParticle {
  return {
    id: 0, name: 'flame',
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    stop: true,
    r: 1, g: 1, b: 1, a: 1,
    age: 0, lifetime: 20, vanilla: false,
    cx: 0, cy: 0, cz: 0,
    exe: null, speedStep: 1, moveT: 0, exeStruct: null,
    alive: true,
    ...over,
  };
}

/** 最小 GroupEngineView（粒子表 + 计数） */
function makeEngineView(ps: SimParticle[]): GroupEngineView & { map: Map<number, SimParticle> } {
  const map = new Map(ps.map(p => [p.id, p]));
  return {
    map,
    get: (id) => map.get(id),
    kill: (id) => { const p = map.get(id); if (p) p.alive = false; },
    prune: () => {},
  };
}

// 测试内 wire 的 parse 替身：真实引擎语义 + 记录调用序列（断言解析次数/时机）
const parseCalls: string[] = [];
let parseThrows = false;
function resetParseState(): void {
  parseCalls.length = 0;
  parseThrows = false;
  wireParse((src) => {
    parseCalls.push(src);
    if (parseThrows) throw new Error('BOOM: ' + src);
    return parse(src);
  });
}
resetParseState();

const near = (got: number, want: number, eps = 1e-12): void => {
  expect(Math.abs(got - want), `期望 ${want}, 实际 ${got}`).toBeLessThanOrEqual(eps);
};

// ---------- structFill ----------

describe('structFill：ParticleStruct 填充（跨 invoke 不清零语义）', () => {
  it('fillFirstMove：首帧写 9 字段（cx/cy/cz + dx/dy/dz + ddis/ds1/ds2）', () => {
    const p = makeParticle({ x: 3, y: 4, z: 0, cx: 1, cy: 1, cz: 0 });
    const s = new ParticleStruct();
    fillFirstMove(s, p);
    expect([s.cx, s.cy, s.cz]).toEqual([1, 1, 0]);
    expect([s.dx, s.dy, s.dz]).toEqual([2, 3, 0]);
    near(s.ddis, Math.sqrt(13));
    near(s.ds1, Math.atan2(0, 2)); // 0
    near(s.ds2, Math.atan2(3, 2));
  });

  it('fillFirstMove：位移为负时 atan2 分支正确', () => {
    const p = makeParticle({ x: -1, y: -2, z: 3, cx: 0, cy: 0, cz: 0 });
    const s = new ParticleStruct();
    fillFirstMove(s, p);
    near(s.ds1, Math.atan2(3, -1));
    near(s.ds2, Math.atan2(-2, Math.hypot(-1, 3)));
    near(s.ddis, Math.sqrt(14));
  });

  it('fillPerTick：vx/vy/vz 置 NaN 哨兵 + 相对位置/颜色/dis/s1/s2/t', () => {
    const p = makeParticle({ x: 2, y: 0, z: 1, cx: 1, cy: -1, cz: 0, r: 0.5, g: 0.25, b: 0.125, a: 0.75, moveT: 7 });
    const s = new ParticleStruct();
    const t = fillPerTick(s, p);
    expect(t).toBe(7);
    expect(s.t).toBe(7);
    expect(Number.isNaN(s.vx)).toBe(true);
    expect(Number.isNaN(s.vy)).toBe(true);
    expect(Number.isNaN(s.vz)).toBe(true);
    expect([s.x, s.y, s.z]).toEqual([1, 1, 1]); // 相对中心
    expect([s.cr, s.cg, s.cb, s.alpha]).toEqual([0.5, 0.25, 0.125, 0.75]);
    near(s.dis, Math.sqrt(3));
    near(s.s1, Math.atan2(1, 1));
    near(s.s2, Math.atan2(1, Math.hypot(1, 1)));
  });

  it('fillPerTick：age 从不赋值 → 保持初值 0（模组已知缺陷，忠实复刻）', () => {
    const p = makeParticle({ age: 15 });
    const s = new ParticleStruct();
    fillPerTick(s, p);
    expect(s.age).toBe(0); // 粒子已活 15 tick，struct.age 仍 0
  });

  it('fillPerTick：未写的字段保留上次 invoke 的残留值（不清零）', () => {
    const s = new ParticleStruct();
    s.dis = 99; s.s1 = 50; s.s2 = 50;
    const p = makeParticle();
    fillPerTick(s, p);
    // 位移全 0 → dis=0、s1/s2=atan2(0,0)=0 被写；但 dx/ds1 等从不在此路径写 → 残留
    near(s.dx, 0); // 初值
    expect(s.ds1).toBe(0); // 初值（fillFirstMove 才写）
    expect(s.age).toBe(0);
  });

  it('fillConditionalPoint：只写 x/y/z/s1/s2/dis（不写 age/t —— 残留靠调用方）', () => {
    const s = new ParticleStruct();
    s.age = 42; s.t = 7;
    fillConditionalPoint(s, 1, 2, 2);
    expect([s.x, s.y, s.z]).toEqual([1, 2, 2]);
    near(s.s1, Math.atan2(2, 1));
    near(s.s2, Math.atan2(2, Math.hypot(1, 2)));
    near(s.dis, 3);
    expect(s.age).toBe(42); // 未写 → 残留
    expect(s.t).toBe(7);
  });

  it('fillParameterPoint：只写 t', () => {
    const s = new ParticleStruct();
    s.x = 11;
    fillParameterPoint(s, 3.5);
    expect(s.t).toBe(3.5);
    expect(s.x).toBe(11); // 未写 → 残留
  });

  it('fillGroupRelative：remove 路径（setAge>=0）写相对坐标 + age=t=age；change 路径（setAge<0）不写', () => {
    // remove：粒子 (5,0,0) 相对 ref (1,0,0)，已活 4 tick
    const s1 = new ParticleStruct();
    fillGroupRelative(s1, 5, 0, 0, 1, 0, 0, 4);
    expect([s1.x, s1.y, s1.z]).toEqual([4, 0, 0]);
    expect(s1.age).toBe(4);
    expect(s1.t).toBe(4);
    near(s1.dis, 4);

    // change 的 cexe 路径：setAge=-1 → age/t 不写
    const s2 = new ParticleStruct();
    s2.age = 99; s2.t = 99;
    fillGroupRelative(s2, 5, 0, 0, 1, 0, 0, -1);
    expect(s2.age).toBe(99);
    expect(s2.t).toBe(99);
    expect([s2.x, s2.y, s2.z]).toEqual([4, 0, 0]);
  });

  it('fillGroupChangeParam：相对 ref 的位置 + 当前速度/中心/渲染色', () => {
    const p = makeParticle({ x: 2, y: -1, z: 3, vx: 0.5, vy: -0.25, vz: 0.125, cx: 1, cy: 1, cz: 1, r: 0.9, g: 0.8, b: 0.7, a: 0.6 });
    const s = new ParticleStruct();
    fillGroupChangeParam(s, p, 1, 2, 3);
    expect([s.x, s.y, s.z]).toEqual([1, -3, 0]);
    expect([s.vx, s.vy, s.vz]).toEqual([0.5, -0.25, 0.125]);
    expect([s.cx, s.cy, s.cz]).toEqual([1, 1, 1]);
    expect([s.cr, s.cg, s.cb, s.alpha]).toEqual([0.9, 0.8, 0.7, 0.6]);
  });

  it('computeSpawnStep：polar 转换与 rgba/非 rgba 的颜色速度选择', () => {
    const s = new ParticleStruct();
    const gen: TickGenerator = {
      name: 'flame', x: 0, y: 0, z: 0, color: { r: 1, g: 0.5, b: 0.25, a: 0.9 },
      cmdVel: { vx: 0.1, vy: 0.2, vz: 0.3 }, begin: 0, end: 1, step: 1, cpt: 1,
      age: 0, speedExpression: null, speedStep: 1, group: null, polar: false,
      exe: parse('1'), struct: s, t: 0,
    };
    // 非 polar：data.x/y/z；颜色/速度 = 命令值
    s.x = 1; s.y = -2; s.z = 0.5;
    let st = computeSpawnStep(gen);
    expect([st.dx, st.dy, st.dz]).toEqual([1, -2, 0.5]);
    expect(st.color).toEqual({ r: 1, g: 0.5, b: 0.25, a: 0.9 });
    expect(st.vel).toEqual({ vx: 0.1, vy: 0.2, vz: 0.3 });

    // polar：x=dis·cos(s2)·cos(s1), y=dis·sin(s2), z=dis·cos(s2)·sin(s1)
    gen.polar = true;
    s.dis = 2; s.s1 = Math.PI / 2; s.s2 = 0;
    st = computeSpawnStep(gen);
    near(st.dx, 0); // 2·cos(0)·cos(PI/2)≈0
    near(st.dy, 0); // 2·sin(0)
    near(st.dz, 2); // 2·cos(0)·sin(PI/2)

    // rgba 变体（color=null）：颜色/速度取 data
    gen.color = null;
    gen.cmdVel = null;
    s.cr = 0.1; s.cg = 0.2; s.cb = 0.3; s.alpha = 0.4;
    s.vx = 0.5; s.vy = 0.6; s.vz = 0.7;
    st = computeSpawnStep(gen);
    expect(st.color).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 0.4 });
    expect(st.vel).toEqual({ vx: 0.5, vy: 0.6, vz: 0.7 });
  });
});

// ---------- spawn：resolveVec3 ----------

describe('spawn：resolveVec3（~/^ 相对坐标求值）', () => {
  const v = (x: [number, boolean], y: [number, boolean], z: [number, boolean]) => ({
    x: { v: x[0], rel: x[1] }, y: { v: y[0], rel: y[1] }, z: { v: z[0], rel: z[1] },
  });
  const player = { x: 10, y: 64, z: -5 };

  it('rel → 玩家位置 + v；绝对 → 原值（混合坐标）', () => {
    expect(resolveVec3(v([1, true], [2, false], [3, true]), player)).toEqual({ x: 11, y: 2, z: -2 });
    expect(resolveVec3(v([0, true], [0, true], [0, true]), player)).toEqual(player);
    expect(resolveVec3(v([-2.5, true], [100, false], [0, false]), player)).toEqual({ x: 7.5, y: 100, z: 0 });
  });
});

// ---------- spawn：execNormal ----------

describe('spawn：execNormal（每粒子 3 次高斯，按 i 顺序逐次消费）', () => {
  it('count=2 range=(1,2,3)：位置 = 命令位置 + 3×3 高斯序列 × range', () => {
    resetParseState();
    const rand = new FakeRand();
    rand.values = [1, -1, 0.5, 0.25, -0.5, 2];
    const sink = makeSink(rand, { x: 1, y: 2, z: 3 });
    const cmd = parseCommand('particleex normal flame 1 2 3 1 0 0 1 0 0 0 1 2 3 2') as NormalCmd;
    execNormal(cmd, sink);
    expect(sink.spawns).toHaveLength(2);
    expect(rand.calls).toBe(6);
    const [p1, p2] = sink.spawns;
    expect([p1.x, p1.y, p1.z]).toEqual([2, 0, 4.5]); // 1+1, 2-2, 3+1.5（3×0.5）
    expect([p1.cx, p1.cy, p1.cz]).toEqual([1, 2, 3]); // 中心 = 命令位置
    expect([p2.x, p2.y, p2.z]).toEqual([1.25, 1, 9]); // 1+0.25, 2-1, 3+6（3×2）
  });

  it('range 全 0：无随机分量（0×高斯=0），精确生成', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand('particleex normal flame 0 0 0 1 1 1 1 0 0 0 0 0 0 1') as NormalCmd;
    execNormal(cmd, sink);
    expect(sink.spawns[0].x).toBe(0);
    expect(sink.spawns[0].y).toBe(0);
    expect(sink.spawns[0].z).toBe(0);
  });

  it('真 PRNG：count=3 的位置序列可复现（同种子 SimRandom）', () => {
    resetParseState();
    const sink = makeSink(new SimRandom(42));
    const cmd = parseCommand('particleex normal flame 0 0 0 1 1 1 1 1 1 1 1 1 1 3') as NormalCmd;
    execNormal(cmd, sink);
    const a = sink.spawns.map(p => [p.x, p.y, p.z]);
    const sink2 = makeSink(new SimRandom(42));
    execNormal(cmd, sink2);
    const b = sink2.spawns.map(p => [p.x, p.y, p.z]);
    expect(a).toEqual(b);
    expect(a[0][0]).not.toBe(0); // 确实走了随机路径
  });
});

// ---------- spawn：spawnOne 错误语义 ----------

describe('spawn：spawnOne（速度表达式 try/catch 语义）', () => {
  it('速度表达式解析失败 → 记 errors、该粒子不生成，后续粒子继续', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    execNormal(makeNormal({ speedExpression: '(x+' }), sink); // 坏表达式
    expect(sink.result.errors).toHaveLength(1);
    expect(sink.spawns).toHaveLength(0);
    execNormal(makeNormal({ speedExpression: 'vy=0.1' }), sink); // 好表达式
    expect(sink.result.errors).toHaveLength(1); // 不重复记
    expect(sink.spawns).toHaveLength(1);
    expect(sink.spawns[0].exe).not.toBeNull();
    expect(sink.spawns[0].exeStruct).toBeInstanceOf(ParticleStruct); // 每粒子全新实例
  });

  it('每粒子的 exeStruct 独立（跨粒子无残留 —— Java 每 ClassExpression 一个 struct）', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    execNormal(makeNormal({ count: 2, speedExpression: 'vy=0.1' }), sink);
    expect(sink.spawns).toHaveLength(2);
    expect(sink.spawns[0].exeStruct).not.toBe(sink.spawns[1].exeStruct);
  });

  it('「null」/空速度表达式 → exe=null 不解析（parseOptionalExpr 特判）', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    for (const expr of ['null', '']) {
      execNormal(makeNormal({ speedExpression: expr }), sink);
    }
    expect(sink.spawns).toHaveLength(2);
    expect(parseCalls).toHaveLength(0); // 特判路径零解析
    for (const p of sink.spawns) expect(p.exe).toBeNull();
  });
});

// ---------- spawn：execConditional ----------

describe('spawn：execConditional（三重扫描含两端）', () => {
  it('range=1 step=0.5：5×5×5=125 点，含两端（-1 与 1）', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand('particleex conditional flame 0 0 0 1 1 1 1 1 1 1 1 1 1 "1" 0.5 0') as ConditionalCmd;
    execConditional(cmd, sink);
    expect(sink.spawns).toHaveLength(125); // -1,-0.5,0,0.5,1 各轴 5 值
    const xs = sink.spawns.map(p => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(-1);
    expect(xs[xs.length - 1]).toBe(1);
  });

  it('条件为假（恒 0）→ 不生成；条件为真（恒 1）→ 全部生成', () => {
    resetParseState();
    const sink0 = makeSink(new FakeRand());
    execConditional(parseCommand('particleex conditional flame 0 0 0 1 1 1 1 1 1 1 1 1 1 "0" 0.5 0') as ConditionalCmd, sink0);
    expect(sink0.spawns).toHaveLength(0);
    const sink1 = makeSink(new FakeRand());
    execConditional(parseCommand('particleex conditional flame 0 0 0 1 1 1 1 0 0 0 0.5 0.5 0.5 "1" 0.5 0') as ConditionalCmd, sink1);
    expect(sink1.spawns).toHaveLength(27); // ±0.5 立方：-0.5,0,0.5 各轴 3 值
  });

  it('速度表达式解析失败 → 记录错误、该点不生成，扫描不中断（后续点照常尝试）', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand('particleex conditional flame 0 0 0 1 1 1 1 0 0 0 0.5 0.5 0.5 "1" 0.5 0 "(x+)"') as ConditionalCmd;
    execConditional(cmd, sink);
    expect(sink.spawns).toHaveLength(0); // spawnOne：解析失败 → 该粒子不生成
    expect(sink.result.errors).toHaveLength(27); // 每点一次（spawnOne 内 try，不中断扫描）
  });

  it('命令级条件表达式错误 → 抛出（调用方捕获），不生成', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    expect(() =>
      execConditional(parseCommand('particleex conditional flame 0 0 0 1 1 1 1 1 1 1 1 1 1 "(x+" 0.5') as ConditionalCmd, sink),
    ).toThrow();
    expect(sink.spawns).toHaveLength(0);
  });
});

// ---------- spawn：execParameter ----------

describe('spawn：execParameter（8 变体的共享语义）', () => {
  it('非 tick：t 从 begin 到 end（含两端）每步生成一个，位置 = 表达式值 + 命令位置', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand('particleex parameter flame 1 0 0 1 1 1 1 0 0 0 0 10 "x,y,z=t,0,0" 1') as ParameterCmd;
    execParameter(cmd, sink);
    expect(sink.spawns).toHaveLength(11); // t=0..10
    expect(sink.spawns[0].x).toBe(1); // 命令位置 + t=0
    expect(sink.spawns[10].x).toBe(11); // 命令位置 + t=10
    expect(sink.spawns[3].x).toBe(4);
  });

  it('polar 变体：dis/s1/s2 → 笛卡尔偏移（cos/sin 分解）', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand(
      'particleex polarparameter flame 0 0 0 1 1 1 1 0 0 0 0 2 "dis=2;s1=0;s2=0" 1',
    ) as ParameterCmd;
    execParameter(cmd, sink);
    expect(sink.spawns).toHaveLength(3); // t=0,1,2
    for (const p of sink.spawns) {
      near(p.x, 2); // dis·cos(0)·cos(0)
      near(p.y, 0); // dis·sin(0)
      near(p.z, 0); // dis·cos(0)·sin(0)
    }
  });

  it('rgba 变体：颜色取 data（表达式写 cr/cg/cb/alpha），速度一律命令速度', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand(
      'particleex rgbaparameter flame 0 0 0 0 0 0 0 2 "x,y,z=1,1,1;cr=0.1;cg=0.2;cb=0.3;alpha=0.4" 1',
    ) as ParameterCmd;
    execParameter(cmd, sink);
    expect(sink.spawns).toHaveLength(3);
    for (const p of sink.spawns) {
      expect([p.x, p.y, p.z]).toEqual([1, 1, 1]);
      expect([p.r, p.g, p.b, p.a]).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect([p.vx, p.vy, p.vz]).toEqual([0, 0, 0]); // 命令速度（非 data 速度）
    }
  });

  it('tick 变体：只注册生成器（本 tick 的 run 由 engine 负责），struct 初值 t=begin', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand('particleex tickparameter flame 0 0 0 1 1 1 1 0 0 0 0 10 "x,y,z=0,0,0" 0.5 1 0 null 1 null') as ParameterCmd;
    execParameter(cmd, sink);
    expect(sink.spawns).toHaveLength(0);
    expect(sink.gens).toHaveLength(1);
    const g = sink.gens[0];
    expect(g.t).toBe(0); // = begin
    expect(g.begin).toBe(0);
    expect(g.end).toBe(10);
    expect(g.step).toBe(0.5);
    expect(g.cpt).toBe(1);
    expect(g.color).not.toBeNull();
  });

  it('表达式「null」→ 不解析不生成（ClientNetworkHandler.parameter 的 null 直接 return）', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand('particleex parameter flame 0 0 0 1 1 1 1 0 0 0 0 10 "null" 1') as ParameterCmd;
    execParameter(cmd, sink);
    expect(sink.spawns).toHaveLength(0);
    expect(sink.gens).toHaveLength(0);
    expect(parseCalls).toHaveLength(0);
  });
});

// ---------- spawn：runGeneratorStep ----------

describe('spawn：runGeneratorStep（TickParticleTask 单 tick 循环）', () => {
  function mkGen(over: Partial<TickGenerator> = {}): TickGenerator {
    return {
      name: 'flame', x: 0, y: 0, z: 0,
      color: { r: 1, g: 1, b: 1, a: 1 },
      cmdVel: { vx: 0.1, vy: 0.2, vz: 0.3 },
      begin: 0, end: 3, step: 1, cpt: 2,
      age: 0, speedExpression: null, speedStep: 1, group: null,
      polar: false, exe: parse('1'), struct: new ParticleStruct(), t: 0,
      ...over,
    };
  }

  it('本 tick 生成 min(cpt, 剩余步数) 个，t 跨 tick 持续递增', () => {
    resetParseState();
    const g = mkGen(); // end=3 step=1 cpt=2 → t=0,1,2,3 共 4 步
    const s1 = makeSink(new FakeRand());
    expect(runGeneratorStep(g, s1)).toBe(true); // t: 0,1 → 2 ≤ 3
    expect(s1.spawns).toHaveLength(2);
    expect(g.t).toBe(2);
    const s2 = makeSink(new FakeRand());
    expect(runGeneratorStep(g, s2)).toBe(false); // t: 2,3 → 4 > 3 → 本 tick 后任务结束
    expect(s2.spawns).toHaveLength(2);
    expect(g.t).toBe(4);
    const s3 = makeSink(new FakeRand());
    expect(runGeneratorStep(g, s3)).toBe(false); // 4 > 3 → 不生成
    expect(s3.spawns).toHaveLength(0);
  });

  it('struct 跨 run 不清零（同一 TickParticleTask 的多次 run 共享）', () => {
    resetParseState();
    // rgba 变体（color=null → cmdVel=null）：生成速度取 data.vx，
    // 表达式写的 vx=5 才会体现在粒子上（非 rgba 变体速度恒为命令速度）；
    // cpt=1：每次 run 恰好消耗 1 步（默认 cpt=2 会一次耗尽 end=1 的全部步数）
    const g = mkGen({ end: 1, cpt: 1, color: null, cmdVel: null, exe: parse('vx=5') });
    const s1 = makeSink(new FakeRand());
    runGeneratorStep(g, s1); // t=0：表达式写 vx=5
    expect(s1.spawns[0].vx).toBe(5);
    const s2 = makeSink(new FakeRand());
    runGeneratorStep(g, s2); // t=1：struct 不清零（x 等仍为上次值），表达式再写 vx=5
    expect(s2.spawns[0].vx).toBe(5);
  });

  it('表达式抛错（运行期）→ 传播给 engine（不吞）', () => {
    resetParseState();
    // 除零/形状错等运行期错误：矩阵减法形状不匹配
    const g = mkGen({ end: 1, exe: parse('(x,y)=(x,1)-(1,1,1)') });
    const s1 = makeSink(new FakeRand());
    expect(() => runGeneratorStep(g, s1)).toThrow();
    expect(s1.spawns).toHaveLength(0);
  });
});

// ---------- spawn：execVanilla ----------

describe('spawn：execVanilla（原版 /particle 客户端语义）', () => {
  it('count==0：单粒子精确生成，速度 = speed×delta（确定值，零高斯）', () => {
    resetParseState();
    const rand = new FakeRand();
    rand.values = [9, 9, 9, 9, 9, 9]; // 若误消费高斯 → 位置/速度非预期
    const sink = makeSink(rand);
    const cmd = parseCommand('particle minecraft:flame 1 2 3 0.5 0.5 0.5 0.25 0') as VanillaCmd;
    execVanilla(cmd, sink);
    expect(sink.spawns).toHaveLength(1);
    expect(rand.calls).toBe(0);
    const p = sink.spawns[0];
    expect([p.x, p.y, p.z]).toEqual([1, 2, 3]);
    expect([p.cx, p.cy, p.cz]).toEqual([1, 2, 3]);
    expect([p.vx, p.vy, p.vz]).toEqual([0.125, 0.125, 0.125]); // 0.25×0.5 各轴
    expect(p.vanilla).toBe(true);
    expect(p.age).toBe(0);
  });

  it('count>0：每粒子 6 次高斯 —— 位置 xyz 先、速度 xyz 后（字节码顺序）', () => {
    resetParseState();
    const rand = new FakeRand();
    rand.values = [1, 2, 3, 4, 5, 6, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const sink = makeSink(rand);
    const cmd = parseCommand('particle minecraft:flame 0 0 0 1 1 1 0.5 2') as VanillaCmd;
    execVanilla(cmd, sink);
    expect(sink.spawns).toHaveLength(2);
    expect(rand.calls).toBe(12);
    const [p1, p2] = sink.spawns;
    // 粒子1：位置偏移 = 高斯(1,2,3)×delta(1,1,1)，速度 = 高斯(4,5,6)×0.5
    expect([p1.x, p1.y, p1.z]).toEqual([1, 2, 3]);
    expect([p1.vx, p1.vy, p1.vz]).toEqual([2, 2.5, 3]);
    // 粒子2：位置 = (0.1,0.2,0.3)×1，速度 = (0.4,0.5,0.6)×0.5
    expect([p2.x, p2.y, p2.z]).toEqual([0.1, 0.2, 0.3]);
    expect([p2.vx, p2.vy, p2.vz]).toEqual([0.2, 0.25, 0.3]);
  });

  it('delta/speed/count 缺省 → 0：count 缺省 = 0（单粒子精确）', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand('particle minecraft:flame') as VanillaCmd;
    execVanilla(cmd, sink);
    expect(sink.spawns).toHaveLength(1);
    expect(sink.spawns[0].x).toBe(0); // pos 缺省 → 玩家位置
    expect([sink.spawns[0].vx, sink.spawns[0].vy, sink.spawns[0].vz]).toEqual([0, 0, 0]);
  });

  it('dust{NBT}：渲染色与点大小倍数消费（0xRRGGBB 与 scale）', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand('particle dust{color:0x00FF00,scale:2} 0 0 0 0 0 0 0 0') as VanillaCmd;
    execVanilla(cmd, sink);
    const p = sink.spawns[0];
    expect(p.nbtTint).toBe(true);
    near(p.r, 0);
    near(p.g, 1);
    near(p.b, 0);
    expect(p.sizeMul).toBe(2);
  });

  it('trail{NBT}：target 绝对坐标与 duration 寿命覆写', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand('particle trail{color:1,target:[1,2,3],duration:30} 0 0 0 0 0 0 0 0') as VanillaCmd;
    execVanilla(cmd, sink);
    const p = sink.spawns[0];
    expect(p.trailTarget).toEqual({ x: 1, y: 2, z: 3 });
    expect(p.trailDuration).toBe(30);
    expect(p.nbtTint).toBe(true); // trail 的 color 也消费为渲染色
  });

  it('vibration{NBT}：destination block 中心（+0.5 各轴）与 arrival_in_ticks', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand(
      'particle vibration{arrival_in_ticks:50,destination:{block:{pos:[10,20,30]}}} 0 0 0 0 0 0 0 0',
    ) as VanillaCmd;
    execVanilla(cmd, sink);
    const p = sink.spawns[0];
    expect(p.vibrationTarget).toEqual({ x: 10.5, y: 20.5, z: 30.5 });
    expect(p.vibrationArrival).toBe(50);
  });

  it('非收录类型 / 无 NBT：全缺省（白 + 1，无 tint）', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    execVanilla(parseCommand('particle minecraft:end_rod 0 0 0 0 0 0 0 0') as VanillaCmd, sink);
    const p = sink.spawns[0];
    expect([p.r, p.g, p.b]).toEqual([1, 1, 1]);
    expect(p.nbtTint).toBe(false);
    expect(p.sizeMul).toBe(1);
  });
});

// ---------- spawn：group 操作 ----------

describe('spawn：group remove / group change（do-while 边角行为）', () => {
  const makeGroupCmd = (text: string) => parseCommand(text);

  it('group remove 无表达式：组内全部活粒子移除，返回移除数', () => {
    resetParseState();
    const ps = [makeParticle({ id: 1, x: 1 }), makeParticle({ id: 2, x: 2 })];
    const view = makeEngineView(ps);
    const groups = new GroupIndex();
    groups.add('g1', 1);
    groups.add('g1', 2);
    const sink = makeSink(new FakeRand()) as SpawnSink & { groups: GroupIndex };
    sink.groups = groups;
    const removed = execGroupRemove(makeGroupCmd('particleex group remove g1') as never, sink, view);
    expect(removed).toBe(2);
    expect(ps[0].alive).toBe(false);
    expect(ps[1].alive).toBe(false);
  });

  it('group remove 带表达式：仅 invoke!=0 的粒子移除（相对 ref 填充 + age=t）', () => {
    resetParseState();
    const ps = [makeParticle({ id: 1, x: 1, age: 3 }), makeParticle({ id: 2, x: -1, age: 3 })];
    const view = makeEngineView(ps);
    const groups = new GroupIndex();
    groups.add('g1', 1);
    groups.add('g1', 2);
    const sink = makeSink(new FakeRand(), { x: 0, y: 0, z: 0 });
    sink.groups = groups;
    // x>0.5 且 age>1 才移除 → 只移除 id=1
    const removed = execGroupRemove(
      makeGroupCmd("particleex group remove g1 'x>0.5&(age>1)'") as never,
      sink,
      view,
    );
    expect(removed).toBe(1);
    expect(ps[0].alive).toBe(false);
    expect(ps[1].alive).toBe(true);
  });

  it('group change parameter：摆位 ref+data.x、换颜色/速度；速度归零 → stop=true', () => {
    resetParseState();
    const p = makeParticle({ id: 1, x: 3, y: 0, z: 0, vx: 1, vy: 0, vz: 0, r: 1, g: 1, b: 1, a: 1, stop: false });
    const view = makeEngineView([p]);
    const groups = new GroupIndex();
    groups.add('g1', 1);
    const sink = makeSink(new FakeRand(), { x: 0, y: 0, z: 0 });
    sink.groups = groups;
    // x=1 → 摆到 ref+(1,2,3)=(1,2,3)；颜色 (0.5,0,0,1)；速度 0 → stop=true
    execGroupChange(
      makeGroupCmd("particleex group change parameter g1 'x,y,z=1,2,3;cr,cg,cb=0.5,0,0;alpha=1;vx,vy,vz=0,0,0' null") as never,
      sink,
      view,
    );
    expect([p.x, p.y, p.z]).toEqual([1, 2, 3]);
    expect([p.cx, p.cy, p.cz]).toEqual([0, 0, 0]); // 未写 → 残留初值
    expect([p.r, p.g, p.b, p.a]).toEqual([0.5, 0, 0, 1]);
    expect([p.vx, p.vy, p.vz]).toEqual([0, 0, 0]);
    expect(p.stop).toBe(true);
  });

  it('group change speedexpression：换 exe + 全新 struct，moveT 不重置', () => {
    resetParseState();
    const p = makeParticle({ id: 1, moveT: 9, exe: parse('1'), exeStruct: new ParticleStruct() });
    const view = makeEngineView([p]);
    const groups = new GroupIndex();
    groups.add('g1', 1);
    const sink = makeSink(new FakeRand());
    sink.groups = groups;
    execGroupChange(
      makeGroupCmd("particleex group change speedexpression g1 'vy=t*0.1' null") as never,
      sink,
      view,
    );
    expect(p.exe).not.toBeNull();
    expect(p.moveT).toBe(9); // 逐字复刻：不重置
    expect(p.exeStruct).toBeInstanceOf(ParticleStruct);
    expect(p.exeStruct).not.toBe(null);
  });

  it('group change 条件过滤：仅 cexe invoke!=0 的粒子被修改', () => {
    resetParseState();
    const p1 = makeParticle({ id: 1, x: 1, y: 0, z: 0 });
    const p2 = makeParticle({ id: 2, x: -1, y: 0, z: 0 });
    const view = makeEngineView([p1, p2]);
    const groups = new GroupIndex();
    groups.add('g1', 1);
    groups.add('g1', 2);
    const sink = makeSink(new FakeRand());
    sink.groups = groups;
    execGroupChange(
      makeGroupCmd("particleex group change parameter g1 'x=99' 'x>0'") as never,
      sink,
      view,
    );
    expect(p1.x).toBe(99); // 选中
    expect(p2.x).toBe(-1); // 条件为 0 → 跳过
  });

  it('do-while 死粒子 + cexe==null → NPE（Java 崩溃，预览同文案终止）', () => {
    resetParseState();
    // 组内 [死粒子, 活粒子]：do 体对死粒子 continue → 跳到 cexe.invoke() → cexe null
    const dead = makeParticle({ id: 1, alive: false });
    const alive = makeParticle({ id: 2, alive: true });
    const view = makeEngineView([dead, alive]);
    const groups = new GroupIndex();
    groups.add('g1', 1);
    groups.add('g1', 2);
    const sink = makeSink(new FakeRand());
    sink.groups = groups;
    expect(() =>
      execGroupChange(
        makeGroupCmd('particleex group change parameter g1 x=1 null') as never,
        sink,
        view,
      ),
    ).toThrow('java.lang.NullPointerException: Cannot invoke "com.noone.particleex.util.IExecutable.invoke()" because "cexe" is null');
    // 命令在死粒子处终止 → 活粒子未被修改
    expect(alive.x).toBe(0);
  });

  it('do-while 死粒子 + cexe!=null：残留 data 判定 —— 0 → 取下一个；1 → 选中死粒子（无可见效果，继续取活粒子）', () => {
    // 死粒子：do 体 continue → 跳到 while 条件 cexe.run(残留 data)；
    // 残留 data 初值全 0 → 'x>0' 判 0 → 取下一个（活粒子 x=1 → 判 1 → 选中修改）
    const dead0 = makeParticle({ id: 1, alive: false });
    const alive0 = makeParticle({ id: 2, alive: true, x: 1 });
    const view0 = makeEngineView([dead0, alive0]);
    const groups0 = new GroupIndex();
    groups0.add('g1', 1);
    groups0.add('g1', 2);
    const sink0 = makeSink(new FakeRand());
    sink0.groups = groups0;
    execGroupChange(
      makeGroupCmd("particleex group change parameter g1 'x=99' 'x>0'") as never,
      sink0,
      view0,
    );
    expect(alive0.x).toBe(99); // 死粒子被跳过（残留 data 判 0），命令继续

    // cexe 恒 1：死粒子被选中 → switch 对死粒子应用（无可见效果）→ 外层继续取活粒子
    const dead1 = makeParticle({ id: 1, alive: false });
    const alive1 = makeParticle({ id: 2, alive: true });
    const view1 = makeEngineView([dead1, alive1]);
    const groups1 = new GroupIndex();
    groups1.add('g1', 1);
    groups1.add('g1', 2);
    const sink1 = makeSink(new FakeRand());
    sink1.groups = groups1;
    execGroupChange(
      makeGroupCmd("particleex group change parameter g1 'x=77' '1'") as never,
      sink1,
      view1,
    );
    expect(alive1.x).toBe(77); // 死粒子选中后无副作用，活粒子照常处理

    // 活粒子在死粒子前（无死粒子干扰的对照）：cexe 用活粒子的真实相对坐标判定
    const aliveA = makeParticle({ id: 1, alive: true, x: 1 });
    const deadD = makeParticle({ id: 2, alive: false, x: 5 });
    const view2 = makeEngineView([aliveA, deadD]);
    const groups2 = new GroupIndex();
    groups2.add('g1', 1);
    groups2.add('g1', 2);
    const sink2 = makeSink(new FakeRand());
    sink2.groups = groups2;
    execGroupChange(
      makeGroupCmd("particleex group change parameter g1 'x=55' 'x>0'") as never,
      sink2,
      view2,
    );
    expect(aliveA.x).toBe(55); // 活粒子 x=1>0 → 选中并修改
    expect(deadD.alive).toBe(false);
  });
});

// ---------- 步长守卫（预览运行时防护）----------

describe('spawn：步长守卫（t+step===t 定点中止，非 1:1 后果）', () => {
  it('execParameter：begin=1e16 step=1（浮点粒度下不前进）→ 精确中止文案', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand('particleex parameter flame 0 0 0 1 1 1 1 0 0 0 1e16 1e16 "x,y,z=0,0,0" 1') as ParameterCmd;
    expect(() => execParameter(cmd, sink)).toThrow('浮点步长不收敛（t+step===t）：Java 版在此是死循环（命令队列冻结），预览已中止该命令。');
  });

  it('execConditional：大 range + 小 step 的定点形态 → 中止（不冻结浏览器）', () => {
    resetParseState();
    const sink = makeSink(new FakeRand());
    const cmd = parseCommand('particleex conditional flame 0 0 0 1 1 1 1 0 0 0 1e16 0.5 0 "1" 1 1') as ConditionalCmd;
    expect(() => execConditional(cmd, sink)).toThrow('浮点步长不收敛');
  });

  it('runGeneratorStep：大 end + step 1 → 中止', () => {
    resetParseState();
    const g: TickGenerator = {
      name: 'flame', x: 0, y: 0, z: 0, color: { r: 1, g: 1, b: 1, a: 1 },
      cmdVel: null, begin: 1e16, end: 1e16 + 1000, step: 1, cpt: 10,
      age: 0, speedExpression: null, speedStep: 1, group: null, polar: false,
      exe: parse('1'), struct: new ParticleStruct(), t: 1e16,
    };
    const sink = makeSink(new FakeRand());
    expect(() => runGeneratorStep(g, sink)).toThrow('浮点步长不收敛');
  });
});
