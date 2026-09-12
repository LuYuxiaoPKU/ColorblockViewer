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
import { NATIVE_KINEMATICS } from '../../src/sim/kinematics';
import type { SimConfig } from '../../src/sim/types';

function cfg(over: Partial<SimConfig> = {}): SimConfig {
  return {
    playerPos: { x: 0, y: 0, z: 0 },
    defaultLifetime: 20,
    maxParticles: 20000,
    seed: 1,
    mcVersion: '26.2',
    gridSize: 10,
    gridVisible: true,
    nativeKinematics: false,
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

// ---------- 原版 /particle（MC 26.2 客户端语义）----------

describe('原版 /particle 生成', () => {
  it('仅 name：单粒子在玩家位置、静止、白、默认寿命', () => {
    const e = eng({ playerPos: { x: 1, y: 2, z: 3 } });
    e.runCommand(C('particle flame'));
    expect(e.aliveCount).toBe(1);
    const p = snap(e)[0];
    expect([p.x, p.y, p.z]).toEqual([1, 2, 3]);
    expect([p.cx, p.cy, p.cz]).toEqual([1, 2, 3]);
    expect([p.vx, p.vy, p.vz]).toEqual([0, 0, 0]);
    expect([p.r, p.g, p.b, p.a]).toEqual([1, 1, 1, 1]);
    expect(p.stop).toBe(true);
    // 寿命走 defaultLifetime=20
    for (let i = 0; i < 20; i++) e.tickOnce();
    expect(e.aliveCount).toBe(0);
  });

  it('count=0 显式：单粒子精确位置，速度 = speed×delta（确定值）', () => {
    const e = eng();
    e.runCommand(C('particle flame 10 20 30 0.5 1 0.5 0.5 0'));
    const p = snap(e)[0];
    expect([p.x, p.y, p.z]).toEqual([10, 20, 30]);
    expect(p.vx).toBeCloseTo(0.25, 10);
    expect(p.vy).toBeCloseTo(0.5, 10);
    expect(p.vz).toBeCloseTo(0.25, 10);
    expect(p.stop).toBe(false);
    e.tickOnce();
    const p2 = snap(e)[0];
    expect(p2.x).toBeCloseTo(10.25, 10);
    expect(p2.y).toBeCloseTo(20.5, 10);
    expect(p2.z).toBeCloseTo(30.25, 10);
  });

  it('count>0：每粒子 6 次 nextGaussian（位置偏移 x/y/z + 速度 x/y/z），seed 固定可复现', () => {
    const e1 = eng({ seed: 7 });
    e1.runCommand(C('particle flame 0 0 0 1 0 0 0.1 3'));
    const e2 = eng({ seed: 7 });
    e2.runCommand(C('particle flame 0 0 0 1 0 0 0.1 3'));
    expect(e1.aliveCount).toBe(3);
    const a = e1.snapshot().map((p) => [p.x, p.y, p.z, p.vx, p.vy, p.vz]);
    const b = e2.snapshot().map((p) => [p.x, p.y, p.z, p.vx, p.vy, p.vz]);
    expect(a).toEqual(b);
    // delta=(1,0,0)：只有 x 偏移；speed=0.1：速度分量 |v| 量级 ~0.1
    // 首粒子参考值（SimRandom seed=7 前 6 次 nextGaussian 手工核算）
    expect(a[0][0]).toBeCloseTo(0.8452060657, 8);
    expect(a[0][3]).toBeCloseTo(0.0751859431, 8);
    expect(a.every(([, y, z]) => y === 0 && z === 0)).toBe(true);
  });

  it('pos 支持 ~：按玩家位置求值，中心 = 玩家位置', () => {
    const e = eng({ playerPos: { x: 5, y: 0, z: 0 } });
    e.runCommand(C('particle smoke ~ ~ ~ 0 0 0 0 0'));
    const p = snap(e)[0];
    expect([p.cx, p.cy, p.cz]).toEqual([5, 0, 0]);
    expect([p.x, p.y, p.z]).toEqual([5, 0, 0]);
  });

  it('speed=0：速度全 0 → stop=true 静止（delta 仅偏移位置）', () => {
    const e = eng({ seed: 3 });
    e.runCommand(C('particle flame 0 0 0 1 1 1 0 5'));
    expect(snap(e).every((p) => p.stop)).toBe(true);
  });

  it('PRNG 共享：vanilla 与 normal 共用同一序列（同 seed 顺序执行可复现）', () => {
    const e = eng({ seed: 11 });
    e.runCommand(C('particle flame 0 0 0 1 0 0 0.1 2')); // 消耗 12 次 nextGaussian
    e.runCommand(C(normal(2, '0', { range: '1 0 0' }))); // 接着消耗 2 次
    const e2 = eng({ seed: 11 });
    e2.runCommand(C('particle flame 0 0 0 1 0 0 0.1 2'));
    e2.runCommand(C(normal(2, '0', { range: '1 0 0' })));
    expect(e.snapshot().map((p) => [p.x, p.vx])).toEqual(e2.snapshot().map((p) => [p.x, p.vx]));
  });
});

// ---------- 原版运动学（nativeKinematics，26.2 javap 核对；常量 = f2d 加宽精确值）----------

// f2d 加宽辅助（Java float 字段 → double，与 src/sim/kinematics.ts 表值同口径）
const f = Math.fround;
const FRICTION_END_ROD = f(0.91); // = 0.9100000262260437
const G_END_ROD = 0.04 * f(0.0125); // = 0.0005000000074505806（表内 gravityY = −该值；double 域先乘后减）

describe('原版运动学（end_rod：摩擦 f2d(0.91f)/tick + 重力 −0.04d×f2d(0.0125f)/tick）', () => {
  // pos(0 0 0) color(1 1 1 1) vel(0 1 0) range(0 0 0) count=1 age=<参数>
  const er = (age: string) =>
    `particleex normal minecraft:end_rod 0 0 0 1 1 1 1 0 1 0 0 0 0 1 ${age}`;
  // 池中可能有其他测试遗留的粒子 → 按类型名取本用例的 end_rod
  const rod = (e: SimEngine) => e.snapshot().find((p) => p.name === 'minecraft:end_rod')!;

  it('age=0：寿命 = 60+nextInt(12)（vanillaRand = SimRandom(seed+1)），可复现', () => {
    // JDK21 ProbeInt：seed=2 nextInt(12) 首个值 = 4 → lifetime = 64
    const e1 = eng({ seed: 1, nativeKinematics: true });
    e1.runCommand(C(er('0')));
    expect(snap(e1)[0].lifetime).toBe(64);
    const e2 = eng({ seed: 1, nativeKinematics: true });
    e2.runCommand(C(er('0')));
    expect(snap(e2)[0].lifetime).toBe(snap(e1)[0].lifetime);
  });

  it('age=0 多粒子：逐个消费 vanillaRand（序列确定）', () => {
    const e = eng({ seed: 1, nativeKinematics: true });
    e.runCommand(C('particleex normal minecraft:end_rod 0 0 0 1 1 1 1 0 0 0 0 0 0 3 0'));
    const lt = snap(e).map((p) => p.lifetime);
    expect(lt).toEqual([64, 60, 68]); // seed=2 nextInt(12)×3 → 4 0 8
  });

  it('显式 age>0 优先：nativeKinematics 开启也不套用随机寿命', () => {
    const e = eng({ nativeKinematics: true });
    e.runCommand(C(er('20')));
    expect(rod(e).lifetime).toBe(20);
  });

  it('关闭（默认）：end_rod 也走匀速直线（无摩擦/重力）', () => {
    const e = eng(); // nativeKinematics: false
    e.runCommand(C(er('100')));
    // snapshot 返回活引用（对象同一性）→ 先取数值副本再 tick，否则 p0.y 随 tick 变
    const y0 = rod(e).y;
    e.tickOnce();
    expect(rod(e).y).toBeCloseTo(y0 + 1, 10);
    e.tickOnce();
    expect(rod(e).y).toBeCloseTo(y0 + 2, 10);
  });

  it('开启：每 tick 重力先于位移、摩擦后于位移（Particle.tick 逐字顺序）', () => {
    const e = eng({ nativeKinematics: true });
    e.runCommand(C(er('100')));
    const p0 = rod(e);
    expect(p0.vy).toBeCloseTo(1, 10);
    const y0 = p0.y;
    // tick1：vy = 1 − G → y += vy → vy *= F（G/F = f2d 加宽精确值）
    e.tickOnce();
    let p = rod(e);
    expect(p.y).toBeCloseTo(y0 + (1 - G_END_ROD), 12);
    expect(p.vy).toBeCloseTo((1 - G_END_ROD) * FRICTION_END_ROD, 12);
    // tick2：vy += 重力 → 位移 → 摩擦
    e.tickOnce();
    p = rod(e);
    expect(p.y).toBeCloseTo(y0 + (1 - G_END_ROD) + ((1 - G_END_ROD) * FRICTION_END_ROD - G_END_ROD), 12);
    expect(p.vy).toBeCloseTo(((1 - G_END_ROD) * FRICTION_END_ROD - G_END_ROD) * FRICTION_END_ROD, 12);
  });

  it('速度表达式路径回滚原生位移 → 不受摩擦/重力影响（用户实况命令语义）', () => {
    // 用户真实命令等价：vel 0 0 0（stop=true）+ 表达式 vy=0.05 → 恒定 0.05/tick
    const e = eng({ nativeKinematics: true });
    e.runCommand(C('particleex normal minecraft:end_rod 0 0 0 1 0.95 0.89 1 0 0 0 0 0 0 1 0 "vy=0.05" 1.0'));
    e.tickOnce();
    expect(snap(e)[0].y).toBeCloseTo(0.05, 12);
    e.tickOnce();
    expect(snap(e)[0].y).toBeCloseTo(0.1, 12);
  });

  it('updateConfig 切开关即时生效：从下一 tick 起改变轨迹', () => {
    const e = eng({ nativeKinematics: false });
    e.runCommand(C(er('100')));
    e.tickOnce(); // 匀速：y = 1，vy 仍 1
    e.updateConfig({ nativeKinematics: true });
    e.tickOnce(); // 开开后：vy = 1−G → y += → vy *= F
    const p = snap(e)[0];
    expect(p.y).toBeCloseTo(1 + (1 - G_END_ROD), 12);
    expect(p.vy).toBeCloseTo((1 - G_END_ROD) * FRICTION_END_ROD, 12);
  });
});

describe('原版 /particle 的 end_rod：随机寿命（vanilla=true 路径）', () => {
  it('age=0 + nativeKinematics → lifetime = 60+nextInt(12)（同种子可复现）', () => {
    const e1 = eng({ seed: 1, nativeKinematics: true });
    e1.runCommand(C('particle end_rod 1 2 3'));
    expect(snap(e1)[0].lifetime).toBe(64); // seed+1=2 → nextInt(12)=4
    const e2 = eng({ seed: 1, nativeKinematics: true });
    e2.runCommand(C('particle end_rod 1 2 3'));
    expect(snap(e2)[0].lifetime).toBe(64);
  });

  it('nativeKinematics 关闭 → 走 defaultLifetime（预览近似）', () => {
    const e = eng({ defaultLifetime: 20 });
    e.runCommand(C('particle end_rod 1 2 3'));
    expect(snap(e)[0].lifetime).toBe(20);
    expect(snap(e)[0].vanilla).toBe(true);
  });
});

// ---------- 更多类型原版运动学（26.2 字节码核对；JDK21 ProbeLifetime2/ProbeScan 对拍）----------

describe('原版运动学：26.2 逐类型寿命 golden（age=0，seed=1 → vanillaRand=2）', () => {
  // pos(1 2 3) color(1 1 1 1) vel(0 1 0) range(0 0 0) count=n age=0
  const cmd = (name: string, count: number) =>
    `particleex normal minecraft:${name} 1 2 3 1 1 1 1 0 1 0 0 0 0 ${count} 0`;
  const e = () => eng({ seed: 1, nativeKinematics: true });

  // 序列 = ProbeLifetime2 的 3 连调输出（JDK 21 实测，操作数顺序逐字节码：
  // N/((F·0.8d)+0.2d)；float 族全 2^24 域直方图 ProbeScan 与 JDK 逐桶一致）
  const goldens: [string, number[]][] = [
    ['totem_of_undying', [64, 60, 68]], // 60+I(12)
    ['crit', [5, 7, 4]], // (int)(6.0d/(F·0.8d+0.6d))
    ['heart', [16, 16, 16]],
    ['note', [6, 6, 6]],
    ['snowflake', [22, 38, 19]], // (int)(16.0d/(F·0.8d+0.2d))+2
    ['lava', [20, 36, 17]], // (int)(16.0d/(F·0.8d+0.2d))
    ['rain', [10, 18, 8]],
    ['splash', [10, 18, 8]],
    ['underwater', [20, 36, 17]], // Suspended 16.0d
    ['composter', [25, 46, 21]], // SuspendedTown 20.0d
    ['smoke', [3, 5, 2]], // (int)((8.0d/(F·0.8d+0.2d))·0.3f)
    ['large_smoke', [25, 46, 21]], // ·2.5f
    ['ash', [12, 23, 10]], // (20.0d/(F·0.8d+0.2d))·0.5f
    ['white_ash', [1, 1, 1]],
    ['flame', [14, 22, 12]], // Rising 8.0d +4
    ['soul', [14, 22, 12]],
    ['effect', [10, 18, 8]], // Spell 8.0d
    ['item', [5, 10, 4]], // (int)(4.0f/(0.9f·F+0.1f))
    ['glow', [10, 8, 13]], // 26.2 = (int)(8.0d/(D*0.8d+0.2d))，nextDouble 域（旧 golden 按 1.21.11 nextFloat 域生成，2026-09-10 JDK21 重测）
    // —— 2026-09-10 入表新类型（ProbeNew3 同序列 JDK21 实测；seed=2 前 3 抽取）——
    ['dust', [10, 8, 13]], // DustParticleBase nextDouble 域 + ×scale(=1) + max(·,1)
    ['dust_color_transition', [10, 8, 13]], // 同 Base
    ['cloud', [22, 35, 17]], // PlayerCloud：(int)max(f32(t·2.5f),1.0f)，t=(int)(8.0d/(F·0.8d+0.3d))
    ['sneeze', [22, 35, 17]], // SneezeProvider → PlayerCloud
    ['falling_spore_blossom', [93, 191, 77]], // (int)(64.0f/(fround(F·0.8f)+0.1f)) float 链
    ['trial_spawner_detection', [13, 18, 12]], // max(f2i(fdiv(8.0f,randomBetween(F,0.5f,1.0f))·1.5f),1)
    ['trial_spawner_detection_ominous', [13, 18, 12]],
    ['bubble', [10, 18, 8]], // (int)(8.0d/(F·0.8d+0.2d))（同 div8 族）
    ['bubble_column_up', [50, 92, 43]], // (int)(40.0d/…)
    ['falling_lava', [81, 147, 69]], // (int)(64.0d/…)
    ['falling_nectar', [20, 36, 17]], // (int)(16.0d/…)（同 div16 族）
    ['landing_obsidian_tear', [35, 64, 30]], // (int)(28.0d/…)
    ['firework', [52, 48, 56]], // 48 + I(12)
    ['sculk_charge', [12, 8, 16]], // 8 + I(12)
    ['sculk_charge_pop', [8, 7, 9]], // I(4) + 6
    ['scrape', [38, 22, 30]], // I(30) + 10
    ['electric_spark', [3, 2, 3]], // I(2) + 2
    ['explosion', [8, 7, 9]], // I(4) + 6
    ['gust', [14, 13, 15]], // I(4) + 12
    ['flash', [4, 4, 4]], // 常量
    ['sonic_boom', [16, 16, 16]], // 常量
    ['pause_mob_growth', [8, 8, 8]], // SimpleVertical 常量
    ['reset_mob_growth', [8, 8, 8]],
    ['shriek', [30, 30, 30]],
    ['squid_ink', [7, 13, 6]], // (int)((12.0f·0.5f)/(0.8f·F+0.2f))
    ['portal', [47, 42, 49]], // 40+(int)(10f·F)
    ['reverse_portal', [61, 60, 61]], // 60+(int)(2.0f·F)：F≥0.5→61
    ['campfire_signal_smoke', [88, 120, 119]], // 80+I(50)；交错流：寿命/初速 float 交替消费
    ['campfire_cosy_smoke', [288, 320, 319]], // 280+I(50)；同上
    // —— 2026-09-12 第二轮入表（ProbeAsh 同序列 JDK21 实测；end_rod 先例无 preConsume）——
    ['noxious_gas', [20, 27, 18]], // gas 公式 (int)(6.0d/(F·0.5d+0.5d)·f2d(3.0f))（Provider gravityFloat=3.0f 常量）
    ['falling_dust', [36, 65, 30]], // (int)max(f32(f32((int)(32.0d/(F·0.8d+0.2d)))·0.9f),1.0f)
    // —— 2026-09-12 第四轮入表（ProbeFly 同序列 JDK21 实测）——
    ['ominous_spawning', [28, 26, 29]], // FlyStraightTowards：25 + f2i(F·5.0f)
    ['enchant', [37, 32, 39]], // FlyTowardsPosition：30 + f2i(F·10.0f)
    ['nautilus', [37, 32, 39]],
    ['vault_connection', [37, 32, 39]],
    ['block', [5, 10, 4]], // TerrainParticle → Particle 3 参基类公式 (int)(4.0f/(0.9f·F+0.1f))（与 item 同链）
    ['block_crumble', [5, 10, 4]],
  ];
  for (const [name, seq] of goldens) {
    it(`${name}：寿命序列 = JDK21 golden`, () => {
      const en = e();
      en.runCommand(C(cmd(name, 3)));
      expect(snap(en).map((p) => p.lifetime)).toEqual(seq);
    });
  }
});

describe('原版运动学：26.2 逐类型运动常量（tick 后断言）', () => {
  // 期望值按 26.2 javap 管道从 float 常量推导（f2d 加宽），不复制表内字面量：
  //   friction 表值 = fround(构造器 putfield 的 float 常量)；
  //   base 管道 gravityY 表值 = −0.04d×fround(gravity)（double 域先乘后减）；
  //   自管 tick gravityY 表值 = −fround(gravity)（rain/splash/campfire 直接减）。
  const f = Math.fround;
  const fr = (d: number) => f(d);
  const gBase = (g: number) => -0.04 * f(g);
  const eng1 = (name: string, vel = '0 1 0') => {
    const en = eng({ seed: 1, nativeKinematics: true });
    en.runCommand(C(`particleex normal minecraft:${name} 0 0 0 1 1 1 1 ${vel} 0 0 0 1 0`));
    return en;
  };

  it('totem：摩擦 0.6f + 重力 −0.05（tick 后 vy = (1−0.05)×f2d(0.6f)）', () => {
    const en = eng1('totem_of_undying');
    en.tickOnce();
    const p = snap(en)[0];
    expect(p.y).toBeCloseTo(0.95, 12); // −0.04d×fround(1.25f) 恰精确 = −0.05
    expect(p.vy).toBeCloseTo(0.95 * fr(0.6), 12);
  });

  it('heart：摩擦 0.86f、无重力', () => {
    const en = eng1('heart');
    en.tickOnce();
    const p = snap(en)[0];
    expect(p.y).toBeCloseTo(1, 12);
    expect(p.vy).toBeCloseTo(fr(0.86), 12);
  });

  it('note：摩擦 0.66f、无重力', () => {
    const en = eng1('note');
    en.tickOnce();
    expect(snap(en)[0].vy).toBeCloseTo(fr(0.66), 12);
  });

  it('snowflake：摩擦 1.0 + 重力 −0.04d×fround(0.225f)，之后逐轴附加 0.95/0.9/0.95', () => {
    const en = eng({ seed: 1, nativeKinematics: true });
    en.runCommand(C('particleex normal minecraft:snowflake 0 0 0 1 1 1 1 1 1 0 0 0 0 1 0'));
    en.tickOnce();
    const p = snap(en)[0];
    expect(p.vy).toBeCloseTo((1 + gBase(0.225)) * 1.0 * 0.8999999761581421, 12);
    expect(p.vx).toBeCloseTo(1 * 1.0 * 0.949999988079071, 12);
    expect(p.x).toBeCloseTo(1, 12); // 位移在阻尼之前
  });

  it('spell(effect)：摩擦 0.96f + 反重力 −0.04d×fround(−0.1f)（升）', () => {
    const en = eng1('effect');
    en.tickOnce();
    const p = snap(en)[0];
    expect(p.y).toBeCloseTo(1 + gBase(-0.1), 12);
    expect(p.vy).toBeCloseTo((1 + gBase(-0.1)) * fr(0.96), 12);
  });

  it('ash：摩擦 0.96f + 重力 −0.04d×fround(0.1f)（降）', () => {
    const en = eng1('ash');
    en.tickOnce();
    expect(snap(en)[0].y).toBeCloseTo(1 + gBase(0.1), 12);
  });

  it('lava：摩擦 0.999f + 重力 −0.03', () => {
    const en = eng1('lava');
    en.tickOnce();
    const p = snap(en)[0];
    expect(p.y).toBeCloseTo(0.97, 12); // −0.04d×fround(0.75f) 恰精确
    expect(p.vy).toBeCloseTo(0.97 * fr(0.999), 12);
  });

  it('rain：直接重力 −fround(0.06f)（无 0.04 系数）+ 摩擦 0.98f', () => {
    const en = eng1('rain');
    en.tickOnce();
    const p = snap(en)[0];
    expect(p.y).toBeCloseTo(1 - f(0.06), 12);
    expect(p.vy).toBeCloseTo((1 - f(0.06)) * fr(0.98), 12);
  });

  it('splash：直接重力 −fround(0.04f) + 摩擦 0.98f', () => {
    const en = eng1('splash');
    en.tickOnce();
    expect(snap(en)[0].y).toBeCloseTo(1 - f(0.04), 12);
  });

  it('suspended 系：匀速（摩擦 1.0、无重力）', () => {
    const en = eng1('underwater');
    en.tickOnce();
    expect(snap(en)[0].y).toBeCloseTo(1, 12);
    en.tickOnce();
    expect(snap(en)[0].y).toBeCloseTo(2, 12);
  });

  it('suspended_town 系：自管 tick，摩擦 0.99d（字节码 double 常量，非 f2d）、无重力', () => {
    const en = eng1('composter');
    en.tickOnce();
    expect(snap(en)[0].y).toBeCloseTo(1, 12);
    expect(snap(en)[0].vy).toBeCloseTo(0.99, 12);
  });

  it('item：Base 默认摩擦 0.98f + 重力 −0.04', () => {
    const en = eng1('item');
    en.tickOnce();
    const p = snap(en)[0];
    expect(p.y).toBeCloseTo(0.96, 12); // −0.04d×fround(1.0f) 恰精确
    expect(p.vy).toBeCloseTo(0.96 * fr(0.98), 12);
  });

  it('squid_ink：摩擦 0.92f、无重力', () => {
    const en = eng1('squid_ink');
    en.tickOnce();
    expect(snap(en)[0].vy).toBeCloseTo(fr(0.92), 12);
  });

  it('flame(soul)：摩擦 0.96f、无重力', () => {
    const en = eng1('flame');
    en.tickOnce();
    expect(snap(en)[0].vy).toBeCloseTo(fr(0.96), 12);
  });

  it('portal：位置绝对式 cubic easing（age=10 的 e 与 y 的 (1−t) 项）', () => {
    const en = eng({ seed: 1, nativeKinematics: true });
    en.runCommand(C('particleex normal minecraft:portal 0 0 0 1 1 1 1 0 1 0 0 0 0 1 40'));
    en.tickOnce(); // age=1, t=1/40
    const p = snap(en)[0];
    const t = Math.fround(1 / 40);
    const e = Math.fround(1 - Math.fround(Math.fround(t * t) * 2 - t));
    expect(p.y).toBeCloseTo(1 * e + Math.fround(1 - t), 12);
    for (let i = 0; i < 9; i++) en.tickOnce(); // age=10, t=1/4
    const p10 = snap(en)[0];
    const t4 = Math.fround(10 / 40);
    const e4 = Math.fround(1 - Math.fround(Math.fround(t4 * t4) * 2 - t4));
    expect(p10.y).toBeCloseTo(e4 + Math.fround(1 - t4), 12);
    expect(p10.x).toBe(0); // vx=0
  });

  it('reverse_portal：增量式 x += v·t（age=10：Σ t_i 累加）', () => {
    const en = eng({ seed: 1, nativeKinematics: true });
    en.runCommand(C('particleex normal minecraft:reverse_portal 0 0 0 1 1 1 1 1 0 0 0 0 0 1 0'));
    const life = snap(en)[0].lifetime; // 60+(int)(2.0f·F)：60/61 各半，按实际寿命累加
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += Math.fround((i + 1) / life);
      en.tickOnce();
    }
    expect(snap(en)[0].x).toBeCloseTo(sum, 12);
  });

  it('campfire：出生初速 vy += 500.0f/F（float 除法；F = 寿命 I(50) 后的下一个 nextFloat）', () => {
    const en = eng({ seed: 1, nativeKinematics: true });
    en.runCommand(C('particleex normal minecraft:campfire_cosy_smoke 0 0 0 1 1 1 1 0 1 0 0 0 0 1 0'));
    const p = snap(en)[0];
    // seed=2 交错流（ProbeCampfire 实测）：I(50)=8 → F=4922041/2^24
    expect(p.lifetime).toBe(288);
    const rise = Math.fround(500 / (4922041 / 16777216));
    expect(p.vy).toBe(1 + rise);
    // 首 tick：vy −= fround(3.0E-6f) 后位移（stop=false 才会位移：vel 0 0 0 会被 stop 回滚冻结）
    en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.y).toBeCloseTo(1 + rise - f(3e-6), 12);
  });

  it('campfire 初速消费顺序：寿命/初速交替逐粒子（I(50),F,I(50),F…）', () => {
    const en = eng({ seed: 1, nativeKinematics: true });
    en.runCommand(C('particleex normal minecraft:campfire_signal_smoke 0 0 0 1 1 1 1 0 0 0 0 0 0 2 0'));
    const [a, b] = snap(en);
    expect([a.lifetime, b.lifetime]).toEqual([88, 120]); // I(50) 序列 8, 40（交错流第 1/3 个抽取）
    expect(a.vy).toBe(Math.fround(500 / (4922041 / 16777216))); // 第 2 个抽取
    expect(b.vy).toBe(Math.fround(500 / (69727 / 16777216))); // 第 4 个抽取
  });

  it('显式 age 的 campfire：不消费初速 float（与构造器顺序一致：仅 age=0 路径）', () => {
    const en = eng({ seed: 1, nativeKinematics: true });
    en.runCommand(C('particleex normal minecraft:campfire_cosy_smoke 0 0 0 1 1 1 1 0 0 0 0 0 0 1 300'));
    const p = snap(en)[0];
    expect(p.lifetime).toBe(300);
    expect(p.vy).toBe(0); // 无初速
  });

  // 以下命令 pos=0 0 0（y 从 0 起）、vel='0 1 0'（cmdVy=1）；位移用摩擦前 vy。
  it('dust：构造器出生初速 ×0.1f→f2d（spawnVelocityMul；Java 侧无条件、与 age 无关）', () => {
    const en = eng1('dust');
    const p = snap(en)[0];
    expect(p.vy).toBe(f(0.1)); // 1 × f2d(0.1f)
    expect(p.vx).toBe(0);
    en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.y).toBeCloseTo(f(0.1), 12); // 无重力：y = 0 + vy
    expect(p1.vy).toBeCloseTo(f(0.1) * fr(0.96), 12); // 摩擦 0.96f
  });

  it('crit：出生初速 ×0.4d + 摩擦 0.7f + 重力 −0.02（构造器末尾 tick() off-by-one 不建模）', () => {
    const en = eng1('crit');
    expect(snap(en)[0].vy).toBe(0.4);
    en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.y).toBeCloseTo(0.4 - 0.02, 12); // 重力先于位移
    expect(p1.vy).toBeCloseTo((0.4 - 0.02) * fr(0.7), 12);
  });

  it('bubble：出生初速 ×0.2f→f2d + 自管 yd += 0.002d + 摩擦 0.85d', () => {
    const en = eng1('bubble');
    expect(snap(en)[0].vy).toBe(f(0.2));
    en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.y).toBeCloseTo(f(0.2) + 0.002, 12);
    expect(p1.vy).toBeCloseTo((f(0.2) + 0.002) * 0.8500000238418579, 12);
  });

  it('dripping_lava：hang 系 = 位移用摩擦前 vy、postMove ×0.02（表 friction）+ tick 尾部 ×0.98（表 postFriction）', () => {
    const en = eng1('dripping_lava');
    en.tickOnce();
    const p1 = snap(en)[0];
    // gravityY = −0.02d×fround(0.06f)（hang 构造器 gravity×0.02f；tick 直接减）
    // 字节码顺序（DripParticle.tick + DripHang.postMoveUpdate）：
    //   yd −= f2d(gravity) → move → 三轴×0.02d → 三轴×0.98d
    const g = -0.0011999999405816197;
    const post = 0.9800000190734863;
    expect(p1.y).toBeCloseTo(1 + g, 12); // y = 0 + 摩擦前 vy
    expect(p1.vy).toBeCloseTo((1 + g) * 0.02 * post, 12);
  });

  it('reset_mob_growth：出生初速偏移 +0.03d（SimpleVertical；确定性、无随机消费）', () => {
    const en = eng1('reset_mob_growth');
    expect(snap(en)[0].vy).toBe(1.03); // cmdVy=1 + 0.03
    en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.y).toBeCloseTo(1.03, 12);
    expect(p1.vy).toBeCloseTo(1.03 * fr(0.98), 12);
  });

  it('cloud：无出生初速（零速构造）+ 摩擦 0.96f、无重力', () => {
    const en = eng1('cloud');
    expect(snap(en)[0].vy).toBe(1); // 模组 cmdVy 原样（无 × 常量）
    en.tickOnce();
    expect(snap(en)[0].vy).toBeCloseTo(fr(0.96), 12);
  });

  it('damage_indicator：Provider 传 cmdVy+1.0d 后统一 ×0.4d → vy = (1+1)·0.4 = 0.8（精确式子，非 mul+offset）', () => {
    const en = eng1('damage_indicator');
    expect(snap(en)[0].vy).toBe(0.8); // (cmdVy 1 + 1)·0.4d
    expect(snap(en)[0].vx).toBe(0); // cmdVx=0 ×0.4d
    en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.vy).toBeCloseTo((0.8 + gBase(0.5)) * fr(0.7), 12); // CritParticle：friction 0.7f、gravity 0.5f
  });

  it('noxious_gas：BaseAshSmoke 管道（摩擦 0.96f、重力 −0.04d×fround(−0.02f) 微升）+ 命令速度原样（r/g/b 三参只乘构造器抖动）', () => {
    const en = eng1('noxious_gas');
    expect(snap(en)[0].vy).toBe(1); // 无 spawnVelocityMul：BaseAshSmoke 的 0.1f 只作用于抖动
    en.tickOnce();
    const p1 = snap(en)[0];
    const gravY = -0.04 * fr(-0.02); // −0.04d×fround(−0.02f)（表值精确 double）
    expect(p1.y).toBeCloseTo(1 + gravY, 12); // 重力先于位移
    expect(p1.vy).toBeCloseTo((1 + gravY) * fr(0.96), 12);
  });

  it('falling_dust：自管 tick ≡ base 管道 + 位移后 −0.003d + max(vy,−0.14d)（初始无摩擦、重力后于位移）+ 命令速度被构造器丢弃', () => {
    const en = eng1('falling_dust');
    expect(snap(en)[0].vy).toBe(0); // spawnVelocityMul 0：3 参构造器不带速度、provider 不传
    en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.y).toBe(0); // 位移 = 摩擦前 vy（0.003 在位移之后）
    expect(p1.vy).toBeCloseTo(-0.003000000026077032, 12); // move 后 −= 0.003d
  });

  it('falling_dust：零速起步 tick 46 仍未触顶、tick 47 首触终端钳制、之后恒住（age=-1）', () => {
    const en = eng({ seed: 1, nativeKinematics: true });
    en.runCommand(C('particleex normal minecraft:falling_dust 0 0 0 1 1 1 1 0 -1 0 0 0 0 1 -1'));
    for (let i = 0; i < 46; i++) en.tickOnce();
    const vy46 = snap(en)[0].vy; // 初速 0 起步 → vy = −0.003d×46 = −0.138…（命令速度不参与）
    expect(vy46).toBeLessThan(0);
    expect(vy46).toBeGreaterThan(-0.14000000059604645); // tick 46 尚未触顶
    en.tickOnce();
    expect(snap(en)[0].vy).toBe(-0.14000000059604645); // tick 47：−0.141… < −0.14 → max 首次生效
    for (let i = 0; i < 50; i++) en.tickOnce();
    expect(snap(en)[0].vy).toBe(-0.14000000059604645); // 不动点：恒住
  });

  it('falling_dust：命令速度被构造器丢弃（cmdVy=+1 与 −1 逐 tick 轨迹完全相同，age=-1）', () => {
    const run = (cmdVy: number) => {
      const en = eng({ seed: 1, nativeKinematics: true });
      en.runCommand(C(`particleex normal minecraft:falling_dust 0 0 0 1 1 1 1 0 ${cmdVy} 0 0 0 0 1 -1`));
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        en.tickOnce();
        out.push(snap(en)[0].y, snap(en)[0].vy);
      }
      return out;
    };
    const up = run(1);
    expect(up[0]).toBe(0); // tick 1 位移 = 初速 0（3 参 SingleQuadParticle 构造器无速度参数）
    expect(up).toEqual(run(-1)); // 上抛/下抛命令速度均被丢弃 → 轨迹逐位相同
  });

  it('spawnVelocityMul 与显式 age 无关（Java 构造器无条件；campfire 例外仍 age=0）', () => {
    const en = eng({ seed: 1, nativeKinematics: true });
    en.runCommand(C('particleex normal minecraft:dust 0 0 0 1 1 1 1 0 1 0 0 0 0 1 50'));
    const p = snap(en)[0];
    expect(p.lifetime).toBe(50); // 显式 age
    expect(p.vy).toBe(f(0.1)); // 初速修正不受 age 影响
  });

  it('firework：摩擦 0.91f + 重力 −0.04d×fround(0.1f)（cmdV 原样，无 × 常量）', () => {
    const en = eng1('firework');
    en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.y).toBeCloseTo(1 + gBase(0.1), 12);
    expect(p1.vy).toBeCloseTo((1 + gBase(0.1)) * fr(0.91), 12);
  });

  it('spit：摩擦 0.9f + 重力 −0.04d×fround(0.5f)（±0.05f 抖动不建模）', () => {
    const en = eng1('spit');
    en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.y).toBeCloseTo(1 + gBase(0.5), 12);
    expect(p1.vy).toBeCloseTo((1 + gBase(0.5)) * fr(0.9), 12);
  });

  it('explosion：零速构造（spawnVelocityMul 0）+ 无摩擦/重力 → 静止', () => {
    const en = eng1('explosion');
    expect(snap(en)[0].vy).toBe(0);
    en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.y).toBe(0); // cmdVy=1 ×0 → vy=0、无重力 → 无位移（stop 按 cmdV=false）
    expect(p1.vy).toBe(0);
  });

  it('sweep_attack：零速构造（tick 不调 move）+ 恒定寿命 iconst_4 → 命令速度被忽略、位置恒定', () => {
    const en = eng1('sweep_attack');
    const p0 = snap(en)[0];
    expect(p0.vy).toBe(0); // cmdVy=1 ×0（SingleQuadParticle 零速构造：dconst_0×3）
    expect(p0.lifetime).toBe(4); // 26.2 构造器末尾 iconst_4 覆写（无随机）
    for (let i = 0; i < 3; i++) en.tickOnce();
    const p1 = snap(en)[0];
    // tick 本体只做 xo/yo/zo 记录 + age++/死亡 + setSpriteFromAge：不调 move → 位置恒定
    expect(p1.x).toBe(0);
    expect(p1.y).toBe(0);
    expect(p1.z).toBe(0);
    expect(p1.vy).toBe(0);
    en.tickOnce(); // age=4 = lifetime → 移除
    expect(snap(en).length).toBe(0);
  });

  it('block_marker：位置型零速构造 + gravity 0f + lifetime 80（继承 Particle.tick 但速度恒 0）', () => {
    const en = eng1('block_marker');
    const p0 = snap(en)[0];
    expect(p0.vy).toBe(0); // cmdVy=1 ×0（位置型构造器不带速度 → 速度字段恒 0）
    expect(p0.lifetime).toBe(80); // 26.2 构造器 bipush 80 覆写
    for (let i = 0; i < 5; i++) en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.x).toBe(0);
    expect(p1.y).toBe(0); // gravity 0f + 零速 → 位置恒定
    expect(p1.z).toBe(0);
    for (let i = 5; i < 79; i++) en.tickOnce();
    expect(snap(en).length).toBe(1); // tick 79 仍存活（age 79 < 80）
    en.tickOnce(); // age=80 = lifetime → 移除
    expect(snap(en).length).toBe(0);
  });

  it('elder_guardian：零速构造 + gravity 0f + lifetime 30（继承 Particle.tick 但速度恒 0）', () => {
    const en = eng1('elder_guardian');
    const p0 = snap(en)[0];
    expect(p0.vy).toBe(0); // cmdVy=1 ×0（Particle(level,x,y,z) 位置型构造器）
    expect(p0.lifetime).toBe(30); // 26.2 构造器 bipush 30 覆写
    for (let i = 0; i < 5; i++) en.tickOnce();
    const p1 = snap(en)[0];
    expect(p1.x).toBe(0);
    expect(p1.y).toBe(0); // gravity 0f + 零速 → 位置恒定
    expect(p1.z).toBe(0);
    for (let i = 5; i < 29; i++) en.tickOnce();
    expect(snap(en).length).toBe(1); // tick 29 仍存活（age 29 < 30）
    en.tickOnce(); // age=30 = lifetime → 移除
    expect(snap(en).length).toBe(0);
  });

  it('enchant（FlyTowardsPosition）：出生位置 = 命令位置 + 速度矢量，逐 tick 走绝对式 f1 曲线 + f2⁴·1.2f 下坠', () => {
    const en = eng({ seed: 1, nativeKinematics: true });
    en.runCommand(C('particleex normal minecraft:enchant 0 0 0 1 1 1 1 0 1 0 0 0 0 1 30'));
    expect(snap(en)[0].y).toBe(1); // 构造器 xo = y + yd → 出生即偏移一个速度矢量
    en.tickOnce(); // age=1：t=1/30 → f1=1−t
    expect(snap(en)[0].y).toBe(0.9666651573645595); // ProbeFly（JDK21）同序列逐值
    en.tickOnce();
    expect(snap(en)[0].y).toBe(0.9333096336067683);
    en.tickOnce();
    expect(snap(en)[0].y).toBe(0.8998799760447582);
  });

  it('ominous_spawning（FlyStraightTowards）：绝对式线性 f1（无下坠项）+ 出生偏移', () => {
    const en = eng({ seed: 1, nativeKinematics: true });
    en.runCommand(C('particleex normal minecraft:ominous_spawning 0 0 0 1 1 1 1 1 0 0 0 0 0 1 25'));
    expect(snap(en)[0].x).toBe(1); // xo = x + xd
    en.tickOnce();
    expect(snap(en)[0].x).toBe(0.9599999785423279); // f1 = 1 − 1/25
    en.tickOnce();
    expect(snap(en)[0].x).toBe(0.9200000166893005);
    en.tickOnce();
    expect(snap(en)[0].x).toBe(0.8799999952316284);
  });

  it('block / block_crumble：TerrainParticle base 管道（friction 0.98f + gravity 1.0f → −0.04）', () => {
    const en = eng1('block');
    en.tickOnce();
    const p = snap(en)[0];
    expect(p.y).toBeCloseTo(1 - 0.04, 12); // 重力先于位移（与 item 同族）
    expect(p.vy).toBeCloseTo((1 - 0.04) * fr(0.98), 12);
    const en2 = eng1('block_crumble');
    en2.tickOnce();
    expect(snap(en2)[0].y).toBeCloseTo(1 - 0.04, 12);
  });

  it('nativeKinematics 关闭：新类型全部走模组匀速直线（无摩擦/重力/初速）', () => {
    const en = eng(); // 默认关闭
    en.runCommand(C('particleex normal minecraft:rain 0 0 0 1 1 1 1 0 1 0 0 0 0 1 0'));
    en.tickOnce();
    expect(snap(en)[0].y).toBeCloseTo(1, 12);
  });
});

describe('NATIVE_KINEMATICS 表值 = f2d 加宽精确值（防字面量回归）', () => {
  // 每个表项的 friction/gravityY 必须等于 Java float 字段 f2d 加宽后的精确
  // double（26.2 javap 逐常量核对；SuspendedTown 系 friction 例外 = 0.99d 常量）。
  // 期望值从构造器 putfield 的 float 十进制常量推导（fround），不抄表内字面量。
  const f = Math.fround;
  // [mcVersion, 类型名, 期望 friction, 期望 gravityY]
  const T: [string, string, number, number][] = [
    ['1.21.11', 'end_rod', f(0.91), -0.04 * f(0.0125)],
    ['26.2', 'end_rod', f(0.91), -0.04 * f(0.0125)],
    ['26.2', 'totem_of_undying', f(0.6), -0.04 * f(1.25)],
    ['26.2', 'heart', f(0.86), 0],
    ['26.2', 'angry_villager', f(0.86), 0],
    ['26.2', 'note', f(0.66), 0],
    ['26.2', 'snowflake', 1.0, -0.04 * f(0.225)],
    ['26.2', 'glow', f(0.96), 0],
    ['26.2', 'flame', f(0.96), 0],
    ['26.2', 'small_flame', f(0.96), 0],
    ['26.2', 'copper_fire_flame', f(0.96), 0],
    ['26.2', 'soul_fire_flame', f(0.96), 0],
    ['26.2', 'soul', f(0.96), 0],
    ['26.2', 'sculk_soul', f(0.96), 0],
    ['26.2', 'effect', f(0.96), -0.04 * f(-0.1)],
    ['26.2', 'instant_effect', f(0.96), -0.04 * f(-0.1)],
    ['26.2', 'witch', f(0.96), -0.04 * f(-0.1)],
    ['26.2', 'entity_effect', f(0.96), -0.04 * f(-0.1)],
    ['26.2', 'infested', f(0.96), -0.04 * f(-0.1)],
    ['26.2', 'raid_omen', f(0.96), -0.04 * f(-0.1)],
    ['26.2', 'trial_omen', f(0.96), -0.04 * f(-0.1)],
    ['26.2', 'lava', f(0.999), -0.04 * f(0.75)],
    ['26.2', 'rain', f(0.98), -f(0.06)],
    ['26.2', 'splash', f(0.98), -f(0.04)],
    ['26.2', 'underwater', 1.0, 0],
    ['26.2', 'spore_blossom_air', 1.0, 0],
    ['26.2', 'crimson_spore', 1.0, 0],
    ['26.2', 'warped_spore', 1.0, 0],
    ['26.2', 'composter', 0.99, 0],
    ['26.2', 'dolphin', 0.99, 0],
    ['26.2', 'happy_villager', 0.99, 0],
    ['26.2', 'egg_crack', 0.99, 0],
    ['26.2', 'mycelium', 0.99, 0],
    ['26.2', 'smoke', f(0.96), -0.04 * f(-0.1)],
    ['26.2', 'white_smoke', f(0.96), -0.04 * f(-0.1)],
    ['26.2', 'large_smoke', f(0.96), -0.04 * f(-0.1)],
    ['26.2', 'ash', f(0.96), -0.04 * f(0.1)],
    ['26.2', 'white_ash', f(0.96), -0.04 * f(0.1)],
    ['26.2', 'item', f(0.98), -0.04 * f(1.0)],
    ['26.2', 'item_slime', f(0.98), -0.04 * f(1.0)],
    ['26.2', 'item_cobweb', f(0.98), -0.04 * f(1.0)],
    ['26.2', 'item_snowball', f(0.98), -0.04 * f(1.0)],
    ['26.2', 'sulfur_cube_goo', f(0.98), -0.04 * f(1.0)],
    ['26.2', 'shriek', f(0.98), 0],
    ['26.2', 'squid_ink', f(0.92), 0],
    ['26.2', 'glow_squid_ink', f(0.92), 0],
    ['26.2', 'campfire_cosy_smoke', 1.0, -f(3e-6)],
    ['26.2', 'campfire_signal_smoke', 1.0, -f(3e-6)],
    ['26.2', 'noxious_gas', f(0.96), -0.04 * f(-0.02)],
    ['26.2', 'falling_dust', 1.0, -0.003000000026077032],
    ['26.2', 'sweep_attack', f(0.98), 0],
    ['26.2', 'block_marker', f(0.98), 0],
    ['26.2', 'elder_guardian', f(0.98), 0],
    ['26.2', 'block', f(0.98), -0.04 * f(1.0)],
    ['26.2', 'block_crumble', f(0.98), -0.04 * f(1.0)],
  ];
  for (const [ver, name, fr, gy] of T) {
    it(`${ver} ${name}：friction=${fr} gravityY=${gy}（f2d 精确）`, () => {
      const spec = NATIVE_KINEMATICS[ver][name];
      expect(spec.friction).toBe(fr);
      expect(spec.gravityY).toBe(gy);
    });
  }
});

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

// ---------- type{NBT} 载荷 → 渲染消费（nbtVisuals：渲染色/大小倍数）----------

describe('type{NBT} 渲染消费（nbtVisuals）', () => {
  // 单粒子路径（count=0）：精确位置、无高斯消费
  const v = (s2: string) => {
    const en = eng();
    en.runCommand(C(s2));
    return snap(en)[0];
  };

  it('dust{color,scale}：渲染色 + 大小倍数', () => {
    const p1 = v('particle dust{color:0x00FF00,scale:2f}');
    expect(p1.nbtTint).toBe(true);
    expect([p1.r, p1.g, p1.b]).toEqual([0, 1, 0]);
    expect(p1.sizeMul).toBe(2);
  });

  it('dust 的 color 也接受 [r,g,b] 0-1 列表形式', () => {
    const p1 = v('particle dust{color:[1,0,0.5],scale:1f}');
    expect(p1.nbtTint).toBe(true);
    expect([p1.r, p1.g, p1.b]).toEqual([1, 0, 0.5]);
  });

  it('entity_effect{color:ARGB}：alpha 在前，渲染色取 RGB 三分量', () => {
    const p1 = v('particle entity_effect{color:0x80FF0000}');
    expect(p1.nbtTint).toBe(true);
    expect([p1.r, p1.g, p1.b]).toEqual([1, 0, 0]);
  });

  it('dust_color_transition：出生色 = from_color（age 插值不模拟），scale 消费', () => {
    const p1 = v('particle dust_color_transition{from_color:0x0000FF,to_color:0xFF0000,scale:2f}');
    expect(p1.nbtTint).toBe(true);
    expect([p1.r, p1.g, p1.b]).toEqual([0, 0, 1]);
    expect(p1.sizeMul).toBe(2);
  });

  it('effect{}（全缺省）：color 缺省 -1 = 白 —— 不消费（缺省不置 nbtTint，渲染按出生白等价）', () => {
    const p1 = v('particle effect{}');
    expect(p1.nbtTint).toBeFalsy();
    expect([p1.r, p1.g, p1.b]).toEqual([1, 1, 1]);
    expect(p1.sizeMul).toBe(1);
  });

  it('effect{color:0x00FF00}：显式 color 消费（power 缺省不消费外观）', () => {
    const p1 = v('particle effect{color:0x00FF00}');
    expect(p1.nbtTint).toBe(true);
    expect([p1.r, p1.g, p1.b]).toEqual([0, 1, 0]);
  });

  it('dragon_breath/sculk_charge/shriek/geyser 系：无渲染色/大小字段 → 缺省', () => {
    for (const cmd of [
      'particle dragon_breath{power:2f}',
      'particle sculk_charge{roll:0.5f}',
      'particle shriek{delay:20}',
      'particle geyser{water_blocks:4}',
      'particle geyser_base{water_blocks:4,burst_impulse_base:0.1f}',
    ]) {
      const p1 = v(cmd);
      expect(p1.nbtTint).toBeFalsy();
      expect(p1.sizeMul).toBe(1);
    }
  });

  it('非收录类型无 NBT → 白 + 1（vanilla 出生色语义）', () => {
    const p1 = v('particle flame');
    expect(p1.nbtTint).toBeFalsy();
    expect(p1.sizeMul).toBe(1);
    expect(p1.vanilla).toBe(true);
  });
});

describe('trail{NBT} 消费：lerp 回位 + duration 寿命 + stop 回滚（26.2 javap）', () => {
  const TR = 'particle trail{target:[10,0,0],color:0xFF0000,duration:100} 0 0 0 1 1 1 0 0';

  it('出生：stop=true（零速）、渲染色 = color（0xFF0000 → 红）、lifetime = duration', () => {
    const e = eng({ nativeKinematics: true });
    e.runCommand(C(TR));
    const p = snap(e)[0];
    expect(p.stop).toBe(true);
    expect(p.nbtTint).toBe(true);
    expect([p.r, p.g, p.b]).toEqual([1, 0, 0]);
    expect(p.lifetime).toBe(100);
    expect(p.trailTarget).toEqual({ x: 10, y: 0, z: 0 });
  });

  it('vanilla 路径 stop=true：lerp 位移被模组回滚 → 位置钉在出生点，age 照常递增', () => {
    const e = eng({ nativeKinematics: true });
    e.runCommand(C(TR));
    for (let i = 0; i < 5; i++) e.tickOnce();
    const p = snap(e)[0];
    expect(p.age).toBe(5);
    expect([p.x, p.y, p.z]).toEqual([0, 0, 0]);
  });

  it('stop=false：每 tick lerp 回位（target 绝对坐标，余量 1/(lifetime−age)）', () => {
    const e = eng({ nativeKinematics: true });
    e.runCommand(C(TR));
    const p0 = snap(e)[0];
    expect(p0.lifetime).toBe(100);
    p0.stop = false; // snapshot 活引用：模拟模组参数模式 setStop(false)
    // 手工模拟 TrailParticle.tick（逐字节码 double 顺序）对照：
    // Mth.lerp(delta,start,end) 字节码 = start + (end−start)·delta
    let x = 0, y = 0, z = 0;
    const lt = 100;
    for (let a = 1; a <= 3; a++) {
      const f2 = 1 / (lt - a);
      x = x + (10 - x) * f2;
      y = y + (0 - y) * f2;
      z = z + (0 - z) * f2;
      e.tickOnce();
    }
    const p3 = snap(e)[0];
    expect(p3.x).toBeCloseTo(x, 12);
    expect(p3.y).toBeCloseTo(y, 12);
    expect(p3.z).toBeCloseTo(z, 12);
    // 逐 tick 逼近 target（x 从 0 向 10 收敛、单调）
    expect(p3.x).toBeGreaterThan(0);
    expect(p3.x).toBeLessThan(10);
  });

  it('duration 优先级：命令 age=0 时 duration 覆写寿命（构造器公式不消费）', () => {
    const e = eng({ seed: 42, nativeKinematics: true });
    e.runCommand(C(TR));
    expect(snap(e)[0].lifetime).toBe(100); // ≠ defaultLifetime(20)、≠ 任何公式值
    // 寿命到期死亡
    for (let i = 0; i < 100; i++) e.tickOnce();
    expect(e.aliveCount).toBe(0);
  });

  it('nativeKinematics 关闭：trail 零速仍静止（stop 路径无运动学参与）', () => {
    const e = eng({ nativeKinematics: false });
    e.runCommand(C(TR));
    for (let i = 0; i < 3; i++) e.tickOnce();
    expect(snap(e)[0].x).toBe(0);
  });
});

describe('vibration{NBT} 消费：lerp 归位 + arrival_in_ticks 寿命（26.2 javap）', () => {
  const VB = 'particle vibration{destination:{block:{pos:[1,2,3]}},arrival_in_ticks:10} 0 0 0 0 0 0 0 0';

  it('出生：stop=true（构造器零速）、lifetime = arrival_in_ticks、target = 方块中心', () => {
    const e = eng({ nativeKinematics: true });
    e.runCommand(C(VB));
    const p = snap(e)[0];
    expect(p.stop).toBe(true);
    expect(p.lifetime).toBe(10);
    expect(p.vibrationTarget).toEqual({ x: 1.5, y: 2.5, z: 3.5 });
  });

  it('vanilla 路径 stop=true：lerp 位移被模组回滚 → 位置钉在出生点，age 照常递增', () => {
    const e = eng({ nativeKinematics: true });
    e.runCommand(C(VB));
    for (let i = 0; i < 5; i++) e.tickOnce();
    const p = snap(e)[0];
    expect(p.age).toBe(5);
    expect([p.x, p.y, p.z]).toEqual([0, 0, 0]);
  });

  it('stop=false：每 tick lerp 推进至波源中心（余量 1/(lifetime−age)，double 域）', () => {
    const e = eng({ nativeKinematics: true });
    e.runCommand(C(VB));
    const p0 = snap(e)[0];
    p0.stop = false; // snapshot 活引用：模拟模组参数模式 setStop(false)
    let x = 0, y = 0, z = 0;
    const lt = 10;
    for (let a = 1; a <= 3; a++) {
      const f2 = 1 / (lt - a);
      x = x + (1.5 - x) * f2;
      y = y + (2.5 - y) * f2;
      z = z + (3.5 - z) * f2;
      e.tickOnce();
    }
    const p3 = snap(e)[0];
    expect(p3.x).toBeCloseTo(x, 12);
    expect(p3.y).toBeCloseTo(y, 12);
    expect(p3.z).toBeCloseTo(z, 12);
    expect(p3.x).toBeGreaterThan(0);
    expect(p3.x).toBeLessThan(1.5);
  });

  it('arrival_in_ticks 优先级：命令 age=0 时覆写寿命；负值 → 首 tick 即死', () => {
    const e = eng({ seed: 42, nativeKinematics: true });
    e.runCommand(C(VB));
    expect(snap(e)[0].lifetime).toBe(10); // ≠ defaultLifetime(20)、无公式消费
    for (let i = 0; i < 10; i++) e.tickOnce();
    expect(e.aliveCount).toBe(0);
    // arrival_in_ticks:-5（Codec.INT 允许负值）→ lifetime=-5 → 首 tick age=1>=-5 死亡
    const e2 = eng({ seed: 42, nativeKinematics: true });
    e2.runCommand(C('particle vibration{destination:{block:{pos:[1,2,3]}},arrival_in_ticks:-5} 0 0 0 0 0 0 0 0'));
    expect(snap(e2)[0].lifetime).toBe(-5);
    e2.tickOnce();
    expect(e2.aliveCount).toBe(0);
  });

  it('nativeKinematics 关闭：vibration 零速仍静止（stop 路径无运动学参与）', () => {
    const e = eng({ nativeKinematics: false });
    e.runCommand(C(VB));
    for (let i = 0; i < 3; i++) e.tickOnce();
    expect(snap(e)[0].x).toBe(0);
  });
});

describe('原版运动学：vibration 轨迹逐位 golden（26.2 字节码；JDK21 ProbeVibration 实测）', () => {
  // 逐位精确对拍（doubleToRawLongBits 十六进制）。与 trail 同型（t = 1/(lifetime−age)
  // 纯 double 除法 + Mth.lerp 三轴），但 target = destination 的 block 中心（+0.5 各轴）、
  // lifetime = arrival_in_ticks（构造器参数直传，无公式）。抓镜像公式类 bug：
  // 前几 tick 位置完全不同（spawn 0 → center 1.5：正向 0→0.15→0.3 vs 镜像 1.35→1.305）。
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  const hex = (d: number) => {
    dv.setFloat64(0, d);
    return dv.getBigUint64(0).toString(16).toUpperCase();
  };
  type Case = {
    cmd: string;
    lt: number; // lifetime = arrival_in_ticks
    gold: [string, string, string][];
  };
  const cases: Case[] = [
    // A: spawn 0, block (1,2,3) → center (1.5,2.5,3.5), L=10
    {
      cmd: 'particle vibration{destination:{block:{pos:[1,2,3]}},arrival_in_ticks:10} 0 0 0 0 0 0 0 0',
      lt: 10,
      gold: [
        ['3FC5555555555555', '3FD1C71C71C71C72', '3FD8E38E38E38E38'],
        ['3FD5555555555555', '3FE1C71C71C71C72', '3FE8E38E38E38E38'],
        ['3FE0000000000000', '3FEAAAAAAAAAAAAA', '3FF2AAAAAAAAAAAA'],
        ['3FE5555555555555', '3FF1C71C71C71C72', '3FF8E38E38E38E38'],
        ['3FEAAAAAAAAAAAAA', '3FF638E38E38E38E', '3FFF1C71C71C71C6'],
        ['3FF0000000000000', '3FFAAAAAAAAAAAAA', '4002AAAAAAAAAAAA'],
        ['3FF2AAAAAAAAAAAB', '3FFF1C71C71C71C6', '4005C71C71C71C71'],
        ['3FF5555555555556', '4001C71C71C71C72', '4008E38E38E38E38'],
        ['3FF8000000000000', '4004000000000000', '400C000000000000'],
      ],
    },
    // B: spawn 0, block (0,0,0) → center (0.5,0.5,0.5), L=7
    {
      cmd: 'particle vibration{destination:{block:{pos:[0,0,0]}},arrival_in_ticks:7} 0 0 0 0 0 0 0 0',
      lt: 7,
      gold: [
        ['3FB5555555555555', '3FB5555555555555', '3FB5555555555555'],
        ['3FC5555555555556', '3FC5555555555556', '3FC5555555555556'],
        ['3FD0000000000000', '3FD0000000000000', '3FD0000000000000'],
        ['3FD5555555555555', '3FD5555555555555', '3FD5555555555555'],
        ['3FDAAAAAAAAAAAAA', '3FDAAAAAAAAAAAAA', '3FDAAAAAAAAAAAAA'],
        ['3FE0000000000000', '3FE0000000000000', '3FE0000000000000'],
      ],
    },
    // C: spawn (1,0,0), block (-1,-2,0) → center (-0.5,-1.5,0.5), L=5（反向 + 分数）
    {
      cmd: 'particle vibration{destination:{block:{pos:[-1,-2,0]}},arrival_in_ticks:5} 1 0 0 0 0 0 0 0',
      lt: 5,
      gold: [
        ['3FE4000000000000', 'BFD8000000000000', '3FC0000000000000'],
        ['3FD0000000000000', 'BFE8000000000000', '3FD0000000000000'],
        ['BFC0000000000000', 'BFF2000000000000', '3FD8000000000000'],
        ['BFE0000000000000', 'BFF8000000000000', '3FE0000000000000'],
      ],
    },
    // D: 双向 + 非零 spawn (1,2,3), block (-4,8,0) → center (-3.5,8.5,0.5), L=6
    {
      cmd: 'particle vibration{destination:{block:{pos:[-4,8,0]}},arrival_in_ticks:6} 1 2 3 0 0 0 0 0',
      lt: 6,
      gold: [
        ['3FB9999999999998', '400A666666666666', '4004000000000000'],
        ['BFE999999999999A', '4012666666666666', '4000000000000000'],
        ['BFFB333333333334', '4017999999999999', '3FF8000000000000'],
        ['C004CCCCCCCCCCCD', '401CCCCCCCCCCCCC', '3FF0000000000000'],
        ['C00C000000000000', '4021000000000000', '3FE0000000000000'],
      ],
    },
    // E: L=2（首 tick f2=1 直接落点）, block (3,0,0) → (3.5,0.5,0.5)
    {
      cmd: 'particle vibration{destination:{block:{pos:[3,0,0]}},arrival_in_ticks:2} 0 0 0 0 0 0 0 0',
      lt: 2,
      gold: [['400C000000000000', '3FE0000000000000', '3FE0000000000000']],
    },
  ];
  cases.forEach((c, i) => {
    it(`用例 ${'ABCDE'[i]}（${c.cmd.split('{')[0]} target 轨迹逐位一致）`, () => {
      const e = eng({ nativeKinematics: true });
      e.runCommand(C(c.cmd));
      const p0 = snap(e)[0];
      expect(p0.lifetime).toBe(c.lt);
      p0.stop = false; // snapshot 活引用：启用 lerp（模组参数模式 setStop(false)）
      c.gold.forEach(([hx, hy, hz], idx) => {
        e.tickOnce();
        const p = snap(e)[0];
        expect(p.age).toBe(idx + 1);
        expect(hex(p.x)).toBe(hx);
        expect(hex(p.y)).toBe(hy);
        expect(hex(p.z)).toBe(hz);
      });
    });
  });
});

describe('原版运动学：trail 轨迹逐位 golden（26.2 字节码；JDK21 ProbeTrail 实测）', () => {
  // 逐位精确对拍（doubleToRawLongBits 十六进制）。抓镜像公式类 bug：
  // target+(x−target)·f2 与 x+(target−x)·f2 前几 tick 位置完全不同
  // （spawn 0/target 10：正向 0→1.111→2.222 vs 镜像 0→9.889→9.999）。
  // golden = ProbeTrail.java（JDK 21）：f2 = 1.0d/(lifetime−age)（i2d+ddiv），
  // x = Mth.lerp(f2, x, target.x)（= x + (target−x)·f2），y/z 同，tick 不调 super。
  // 覆盖：正向/反向/双向、整数与分数 target、L=2（首 tick f2=1 直接落点）。
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  const hex = (d: number) => {
    dv.setFloat64(0, d);
    // 对齐 Java Long.toHexString（无前导零、大写）
    return dv.getBigUint64(0).toString(16).toUpperCase();
  };
  type Case = {
    cmd: string;
    lt: number; // lifetime = duration
    // 每行 = 一次 tick（tick 1..N）后的 (x,y,z) 十六进制
    gold: [string, string, string][];
  };
  const cases: Case[] = [
    // A: spawn 0, target 10, L=10
    {
      cmd: 'particle trail{target:[10,0,0],color:0xFF0000,duration:10} 0 0 0 0 0 0 0 0',
      lt: 10,
      gold: [
        ['3FF1C71C71C71C72', '0', '0'],
        ['4001C71C71C71C72', '0', '0'],
        ['400AAAAAAAAAAAAA', '0', '0'],
        ['4011C71C71C71C72', '0', '0'],
        ['401638E38E38E38E', '0', '0'],
        ['401AAAAAAAAAAAAA', '0', '0'],
        ['401F1C71C71C71C6', '0', '0'],
        ['4021C71C71C71C72', '0', '0'],
        ['4024000000000000', '0', '0'],
      ],
    },
    // B: spawn 0, target 0.5, L=7
    {
      cmd: 'particle trail{target:[0.5,0,0],color:0xFF0000,duration:7} 0 0 0 0 0 0 0 0',
      lt: 7,
      gold: [
        ['3FB5555555555555', '0', '0'],
        ['3FC5555555555556', '0', '0'],
        ['3FD0000000000000', '0', '0'],
        ['3FD5555555555555', '0', '0'],
        ['3FDAAAAAAAAAAAAA', '0', '0'],
        ['3FE0000000000000', '0', '0'],
      ],
    },
    // C: spawn (1,0,0), target −2.25, L=5（反向 + 分数）
    {
      cmd: 'particle trail{target:[-2.25,0,0],color:0xFF0000,duration:5} 1 0 0 0 0 0 0 0',
      lt: 5,
      gold: [
        ['3FC8000000000000', '0', '0'],
        ['BFE4000000000000', '0', '0'],
        ['BFF7000000000000', '0', '0'],
        ['C002000000000000', '0', '0'],
      ],
    },
    // D: 双向 + 非零 spawn（1,2,3）→ (−4.5,8.25,0.5), L=6
    {
      cmd: 'particle trail{target:[-4.5,8.25,0.5],color:0xFF0000,duration:6} 1 2 3 0 0 0 0 0',
      lt: 6,
      gold: [
        ['BFB99999999999A0', '400A000000000000', '4004000000000000'],
        ['BFF3333333333334', '4012000000000000', '4000000000000000'],
        ['C002666666666666', '4017000000000000', '3FF8000000000000'],
        ['C00B333333333333', '401C000000000000', '3FF0000000000000'],
        ['C012000000000000', '4020800000000000', '3FE0000000000000'],
      ],
    },
    // E: L=2（首 tick f2=1 直接落点）
    {
      cmd: 'particle trail{target:[3,0,0],color:0xFF0000,duration:2} 0 0 0 0 0 0 0 0',
      lt: 2,
      gold: [['4008000000000000', '0', '0']],
    },
  ];
  cases.forEach((c, i) => {
    it(`用例 ${'ABCDE'[i]}（${c.cmd.split('{')[0]} target 轨迹逐位一致）`, () => {
      const e = eng({ nativeKinematics: true });
      e.runCommand(C(c.cmd));
      const p0 = snap(e)[0];
      expect(p0.lifetime).toBe(c.lt);
      p0.stop = false; // snapshot 活引用：启用 lerp（模组参数模式 setStop(false)）
      c.gold.forEach(([hx, hy, hz], idx) => {
        e.tickOnce();
        const p = snap(e)[0];
        expect(p.age).toBe(idx + 1);
        expect(hex(p.x)).toBe(hx);
        expect(hex(p.y)).toBe(hy);
        expect(hex(p.z)).toBe(hz);
      });
    });
  });
});
