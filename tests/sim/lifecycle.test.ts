// M3 仿真引擎生命周期测试（headless：固定 PRNG + 手动 tickOnce，断言
// 粒子数/位置/颜色）。表达式全部浅层（golden 深嵌套括号挂死约束）。
// 每个用例独立 SimEngine（seed 固定 → normal 高斯可复现）。
//
// 命令语法（M2 schema）：
//   normal <名> <pos×3> <color×4> <vel×3> <range×3> <count> [age] [速度表达式] [step] [组]
//   conditional <名> <pos×3> <color×4> <vel×3> <range×3> <表达式> [step] [age] [速度表达式] [step] [组]
//   parameter <名> <pos×3> [color×4] <vel×3> <begin> <end> <表达式> [step] [age] [速度表达式] [step] [组]

import { describe, expect, it } from 'vitest';
import { parseCommand } from '../../src/command/parser';
import { SimEngine } from '../../src/sim/engine';
import type { SimConfig } from '../../src/sim/types';

function cfg(over: Partial<SimConfig> = {}): SimConfig {
  return {
    playerPos: { x: 0, y: 0, z: 0 },
    defaultLifetime: 20,
    maxParticles: 20000,
    seed: 1,
    ...over,
  };
}
function eng(over: Partial<SimConfig> = {}): SimEngine {
  return new SimEngine(cfg(over));
}
const C = parseCommand;
const snap = (e: SimEngine) => e.snapshot();

// normal 快捷构造：name/pos 可改，默认白点静止
const normal = (
  count: number,
  tail: string,
  over: { name?: string; pos?: string; color?: string; vel?: string; range?: string } = {},
) =>
  `particleex normal ${over.name ?? 'flame'} ${over.pos ?? '0 0 0'} ${over.color ?? '1 1 1 1'} ${over.vel ?? '0 0 0'} ${over.range ?? '0 0 0'} ${count} ${tail}`.trim();

// ---------- 寿命与原生位移 ----------

describe('寿命 / 原生位移', () => {
  it('age 逐 tick 递增，达默认寿命 20 死亡', () => {
    const e = eng();
    e.runCommand(C(normal(1, '0')));
    e.tickOnce();
    expect(snap(e)[0].age).toBe(1);
    for (let i = 1; i < 19; i++) e.tickOnce();
    expect(snap(e)[0].age).toBe(19);
    e.tickOnce(); // age=20 → 死亡
    expect(e.aliveCount).toBe(0);
  });

  it('age>0 显式寿命：指定 tick 后死亡', () => {
    const e = eng();
    e.runCommand(C(normal(1, '5')));
    for (let i = 0; i < 5; i++) e.tickOnce();
    expect(e.aliveCount).toBe(0);
  });

  it('age=-1 永久（不自然死亡）', () => {
    const e = eng();
    e.runCommand(C(normal(1, '-1')));
    for (let i = 0; i < 100; i++) e.tickOnce();
    expect(e.aliveCount).toBe(1);
    expect(snap(e)[0].age).toBe(100);
  });

  it('非零原生速度：逐 tick 直线位移（无衰减）', () => {
    const e = eng();
    e.runCommand(C(normal(1, '10', { vel: '0 1 0' })));
    e.tickOnce();
    expect(snap(e)[0].y).toBeCloseTo(1, 10);
    e.tickOnce();
    expect(snap(e)[0].y).toBeCloseTo(2, 10);
  });

  it('速度全 0 → stop=true：位置恒定', () => {
    const e = eng();
    e.runCommand(C(normal(1, '10', { pos: '3 2 1' })));
    e.tickOnce();
    e.tickOnce();
    const p = snap(e)[0];
    expect([p.x, p.y, p.z]).toEqual([3, 2, 1]);
    expect(p.stop).toBe(true);
  });
});

// ---------- 速度表达式（customMove）----------

describe('速度表达式（customMove）', () => {
  it('仅设 vy：竖直匀速', () => {
    const e = eng();
    e.runCommand(C(normal(1, '-1 "vy=0.5"')));
    e.tickOnce();
    expect(snap(e)[0].y).toBeCloseTo(0.5, 10);
    e.tickOnce();
    expect(snap(e)[0].y).toBeCloseTo(1.0, 10);
  });

  it('速度表达式 + 非零原生速度：该 tick 只走表达式速度（回滚原生位移）', () => {
    const e = eng();
    e.runCommand(C(normal(1, '-1 "vy=0.1" 1', { vel: '0 1 0' })));
    e.tickOnce();
    expect(snap(e)[0].y).toBeCloseTo(0.1, 10);
    e.tickOnce();
    expect(snap(e)[0].y).toBeCloseTo(0.2, 10);
  });

  it('t 按 speedStep 逐 tick 递增（默认 1.0）', () => {
    const e = eng();
    e.runCommand(C(normal(1, '-1 "vy=t" 0.5')));
    e.tickOnce(); // t=0 → 位移 0
    expect(snap(e)[0].y).toBeCloseTo(0, 10);
    e.tickOnce(); // t=0.5
    expect(snap(e)[0].y).toBeCloseTo(0.5, 10);
    e.tickOnce(); // t=1.0
    expect(snap(e)[0].y).toBeCloseTo(1.5, 10);
  });

  it('绕中心旋转示例：vx,vz=-z*0.1,x*0.1（出生偏移 (2,0,0)、中心 (0,0,0) → 首帧向 +z 0.2）', () => {
    const e = eng();
    // normal 的中心=命令位置 → 相对坐标为 0；改用 parameter 摆出偏移 (2,0,0)、中心 (0,0,0)
    e.runCommand(C('particleex parameter flame 0 0 0 1 1 1 1 0 0 0 0 0 "x,y,z=2,0,0" 0.1 -1 "vx,vz=-z*0.1,x*0.1"'));
    e.tickOnce();
    const p = snap(e)[0];
    expect(p.x).toBeCloseTo(2, 10);
    expect(p.z).toBeCloseTo(0.2, 10);
  });

  it('颜色表达式：cr 随 t 变，未设的 cg/cb 保持原色', () => {
    const e = eng();
    e.runCommand(C(normal(1, '-1 "cr=t*0.5"', { color: '1 0 0 1' })));
    e.tickOnce(); // t=0 → cr=0
    let p = snap(e)[0];
    expect(p.r).toBeCloseTo(0, 10);
    expect(p.g).toBeCloseTo(0, 10);
    e.tickOnce(); // t=1 → cr=0.5
    p = snap(e)[0];
    expect(p.r).toBeCloseTo(0.5, 10);
    expect(p.b).toBeCloseTo(0, 10);
  });

  it('destroy=1 立即死亡', () => {
    const e = eng();
    e.runCommand(C(normal(1, '-1 "destroy=1"')));
    e.tickOnce();
    expect(e.aliveCount).toBe(0);
  });

  it('速度路径 age 恒 0（模组缺陷复刻）：destroy=age>1 永不触发', () => {
    const e = eng();
    e.runCommand(C(normal(1, '-1 "destroy=age>1"')));
    for (let i = 0; i < 5; i++) e.tickOnce();
    expect(e.aliveCount).toBe(1);
    expect(snap(e)[0].age).toBe(5); // 真实 age 递增，表达式看到的恒 0
  });

  it('运行期错误（/ by zero）：该粒子死亡，错误入 tickErrors', () => {
    const e = eng();
    // 局部 int 变量做除数（非常量）→ 解析期不折叠，运行期才抛
    const r = e.runCommand(C(normal(1, '-1 "a=1;destroy=1/(a-a)"')));
    expect(r.spawned).toBe(1);
    e.tickOnce();
    expect(e.aliveCount).toBe(0);
    expect(e.tickErrors[0]).toMatch('ArithmeticException: / by zero');
  });

  it('解析期错误（字段赋值里裸 1/0）：parse 即抛 → 粒子不生成、错误入 result.errors', () => {
    const e = eng();
    const r = e.runCommand(C(normal(1, '-1 "vy=1/0"')));
    // Java：字段赋值 RHS 为裸表达式序列 → 解析期 "need matrix..."（Probe34 对拍确认）
    expect(r.spawned).toBe(0);
    expect(e.aliveCount).toBe(0);
    expect(r.errors[0]).toMatch('need matrix, function call, assign expression, var, number');
  });

  it('只设部分速度分量：NaN 分量视为 0（vy=0.1 只竖直走）', () => {
    const e = eng();
    e.runCommand(C(normal(1, '-1 "vy=0.1"')));
    e.tickOnce();
    const p = snap(e)[0];
    expect(p.x).toBe(0);
    expect(p.y).toBeCloseTo(0.1, 10);
    expect(p.z).toBe(0);
  });

  it('多个同表达式粒子各自独立（exeStruct 每粒子一份）', () => {
    const e = eng();
    e.runCommand(C(normal(2, '-1 "vy=t"', { range: '1 0 0' })));
    for (let i = 0; i < 3; i++) e.tickOnce();
    // 两者 t 序列相同 → y 相同，x 不同（出生偏移不同）
    const [a, b] = snap(e);
    expect(a.y).toBe(b.y);
    expect(a.x).not.toBe(b.x);
  });
});

// ---------- 生成算法 ----------

describe('生成算法', () => {
  it('normal：count 个粒子 + 高斯偏移（seed 固定可复现）', () => {
    const e1 = eng({ seed: 42 });
    e1.runCommand(C(normal(5, '0', { range: '1 1 0' })));
    const e2 = eng({ seed: 42 });
    e2.runCommand(C(normal(5, '0', { range: '1 1 0' })));
    expect(e1.aliveCount).toBe(5);
    const a = e1.snapshot().map((p) => [p.x, p.y, p.z]);
    const b = e2.snapshot().map((p) => [p.x, p.y, p.z]);
    expect(a).toEqual(b);
    // 范围 dz=0 → z 全 0；x 分散
    expect(a.every(([, , z]) => z === 0)).toBe(true);
    expect(new Set(a.map(([x]) => x)).size).toBeGreaterThan(1);
  });

  it('PRNG 共享：第二条 normal 命令接着消费序列', () => {
    const e = eng({ seed: 42 });
    e.runCommand(C(normal(3, '0', { range: '1 0 0', pos: '0 0 0' })));
    e.runCommand(C(normal(2, '0', { range: '1 0 0', pos: '5 0 0' })));
    const e2 = eng({ seed: 42 });
    e2.runCommand(C(normal(5, '0', { range: '1 0 0', pos: '0 0 0' })));
    // 等价于一个 5 粒子的序列切两段：前 3 个偏移严格相等；后 2 个相等（+5 抵消留 1 ulp 余量）
    const seg1 = e.snapshot().slice(0, 3).map((p) => p.x);
    const seg2 = e.snapshot().slice(3).map((p) => p.x - 5);
    const whole = e2.snapshot().map((p) => p.x);
    expect(seg1).toEqual(whole.slice(0, 3));
    expect(seg2[0]).toBeCloseTo(whole[3], 12);
    expect(seg2[1]).toBeCloseTo(whole[4], 12);
  });

  it('conditional：三重扫描含两端 + 表达式过滤', () => {
    const e = eng();
    // 范围 x=0.5 step=0.5 → cx ∈ {-0.5, 0, 0.5}；y/z 范围 0 → 单值 0
    const cond = (expr: string) =>
      `particleex conditional flame 10 0 0 1 1 1 1 0 0 0 0.5 0 0 ${expr} 0.5`;
    e.runCommand(C(cond('"x>0"')));
    expect(e.aliveCount).toBe(1);
    expect(snap(e)[0].x).toBeCloseTo(10.5, 10);
  });

  it('conditional 表达式 "null"：无条件生成全部采样点', () => {
    const e = eng();
    e.runCommand(C('particleex conditional flame 0 0 0 1 1 1 1 0 0 0 0.5 0 0 "null" 0.5'));
    expect(e.aliveCount).toBe(3); // -0.5, 0, 0.5
  });

  it('conditional 的 s1/s2/dis 球坐标填充：x=dis·cos(s2)·cos(s1) 成立', () => {
    const e = eng();
    // 范围 x=1,y=1,z=1 step=1 → 3³=27 网格点；dis>1.5 留下 8 个 (±1,±1,±1) 角
    e.runCommand(C('particleex conditional flame 0 0 0 1 1 1 1 0 0 0 1 1 1 "dis>1.5" 1'));
    const ps = snap(e);
    expect(ps.length).toBe(8);
    expect(ps.every((p) => Math.abs(p.x) === 1 && Math.abs(p.y) === 1 && Math.abs(p.z) === 1)).toBe(true);
  });

  it('parameter 非 tick：t 从 begin 到 end 步长 step，中心=命令位置', () => {
    const e = eng();
    // parameter <名> <pos> <color> <vel> begin end 表达式 [step] [age]
    e.runCommand(C('particleex parameter flame 1 2 3 1 1 1 1 0 0 0 0 3 "x,y,z=t,0,0" 1 100'));
    expect(e.aliveCount).toBe(4); // t = 0,1,2,3
    const xs = snap(e).map((p) => p.x).sort((a, b) => a - b);
    expect(xs).toEqual([1, 2, 3, 4]);
    expect(snap(e).every((p) => p.cx === 1 && p.cy === 2 && p.cz === 3)).toBe(true);
  });

  it('polarparameter：极坐标转换', () => {
    const e = eng();
    e.runCommand(C('particleex polarparameter flame 5 5 5 1 1 1 1 0 0 0 0 1 "s1,s2,dis=0,0,1" 0.5 100'));
    expect(e.aliveCount).toBe(3); // t=0,0.5,1
    expect(snap(e).every((p) => p.x === 6 && p.y === 5 && p.z === 5)).toBe(true);
  });

  it('游戏内单引号 polarparameter（用户报告 MC 26.2 可运行）：环形 + 圆周速度', () => {
    const e = eng();
    e.runCommand(C("/particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 -10 10 'dis=1;s1=2*t;s2=0' 0.1 20 'i=0.1;(vx,vy,vz)=((i)*cos(s1),0,(i)*sin(s1))' 1 null"));
    // t = -10..10 step 0.1（含端点；浮点步进与 Java for 循环一致 → 201 个）
    expect(e.aliveCount).toBe(201);
    // 极坐标 s1=2t,s2=0,dis=1 → (cos2t, 0, sin2t)，中心 = 玩家 + (0,2,0)
    for (const p of snap(e)) {
      expect(Math.hypot(p.x - 0, p.z - 0)).toBeCloseTo(1, 9);
      expect(p.y).toBeCloseTo(2, 9);
    }
    // 圆周运动：速度 (i·cos s1, 0, i·sin s1) 中 s1 = 当前相对中心的极角 →
    // 速度方向恒为**径向外**（unit(x,z) 方向），每 tick 半径 +0.1
    e.tickOnce();
    for (const p of snap(e)) {
      expect(p.y).toBeCloseTo(2, 9);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(1.1, 9);
    }
    // age=20 显式寿命：20 tick 后全部死亡
    for (let i = 1; i < 20; i++) e.tickOnce();
    expect(e.aliveCount).toBe(0);
  });

  it('rgbaparameter：颜色来自表达式 cr/cg/cb（无颜色参数）', () => {
    const e = eng();
    // <名> <pos> <vel> begin end 表达式 [step] [age]
    e.runCommand(C('particleex rgbaparameter flame 0 0 0 0 0.1 0 0 5 "x,y,z,cr,cg,cb=t,0,0,1,0.5,0.25" 1 100'));
    const p = snap(e)[0];
    expect(p.r).toBeCloseTo(1, 10);
    expect(p.g).toBeCloseTo(0.5, 10);
    expect(p.b).toBeCloseTo(0.25, 10);
    expect(p.x).toBe(0);
  });

  it('rgbatickparameter：初始速度来自表达式 data.vx/vy/vz', () => {
    const e = eng();
    // <名> <pos> <vel> begin end 表达式 step cpt age
    e.runCommand(C('particleex rgbatickparameter flame 0 0 0 0 0.1 0 0 5 "x,y,z,vx,vy,vz=t,0,0,0.1,0,0" 1 1 100'));
    // t=0 生成 x=0，vx=0.1 → 一 tick 后 x=0.1，y 不变
    e.tickOnce();
    expect(snap(e).some((p) => Math.abs(p.x) === 0.1 && p.y === 0 && p.z === 0)).toBe(true);
  });

  it('tickparameter：每 tick cpt 个，t 跨 tick 递增', () => {
    const e = eng();
    e.runCommand(C('particleex tickparameter flame 0 0 0 1 1 1 1 0 0 0 0 3 "x,y,z=t,0,0" 1 2 100'));
    expect(e.aliveCount).toBe(2); // 立即 run：t=0,1
    expect(snap(e).map((p) => p.x).sort((a, b) => a - b)).toEqual([0, 1]);
    e.tickOnce(); // t=2,3
    expect(e.aliveCount).toBe(4);
    expect(snap(e).map((p) => p.x).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    e.tickOnce(); // t=4 > end → 不再生成
    expect(e.aliveCount).toBe(4);
  });

  it('tickparameter cpt > 剩余步数：本 tick 只生成剩余量', () => {
    const e = eng();
    e.runCommand(C('particleex tickparameter flame 0 0 0 1 1 1 1 0 0 0 0 1 "x,y,z=t,0,0" 1 5 100'));
    expect(e.aliveCount).toBe(2); // t=0,1 后 t=2>1 停
    e.tickOnce();
    expect(e.aliveCount).toBe(2);
  });
});

// ---------- 组操作 ----------

describe('组操作', () => {
  it('group remove 无表达式：全删 + 清组', () => {
    const e = eng();
    e.runCommand(C(normal(3, '100 "null" 1 g1')));
    expect(e.aliveCount).toBe(3);
    e.runCommand(C('particleex group remove g1'));
    expect(e.aliveCount).toBe(0);
    expect(e.groups.get('g1')).toEqual([]);
  });

  it('group remove 带表达式：age 在此路径有值', () => {
    const e = eng();
    e.runCommand(C(normal(4, '100 "null" 1 g1')));
    e.tickOnce(); // age=1
    e.tickOnce(); // age=2
    e.runCommand(C('particleex group remove g1 "age>=2" 0 0 0'));
    expect(e.aliveCount).toBe(0); // 同批同 age=2 → 全删
    e.runCommand(C(normal(1, '100 "null" 1 g1')));
    // 新粒子 age=0
    e.runCommand(C('particleex group remove g1 "age>=1" 0 0 0'));
    expect(e.aliveCount).toBe(1); // age=0 不删
  });

  it('group remove 表达式 false：不删（组保留）', () => {
    const e = eng();
    e.runCommand(C(normal(3, '100 "null" 1 g1')));
    e.tickOnce();
    e.runCommand(C('particleex group remove g1 "age>=10" 0 0 0'));
    expect(e.aliveCount).toBe(3);
    expect(e.groups.get('g1').length).toBe(3);
  });

  it('group 名 | 分隔：加入多组，remove 任一可删', () => {
    const e = eng();
    e.runCommand(C(normal(2, '100 "null" 1 a|b')));
    expect(e.groups.get('a').length).toBe(2);
    expect(e.groups.get('b').length).toBe(2);
    // Java GroupUtil.get("a|b")：两组列表都 addAll → 同一粒子出现两次（忠实复刻）
    expect(e.groups.get('a|b').length).toBe(4);
    e.runCommand(C('particleex group remove b'));
    expect(e.aliveCount).toBe(0);
  });

  it('group change parameter：改位置/颜色/速度', () => {
    const e = eng();
    e.runCommand(C(normal(1, '100 "null" 1 g')));
    e.tickOnce();
    e.runCommand(C('particleex group change parameter g "x=5;cr=1;cg=0;cb=0;vx=0.2" "null" 0 0 0'));
    const p = snap(e)[0];
    expect(p.x).toBeCloseTo(5, 10); // ref(0,0,0) + data.x=5
    expect([p.r, p.g, p.b]).toEqual([1, 0, 0]);
    expect(p.vx).toBeCloseTo(0.2, 10);
    expect(p.stop).toBe(false);
    e.tickOnce();
    expect(snap(e)[0].x).toBeCloseTo(5.2, 10);
  });

  it('group change parameter 只改速度：位置不变（data.x 保持相对坐标）', () => {
    const e = eng();
    e.runCommand(C(normal(1, '100 "null" 1 g', { vel: '0.5 0 0' })));
    e.tickOnce();
    e.runCommand(C('particleex group change parameter g "vx=0" "null" 0 0 0'));
    const p = snap(e)[0];
    expect(p.stop).toBe(true); // 全 0 → stop
    expect(p.x).toBeCloseTo(0.5, 10); // 未设 x → 位置不变
    expect(p.y).toBeCloseTo(0, 10);
  });

  it('group change parameter 表达式改中心 cx：后续 dx/dy 相对新中心', () => {
    const e = eng();
    e.runCommand(C(normal(1, '100 "null" 1 g', { pos: '4 0 0' })));
    e.tickOnce();
    e.runCommand(C('particleex group change parameter g "cx=0" "null" 0 0 0'));
    expect(snap(e)[0].cx).toBe(0);
  });

  it('group change speedexpression：换运动表达式（moveT 不重置，逐字复刻）', () => {
    const e = eng();
    e.runCommand(C(normal(1, '100 "vy=t" 1 g')));
    e.tickOnce(); // t=0 → y=0
    e.tickOnce(); // t=1 → y=1
    expect(snap(e)[0].y).toBeCloseTo(1, 10);
    e.runCommand(C('particleex group change speedexpression g "vy=0.1"'));
    e.tickOnce();
    expect(snap(e)[0].y).toBeCloseTo(1.1, 10); // 恒 0.1（moveT=2 不影响该式）
  });

  it('group change 带条件表达式：仅命中者修改', () => {
    const e = eng();
    e.runCommand(C(normal(1, '100 "null" 1 g', { pos: '1 0 0' })));
    e.runCommand(C(normal(1, '100 "null" 1 g', { pos: '-1 0 0' })));
    e.runCommand(C('particleex group change parameter g "cr=0;cg=1;cb=0" "x>0" 0 0 0'));
    const ps = snap(e);
    const plus = ps.find((p) => p.x === 1)!;
    const minus = ps.find((p) => p.x === -1)!;
    expect([plus.r, plus.g, plus.b]).toEqual([0, 1, 0]);
    expect([minus.r, minus.g, minus.b]).toEqual([1, 1, 1]);
  });

  it('group change 条件为 "null"：无条件修改全部', () => {
    const e = eng();
    e.runCommand(C(normal(2, '100 "null" 1 g')));
    e.runCommand(C('particleex group change parameter g "cr=0" "null" 0 0 0'));
    expect(snap(e).every((p) => p.r === 0)).toBe(true);
  });

  it('group change do-while 复刻：死粒子 + 无 cexe → NPE（命令中止）', () => {
    const e = eng();
    // 1 个短命粒子入组 g，2 tick 后死（组里滞留死 id —— Java 列表不惰性清理）
    e.runCommand(C(normal(1, '2 "null" 1 g')));
    e.tickOnce();
    e.tickOnce(); // age=2 = lifetime → 死
    expect(e.aliveCount).toBe(0);
    // do 体取到死粒子 → continue → while 条件 cexe.invoke()，cexe==null（"null" 字面量）→ NPE
    expect(() =>
      e.runCommand(C('particleex group change parameter g "cr=0" "null" 0 0 0')),
    ).toThrow(
      'java.lang.NullPointerException: Cannot invoke "com.noone.particleex.util.IExecutable.invoke()" because "cexe" is null',
    );
  });
});

// ---------- clearparticle / 上限 / 错误 ----------

describe('clearparticle / 上限 / 错误', () => {
  it('clearparticle：全删 + 清组', () => {
    const e = eng();
    e.runCommand(C(normal(2, '100 "null" 1 g')));
    e.runCommand(C('particleex clearparticle'));
    expect(e.aliveCount).toBe(0);
    expect(e.groups.get('g')).toEqual([]);
  });

  it('clearparticle 不影响排队的 tick 生成器（忠实复刻）', () => {
    const e = eng();
    e.runCommand(C('particleex tickparameter flame 0 0 0 1 1 1 1 0 0 0 0 3 "x,y,z=t,0,0" 1 2 100'));
    expect(e.aliveCount).toBe(2);
    e.runCommand(C('particleex clearparticle'));
    expect(e.aliveCount).toBe(0);
    e.tickOnce(); // 排队生成器继续：t=2,3
    expect(e.aliveCount).toBe(2);
  });

  it('maxParticles 上限：超出丢弃并计数', () => {
    const e = eng({ maxParticles: 3 });
    const r = e.runCommand(C(normal(5, '100')));
    expect(r.spawned).toBe(3);
    expect(r.dropped).toBe(2);
    expect(e.aliveCount).toBe(3);
  });

  it('速度表达式解析失败：该粒子不生成、错误记入 result.errors', () => {
    const e = eng();
    const r = e.runCommand(C(normal(3, '100 "((("')));
    expect(r.spawned).toBe(0);
    expect(r.errors.length).toBe(3);
    expect(r.errors[0]).toMatch('java.lang.');
  });

  it('速度表达式 "null"：合法（无 exe），不报错', () => {
    const e = eng();
    const r = e.runCommand(C(normal(2, '100 "null"')));
    expect(r.errors).toEqual([]);
    expect(e.aliveCount).toBe(2);
    expect(snap(e)[0].exe).toBeNull();
  });

  it('命令级错误向上抛（parameter 主表达式解析失败）', () => {
    const e = eng();
    expect(() =>
      e.runCommand(C('particleex parameter flame 0 0 0 1 1 1 1 0 0 0 0 1 "x,y,z= 1 100')),
    ).toThrow();
  });

  it('reset：全清 + PRNG 重建（同种子可复现）', () => {
    const e = eng({ seed: 9 });
    e.runCommand(C(normal(3, '100', { range: '1 1 1' })));
    const first = e.snapshot().map((p) => [p.x, p.y, p.z]);
    e.tickOnce();
    e.reset();
    e.runCommand(C(normal(3, '100', { range: '1 1 1' })));
    const second = e.snapshot().map((p) => [p.x, p.y, p.z]);
    expect(second).toEqual(first);
    expect(e.tick).toBe(0);
  });

  it('~ 相对坐标：按玩家位置求值', () => {
    const e = eng({ playerPos: { x: 10, y: 0, z: 0 } });
    e.runCommand(C('particleex normal flame ~ ~ ~ 1 1 1 1 0 0 0 0 0 0 1 100'));
    const p = snap(e)[0];
    expect(p.cx).toBe(10);
    expect(p.x).toBe(10);
  });
});

// ---------- 播放自动停止判据 ----------

describe('hasLiveWork / queuedGenerators（播放自动停止判据）', () => {
  it('空引擎 → 无活工作', () => {
    const e = eng();
    expect(e.queuedGenerators).toBe(0);
    expect(e.hasLiveWork()).toBe(false);
  });

  it('有活粒子 → 有活工作；寿命耗尽后消失', () => {
    const e = eng();
    e.runCommand(C(normal(1, '5')));
    expect(e.hasLiveWork()).toBe(true);
    for (let i = 0; i < 5; i++) e.tickOnce();
    expect(e.hasLiveWork()).toBe(false);
  });

  it('age=-1 粒子 → 始终有活工作（自动停止不触发）', () => {
    const e = eng();
    e.runCommand(C(normal(1, '-1')));
    for (let i = 0; i < 100; i++) e.tickOnce();
    expect(e.hasLiveWork()).toBe(true);
  });

  it('tickparameter 生成器：跑完前一直有活工作，跑完且粒子死尽才消失', () => {
    const e = eng();
    // t=0..3 step1 cpt=2 → 立即 2 个 + 排队 2 个；age=2 短命
    e.runCommand(C('particleex tickparameter flame 0 0 0 1 1 1 1 0 0 0 0 3 "x,y,z=t,0,0" 1 2 2'));
    expect(e.queuedGenerators).toBe(1);
    expect(e.hasLiveWork()).toBe(true);
    e.tickOnce(); // t=2,3 → 生成器耗尽；4 粒子 age=1
    expect(e.queuedGenerators).toBe(0);
    expect(e.hasLiveWork()).toBe(true); // 还有活粒子
    e.tickOnce(); // age=2 → 全死
    expect(e.hasLiveWork()).toBe(false);
  });

  it('生成器排队中即使粒子全死 → 仍有活工作', () => {
    const e = eng();
    // age=-1 之外用 age=0 默认寿命 20；改为短命 age=1：先死一批，生成器继续
    e.runCommand(C('particleex tickparameter flame 0 0 0 1 1 1 1 0 0 0 0 5 "x,y,z=t,0,0" 1 2 1'));
    e.tickOnce(); // 首批死亡 + 生成器继续
    expect(e.queuedGenerators).toBe(1);
    expect(e.hasLiveWork()).toBe(true);
  });
});
