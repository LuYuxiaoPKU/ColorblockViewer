// 表达式引擎：ColorBlock/ExParticle 教程（mcmod.cn/post/4889，一二三章改自 ColorBlock
// 教程）中的技巧表达式可跑性 + 确定性结果锁。
//
// 素材来源与口径：
//  - 教程的 translate/scale/rotate/rotateDeg 是 ExParticle 扩展函数，本引擎
//    （AnotherColorBlock 1:1 移植）**无这些函数** → 变换类用例改用 4x4 齐次矩阵
//    字面量（行向量约定，与教程一致）手写等价矩阵；
//  - 行向量齐次矩阵的平移分量在**第 4 行**末三列：
//    translate(tx,ty,tz) = (1,0,0,0,,0,1,0,0,,0,0,1,0,,tx,ty,tz,1)；
//  - 教程的动态变换 `(vx,vy,vz)=(x,y,z,1)*(T - I4)` 里 T−I4 的括号不可省：
//    运算符优先级 * 先于 -，去掉后解析为 ((rowvec·T)-I4) → 1×4 减 4×4
//    matSub 形状不匹配 → AIOOBE "Index 4 out of bounds for length 4"（与 Java 一致）。
//    此报错形态锁为一个测试；
//  - 教程的 image/video 等命令为本预览不覆盖的扩展命令 → 不入测试；
//  - 教程「颜色 >1 溢出环绕」属渲染管线（(int)(v·255) → (byte) 截断），非表达式
//    引擎语义 → 不在此测（见渲染层）；
//  - 引擎整块返回 = 最后一条语句截断为 int → 数值类用例把结果存入 struct 字段
//    断言（保留 double 精度），不用块返回值；
//  - 自定义变量（S/Age/N/Bc/V 等）是**每 invoke 局部量**，不能预设进 struct、
//    也读不回来 → 必须在表达式源码内以独立语句赋值（教程原文的分号分隔写法），
//    最终结果赋给 struct 字段（vy 等）断言。

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/engine/index';
import { ParticleStruct } from '../../src/engine/struct';

/** 在给定字段初值上求值；返回指定字段的 double 值（出错时为空数组）或错误消息前缀。 */
function runField(
  src: string,
  init: Partial<Record<keyof ParticleStruct, number>> = {},
  fields: string[] = [],
): { v: number[]; err?: string } {
  const s = new ParticleStruct();
  for (const [k, v] of Object.entries(init)) (s as unknown as Record<string, number>)[k] = v;
  try {
    parse(src).run(s);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { v: [], err: m.includes('\n') ? m.slice(0, m.indexOf('\n')) : m };
  }
  return { v: fields.map((f) => (s as unknown as Record<string, number>)[f]) };
}

const near = (got: number, want: number, eps = 1e-12): void => {
  expect(Math.abs(got - want), `期望 ${want}, 实际 ${got}`).toBeLessThanOrEqual(eps);
};

describe('教程「缓动运动」：缓动函数表达式（速度步长 1.0，t 为归一化时间）', () => {
  // 教程流程 = 归一化（独立用例锁）+ 每缓动一条独立语句 V=S/Age*(F)。
  // 此处 S=1.0、Age=10.0 → 系数 0.1；t 直接取归一化值（0~1）。
  const S = 1.0, Age = 10.0, Sd = S / Age;
  const N = 5, N1 = N * 2 ** (N - 1);
  const Bc = 1.70158;
  const L2 = Math.log(2), TW = 2 * Math.PI;
  const nIn = (t: number): number => (t < 0.5 ? N1 * t ** N : N1 * (1 - t) ** N);
  const expIn = (t: number): number => 10 * L2 * 2 ** (20 * t - 10);
  const expOut = (t: number): number => 10 * L2 * 2 ** (-20 * t + 10);
  const elasticIn = (t: number): number =>
    2 ** (-10 * (1 - t)) *
    ((-10 * L2) * Math.sin((1 - t - 0.075) * TW / 0.3) + (TW / 0.3) * Math.cos((1 - t - 0.075) * TW / 0.3));
  const elasticOut = (t: number): number =>
    2 ** (-10 * t) *
    ((-10 * L2) * Math.sin((t - 0.075) * TW / 0.3) + (TW / 0.3) * Math.cos((t - 0.075) * TW / 0.3));
  const cubicInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  const cases: [string, (t: number) => number, number[]][] = [
    [`S=1.0;Age=10.0;vy=S/Age*(2*t*t)`, (t) => 2 * t * t, [0.2, 0.5, 0.8]],
    [`S=1.0;Age=10.0;vy=S/Age*(2*(1-t)*(1-t))`, (t) => 2 * (1 - t) * (1 - t), [0.2, 0.5, 0.8]],
    [`S=1.0;Age=10.0;vy=S/Age*(3*t^2-t^2*t)`, (t) => 3 * t * t - t * t * t, [0.2, 0.5, 0.8]],
    [`S=1.0;Age=10.0;vy=S/Age*(3*(1-t)^2-(1-t)^3)`, (t) => 3 * (1 - t) * (1 - t) - (1 - t) ** 3, [0.2, 0.5, 0.8]],
    [
      `S=1.0;Age=10.0;N=5;N1=N*2^(N-1);vy=S/Age*((t<0.5)*(N1*t^N)+(t>=0.5)*(N1*(1-t)^N))`,
      nIn,
      [0.2, 0.5, 0.8],
    ],
    [
      `S=1.0;Age=10.0;vy=S/Age*((t<0.5)*(10*log(2)*pow(2,20*t-10))+(t>=0.5)*(10*log(2)*pow(2,-20*t+10)))`,
      (t) => (t < 0.5 ? expIn(t) : expOut(t)),
      [0.2, 0.5, 0.8],
    ],
    [
      `S=1.0;Age=10.0;Bc=1.70158;vy=S/Age*(3*(Bc+1)*t^2-2*Bc*t)`,
      (t) => 3 * (Bc + 1) * t * t - 2 * Bc * t,
      [0.2, 0.5, 0.8],
    ],
    [
      `S=1.0;Age=10.0;vy=S/Age*(3*(1-t)^2-(sin(PI*t)+PI*t*cos(PI*t)))`,
      (t) => 3 * (1 - t) * (1 - t) - (Math.sin(Math.PI * t) + Math.PI * t * Math.cos(Math.PI * t)),
      [0.2, 0.5, 0.8],
    ],
    [
      `S=1.0;Age=10.0;Bc=1.70158;vy=S/Age*((t<0.5)*(12*(Bc+1)*t^2-4*Bc*t)+(t>=0.5)*(12*(Bc+1)*(1-t)^2-4*Bc*(1-t)))`,
      (t) => (t < 0.5 ? 12 * (Bc + 1) * t * t - 4 * Bc * t : 12 * (Bc + 1) * (1 - t) * (1 - t) - 4 * Bc * (1 - t)),
      [0.2, 0.5, 0.8],
    ],
    [
      `S=1.0;Age=10.0;vy=S/Age*(pow(2,-10*(1-t))*((-10*log(2))*sin(((1-t)-0.075)*2*PI/0.3)+(2*PI/0.3)*cos(((1-t)-0.075)*2*PI/0.3)))`,
      elasticIn,
      [0.1, 0.5, 0.9],
    ],
    [
      `S=1.0;Age=10.0;vy=S/Age*(pow(2,-10*t)*(-10*log(2)*sin((t-0.075)*(2*PI)/0.3)+(2*PI/0.3)*cos((t-0.075)*(2*PI)/0.3)))`,
      elasticOut,
      [0.1, 0.5, 0.9],
    ],
    [
      `S=1.0;Age=10.0;vy=S/Age*((t<0.5)*(4*t^3)+(t>=0.5)*(1-(-2*t+2)^3/2))`,
      cubicInOut,
      [0.2, 0.5, 0.8],
    ],
  ];

  for (const [src, ref, ts] of cases) {
    it(src.slice(0, 52) + (src.length > 52 ? '…' : ''), () => {
      for (const t of ts) {
        const r = runField(src, { t }, ['vy']);
        expect(r.err, src).toBeUndefined();
        near(r.v[0], Sd * ref(t));
      }
    });
  }

  it('教程归一化：t=(0<=t&t<Age)*(t/Age)+(t>=Age)*1（Age=10，钳到 0~1）', () => {
    const src = 'Age=10.0;t=(0<=t&t<Age)*(t/Age)+(t>=Age)*1';
    const want: [number, number][] = [[-1, 0], [0, 0], [5, 0.5], [9.99, 0.999], [10, 1], [15, 1]];
    for (const [t, w] of want) {
      const r = runField(src, { t }, ['t']);
      expect(r.err, src).toBeUndefined();
      near(r.v[0], w);
    }
  });

  it('教程「指数 easeIn 补丁」t=t+(t==0)：t=0 的首 tick 结束后 t 变 1（跳过 pow(2,-10) 尾值），t≠0 不变', () => {
    const r0 = runField('t=0;t=t+(t==0)', {}, ['t']);
    expect(r0.err).toBeUndefined();
    near(r0.v[0], 1);
    const r1 = runField('t=0.5;t=t+(t==0)', {}, ['t']);
    expect(r1.err).toBeUndefined();
    near(r1.v[0], 0.5);
    // 补丁的动机：未归一化前 t=0 时 expIn 给尾值 10log2·2^-10（非 0），补丁把它跳到 t=0.1
    const rTail = runField(`S=1.0;Age=10.0;vy=S/Age*(10*log(2)*pow(2,20*t-10))`, { t: 0 }, ['vy']);
    expect(rTail.err).toBeUndefined();
    near(rTail.v[0], Sd * 10 * L2 * 2 ** -10);
  });

  it('教程「某些缓动停不下来」补丁：vy=V*(t<1) 在归一化 t≥1 后钳到 0', () => {
    for (const [t, w] of [[0.5, 0.3], [1, 0], [3, 0]] as [number, number][]) {
      const r = runField('V=0.3;vy=V*(t<1)', { t }, ['vy']);
      expect(r.err).toBeUndefined();
      near(r.v[0], w);
    }
  });
});

describe('教程「变换」：4x4 齐次矩阵字面量 + 行向量约定（引擎无 translate/rotate 扩展函数，手写矩阵等价）', () => {
  const I4 = '(1,0,0,0,,0,1,0,0,,0,0,1,0,,0,0,0,1)';
  const c45 = Math.cos(Math.PI / 4), s45 = Math.sin(Math.PI / 4);

  it('平移：translate(-5,2,0) 的行向量等价矩阵（平移分量在第 4 行）', () => {
    const r = runField('(x,y,z)=(x,y,z,1)*(1,0,0,0,,0,1,0,0,,0,0,1,0,,-5,2,0,1)', { x: 1, y: 2, z: 3 }, ['x', 'y', 'z']);
    expect(r.err).toBeUndefined();
    near(r.v[0], -4);
    near(r.v[1], 4);
    near(r.v[2], 3);
  });

  it('缩放：scale(1,0.5,1) 等价对角矩阵', () => {
    const r = runField('(x,y,z)=(x,y,z,1)*(1,0,0,0,,0,0.5,0,0,,0,0,1,0,,0,0,0,1)', { x: 2, y: 4, z: 1 }, ['x', 'y', 'z']);
    expect(r.err).toBeUndefined();
    near(r.v[0], 2);
    near(r.v[1], 2);
    near(r.v[2], 1);
  });

  it('旋转：rotateDeg(45,0,0) 等价 X 轴旋转矩阵（教程公式 y\'=y·cos−z·sin, z\'=y·sin+z·cos 的行向量版）', () => {
    const r = runField(`(x,y,z)=(x,y,z,1)*(1,0,0,0,,0,${c45},${s45},0,,0,${-s45},${c45},0,,0,0,0,1)`, { x: 1, y: 1, z: 0 }, ['x', 'y', 'z']);
    expect(r.err).toBeUndefined();
    near(r.v[0], 1);
    near(r.v[1], c45); // 1·c − 0·s
    near(r.v[2], s45); // 1·s + 0·c
  });

  it('动态变换（速度表达式）：v=(x,y,z,1)·(T−I) — 教程 Y 轴 rotate(0,PI/32,0) 例（矩阵字面量需括号）', () => {
    const a = Math.PI / 32, c = Math.cos(a), s = Math.sin(a);
    const r = runField(
      `(vx,vy,vz)=(x,y,z,1)*(((${c},0,${-s},0,,0,1,0,0,,${s},0,${c},0,,0,0,0,1))-${I4})`,
      { x: 1, y: 0, z: 0 },
      ['vx', 'vy', 'vz'],
    );
    expect(r.err).toBeUndefined();
    near(r.v[0], c - 1); // x·cos(ry) + z·sin(ry) − x
    near(r.v[1], 0);
    near(r.v[2], -s); // −x·sin(ry) + z·cos(ry) − z
  });

  it('动态变换：整体放大 0.1 — 教程 scale(1.1,1.1,1.1)−I 与 (vx,vy,vz)=(x,y,z)*0.1 同值', () => {
    const r = runField(`(vx,vy,vz)=(x,y,z,1)*(((1.1,0,0,0,,0,1.1,0,0,,0,0,1.1,0,,0,0,0,1))-${I4})`, { x: 1, y: -2, z: 3 }, ['vx', 'vy', 'vz']);
    expect(r.err).toBeUndefined();
    near(r.v[0], 0.1);
    near(r.v[1], -0.2);
    near(r.v[2], 0.3);
  });

  it('动态变换：平移速度 0.2 — 教程 translate(0.2,0,0)−I 与 vx=0.2 同值（速度恒为平移量，与位置无关）', () => {
    const r = runField(`(vx,vy,vz)=(x,y,z,1)*(((1,0,0,0,,0,1,0,0,,0,0,1,0,,0.2,0,0,1))-${I4})`, { x: 5, y: 5, z: 5 }, ['vx', 'vy', 'vz']);
    expect(r.err).toBeUndefined();
    near(r.v[0], 0.2);
    near(r.v[1], 0);
    near(r.v[2], 0);
  });

  it('复合变换（教程示例）：translate(0.05,0,0)·scale(1,1.01,1)·scale(1.02,1.02,1.02)·rotate(0,PI/16,0) 减单位阵', () => {
    const a = Math.PI / 16, c = Math.cos(a), s = Math.sin(a);
    // 行向量 4x4（矩阵字面量顺序 = 教程书写顺序 = 作用顺序）
    const Tr = '(1,0,0,0,,0,1,0,0,,0,0,1,0,,0.05,0,0,1)';
    const S1 = '(1,0,0,0,,0,1.01,0,0,,0,0,1,0,,0,0,0,1)';
    const S2 = '(1.02,0,0,0,,0,1.02,0,0,,0,0,1.02,0,,0,0,0,1)';
    const Ry = `(${c},0,${-s},0,,0,1,0,0,,${s},0,${c},0,,0,0,0,1)`;
    const src = `(vx,vy,vz)=(x,y,z,1)*(${Tr}*${S1}*${S2}*${Ry}-${I4})`;
    // JS 参考：v' = r·Tr·S1·S2·Ry，速度 = v' − r（行向量）
    const mm = (A: number[], B: number[]): number[] => {
      const C = new Array(16).fill(0);
      for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) C[i * 4 + k] += A[i * 4 + j] * B[j * 4 + k];
      return C;
    };
    const M = mm(
      mm([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.05, 0, 0, 1], [1, 0, 0, 0, 0, 1.01, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      mm([1.02, 0, 0, 0, 0, 1.02, 0, 0, 0, 0, 1.02, 0, 0, 0, 0, 1], [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]),
    );
    const row = [1, 1, 1, 1];
    const ref = [0, 1, 2].map((k) => row.reduce((acc, w, j) => acc + w * M[j * 4 + k], 0) - row[k]);
    const r = runField(src, { x: 1, y: 1, z: 1 }, ['vx', 'vy', 'vz']);
    expect(r.err, src).toBeUndefined();
    near(r.v[0], ref[0]);
    near(r.v[1], ref[1]);
    near(r.v[2], ref[2]);
  });

  it('去掉 (T−I4) 的括号 → (rowvec·T) 先成 1×4，再减 4×4 → matSub 形状不匹配 AIOOBE（与 Java 一致；教程原文的括号不可省）', () => {
    // 教程书写 (x,y,z,1)*(T-I4)：* 优先于 -，无括号时解析为 ((rowvec·T)-I4)
    // → Java matSub 的 rMat[i][j] 对 1×4 越界 → "Index 4 out of bounds for length 4"
    const r = runField(`(x,y,z)=(x,y,z,1)*${I4}-${I4}`, { x: 1, y: 2, z: 3 }, ['x']);
    expect(r.err).toBe('java.lang.ArrayIndexOutOfBoundsException: Index 4 out of bounds for length 4');
  });

  it('极坐标变换：s2=s2+theta 垂直旋转 / dis=dis*2 整体放大（教程示例）', () => {
    const r = runField('s2=s2+PI/4;dis=dis*2', { s1: 0, s2: Math.PI / 2, dis: 2 }, ['s2', 'dis']);
    expect(r.err).toBeUndefined();
    near(r.v[0], Math.PI / 2 + Math.PI / 4);
    near(r.v[1], 4);
  });
});

describe('教程「分段表达式」：返回值法与短路法', () => {
  it('例1 返回值法：t<0 → y=sin(t)，t>=0 → y=0.2*t^2（x,y=t,sin(t)*(t<0)+0.2*t^2*(t>=0)）', () => {
    for (const t of [-1.5, -0.5, 0.5, 1.5]) {
      const r = runField(`x,y=t,sin(t)*(t<0)+0.2*t^2*(t>=0)`, { t }, ['x', 'y']);
      expect(r.err).toBeUndefined();
      near(r.v[0], t);
      near(r.v[1], t < 0 ? Math.sin(t) : 0.2 * t * t);
    }
  });

  it('例1 短路法：(t<0&y=sin(t))|(t>=0&y=0.2*t^2) 与返回值法同值', () => {
    for (const t of [-1.5, -0.5, 0.5, 1.5]) {
      const r = runField(`(t<0&y=sin(t))|(t>=0&y=0.2*t^2)`, { t }, ['y']);
      expect(r.err).toBeUndefined();
      near(r.v[0], t < 0 ? Math.sin(t) : 0.2 * t * t);
    }
  });

  it('例2 返回值法（速度表达式）：vy=2/20.0*(t<20);vx=3/20.0*(20<=t&t<40)', () => {
    for (const t of [10, 25, 45]) {
      const r = runField('vy=2/20.0*(t<20);vx=3/20.0*(20<=t&t<40)', { t }, ['vx', 'vy']);
      expect(r.err).toBeUndefined();
      near(r.v[0], t >= 20 && t < 40 ? 3 / 20.0 : 0);
      near(r.v[1], t < 20 ? 2 / 20.0 : 0);
    }
  });

  it('例3 destroy 条件（教程第五节坑点）：t>30 且颜色分量 <0.5 才销毁', () => {
    const D = `destroy=t>30&(cr%1<0.5)&(cg%1<0.5)&(cb%1<0.5)`;
    expect(runField(D, { t: 31, cr: 0.3, cg: 0.4, cb: 0.2 }, ['destroy']).v[0]).toBe(1);
    expect(runField(D, { t: 31, cr: 0.9, cg: 0.4, cb: 0.2 }, ['destroy']).v[0]).toBe(0);
    expect(runField(D, { t: 20, cr: 0.3, cg: 0.4, cb: 0.2 }, ['destroy']).v[0]).toBe(0);
  });
});

describe('教程第五节「出现的问题」：浮点精度坑', () => {
  it('y==-0.1 直接相等判断：步长 0.4 累加出的值不是精确 -0.1 → 假（精确字面量 → 真）', () => {
    // 教程场景：采样步长 0.4 从 0 走出的候选点，-0.1+0.4 与 -0.1 不等
    const yf = -0.1 + 0.4 - 0.4;
    expect(yf === -0.1).toBe(false); // 前提：浮点误差真实存在
    expect(runField('destroy=y==-0.1', { y: yf }, ['destroy']).v[0]).toBe(0);
    expect(runField('destroy=y==-0.1', { y: -0.1 }, ['destroy']).v[0]).toBe(1);
  });

  it('容差写法 abs(y-(-0.1))<10^-6 与区间写法 y>-0.1001&y<-0.0999 对误差值均为真', () => {
    const yf = -0.1 + 0.4 - 0.4;
    expect(runField(`destroy=abs(y-(-0.1))<10^-6`, { y: yf }, ['destroy']).v[0]).toBe(1);
    expect(runField(`destroy=y>-0.1001&y<-0.0999`, { y: yf }, ['destroy']).v[0]).toBe(1);
  });
});

describe('教程「实用示例」完整表达式（/particleex 口径；颜色>1 环绕属渲染层不测）', () => {
  it('示例1 方块边框：12 段短路条件参数表达式可跑，各段位置与颜色逐段正确', () => {
    const expr =
      '(t<1&x,y,z=t-0.5,-0.5,-0.5)|(1<=t&t<2&x,z=0.5,t-1.5)|(2<=t&t<3&x,z=2.5-t,0.5)|' +
      '(3<=t&t<4&x,z=-0.5,3.5-t)|(4<=t&t<5&x,y,z=-0.5,t-4.5,-0.5)|(5<=t&t<6&x,y,z=0.5,5.5-t,-0.5)|' +
      '(6<=t&t<7&x,y,z=0.5,t-6.5,0.5)|(7<=t&t<8&x,y,z=-0.5,7.5-t,0.5)|(8<=t&t<9&x,y,z=-0.5,0.5,t-8.5)|' +
      '(9<=t&t<10&x,z=t-9.5,0.5)|(10<=t&t<11&x,z=0.5,10.5-t)|(11<=t&t<12&x,z=11.5-t,-0.5);' +
      'cr,cg,cb,alpha=0,t,1,1.0';
    // 段 1（t=0.5）：x=t-0.5=0, y=z=-0.5
    let r = runField(expr, { t: 0.5 }, ['x', 'y', 'z', 'cr', 'cg', 'cb', 'alpha']);
    expect(r.err).toBeUndefined();
    near(r.v[0], 0);
    near(r.v[1], -0.5);
    near(r.v[2], -0.5);
    near(r.v[3], 0);
    near(r.v[4], 0.5);
    near(r.v[5], 1);
    near(r.v[6], 1);
    // 段 2（t=1.5）：x=0.5, z=t-1.5=0
    r = runField(expr, { t: 1.5 }, ['x', 'z']);
    expect(r.err).toBeUndefined();
    near(r.v[0], 0.5);
    near(r.v[1], 0);
    // 段 12（t=11.5）：x=11.5-t=0, z=-0.5
    r = runField(expr, { t: 11.5 }, ['x', 'z']);
    expect(r.err).toBeUndefined();
    near(r.v[0], 0);
    near(r.v[1], -0.5);
  });

  it('示例2 沙漏形状：极坐标参数表达式（自定义变量 v/u + 矩阵字面量×标量 s 逐元素乘）可跑', () => {
    // 教程原文写 *(1,1,1,5)（矩阵字面量×4 元素）会 AIOOBE；其意图是整体放大 5 倍，
    // 等价写法 *s（s=5 为源内局部变量）
    const src = 's,a=5,PI/2;v,u=t*5,t*PI/100;(x,y,z)=(sin(v)*cos(u)^2,sin(u-a),cos(v)*cos(u)^2)*s';
    for (const t of [20.5, 100.2, 50.1]) {
      const u = t * Math.PI / 100;
      const r = runField(src, { t }, ['x', 'y', 'z']);
      expect(r.err, src).toBeUndefined();
      near(r.v[0], 5 * Math.sin(t * 5) * Math.cos(u) ** 2);
      near(r.v[1], 5 * Math.sin(u - Math.PI / 2));
      near(r.v[2], 5 * Math.cos(t * 5) * Math.cos(u) ** 2);
    }
  });
});
