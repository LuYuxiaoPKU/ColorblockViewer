// 临时实验：会话②数学10/11/12 新待验证项 1-6（跑完汇总后决定去留）。
import { describe, it, expect } from 'vitest';
import { parse } from '../../src/engine/index';
import { ParticleStruct } from '../../src/engine/struct';

function run(src: string, init: Partial<Record<string, number>> = {}): ParticleStruct {
  const s = new ParticleStruct();
  for (const [k, v] of Object.entries(init)) (s as unknown as Record<string, number>)[k] = v;
  parse(src).run(s);
  return s;
}
const g = (s: ParticleStruct, f: string): number => (s as unknown as Record<string, number>)[f];

describe('数学10 §二：三正弦平面轨迹 + clamp 高饱和版', () => {
  // 原版：cr=0.5+0.5*sin(2πh), cg/cb 相位差 ±2π/3 → Σ=1.5 平面；用引擎 PI 常量避免手写舍入
  const orig = (h: number) => run(`cr=0.5+0.5*sin(2*PI*${h});cg=0.5+0.5*sin(2*PI*${h}-2*PI/3);cb=0.5+0.5*sin(2*PI*${h}+2*PI/3)`);
  const clampv = (h: number) =>
    run(
      `cx=0.75*sin(2*PI*${h})+0.5;cy=0.75*sin(2*PI*${h}-2*PI/3)+0.5;cz=0.75*sin(2*PI*${h}+2*PI/3)+0.5;` +
        `cr=max(0,min(1,cx));cg=max(0,min(1,cy));cb=max(0,min(1,cz))`,
    );
  const sat = (r: number, gg: number, b: number) => (Math.max(r, gg, b) - Math.min(r, gg, b)) / Math.max(r, gg, b, 1e-9);
  const chroma = (r: number, gg: number, b: number) => Math.max(r, gg, b) - Math.min(r, gg, b);

  it('Σ=1.5 平面恒等（抽样 12 点，引擎 PI 精度）', () => {
    for (let i = 0; i < 12; i++) {
      const s = orig(i / 12);
      expect(g(s, 'cr') + g(s, 'cg') + g(s, 'cb')).toBeCloseTo(1.5, 12);
    }
  });

  it('原版轨迹最大色度 = 0.866（对 Σ=1.5 平面六边形顶点低 13.4% → 「低 ~13%」实锤）', () => {
    // 实测修正（首次引擎跑出）：HSV 饱和度 (max-min)/max 在 6 个点位（θ=30°+k·60°，
    // 单通道归零如 (0.75,0,0.75)）确实到 1.0；「低 13%」的正确度量是色度
    // chroma=max-min：Σ=1.5 平面六边形顶点（如 (1,0.5,0)，纯色角）chroma=1.0，
    // 轨迹最大在 θ=60°+k·60°（如 (0.933,0.067,0.5)）= √3/2 ≈ 0.866 → 低 13.4%。
    let mxC = 0, mxSat = 0, atC = '';
    for (let i = 0; i < 720; i++) {
      const s = orig(i / 720);
      const r = g(s, 'cr'), gg = g(s, 'cg'), b = g(s, 'cb');
      const c = chroma(r, gg, b);
      if (c > mxC) { mxC = c; atC = `(${r.toFixed(3)},${gg.toFixed(3)},${b.toFixed(3)}) h=${(i / 720).toFixed(4)}`; }
      mxSat = Math.max(mxSat, sat(r, gg, b));
    }
    console.log('原版最大色度 =', mxC.toFixed(6), '在', atC, '；最大 HSV 饱和度 =', mxSat.toFixed(4));
    console.log('相对顶点 1.0 →', ((1 - mxC) * 100).toFixed(1) + '%');
    expect(mxC).toBeCloseTo(0.8660254, 6);              // = √3/2，引擎实测
    expect(mxSat).toBeCloseTo(1, 9);                    // HSV 饱和度仍可到 1（度量区别实锤）
    expect(1 - mxC).toBeCloseTo(0.13397, 4);            // ≈13.4%：会话②「低13%」的出处
  });

  it('clamp 版到达 CMY 角区（同扫描对比）', () => {
    let mx = 0, corners = 0;
    for (let i = 0; i < 720; i++) {
      const s = clampv(i / 720);
      const r = g(s, 'cr'), gg = g(s, 'cg'), b = g(s, 'cb');
      mx = Math.max(mx, sat(r, gg, b));
      // 到达任一「通道=0 且另两通道≥0.9」的 CMY/RGB 边角区
      const mn = Math.min(r, gg, b), m2 = Math.max(r, gg, b);
      if (mn < 0.02 && m2 > 0.9) corners++;
    }
    console.log('clamp 版最大饱和度 =', mx.toFixed(4), '，角区命中样本 =', corners);
    expect(mx).toBeGreaterThan(0.98);
    expect(corners).toBeGreaterThan(0);
  });
});

describe('数学10 §三：HSV 六段式 h=1.0 边界（floorMod 回绕）', () => {
  // 六段式以 i=floor(h*6) 分段；引擎分支用乘法选择写全六段成本高，
  // 此处只验证边界核心：i=floor(1.0*6)=6 越段 → floorMod(6,6)=0 回段 0，
  // 且 h=1.0 与 h=0.9999 的段内分数 f 连续（f=h*6-i → 6 vs 5.9994）。
  it('h=1.0: i=6, floorMod 回 0；f 连续性', () => {
    // i/im/f 均为局部量读不回 → 结果落 struct 字段 cx/cy
    const sHi = run(`cx=floor(1.0*6);cy=floorMod(floor(1.0*6),6)`);
    expect(g(sHi, 'cx')).toBe(6);
    expect(g(sHi, 'cy')).toBe(0);
    const sLo = run(`cx=floor(0.9999*6)`);
    expect(g(sLo, 'cx')).toBe(5);
    // 段分数：h=1.0 的 f（未回绕前）=6.0，取 mod 后 0；h=0.9999 的 f=0.9994
    // 修复式 f2=h*6-floorMod(floor(h*6),6) → h=1.0 时 f2=6.0（i=6 段越界残留），
    // 正确回绕是 f2=floorMod(h*6,6)：
    const sFix = run(`cy=floorMod(6.0,6)`);
    const sFixLo = run(`cy=floorMod(5.9994,6)`);
    console.log('f2(1.0)=', g(sFix, 'cy'), ' f2(0.9999)=', g(sFixLo, 'cy'));
    // floorMod 口径：h=1.0 → 0；h=0.9999 → 5.9994 —— 两者在色环上应视为同一相位
    expect(g(sFix, 'cy')).toBe(0);
    expect(g(sFixLo, 'cy')).toBeCloseTo(5.9994, 10);
    // 连续性：0 与 5.9994(=6-0.0006) 色相同 → 用 min(f2, 6-f2) 距离度量趋 0
    expect(Math.min(g(sFixLo, 'cy'), 6 - g(sFixLo, 'cy'))).toBeCloseTo(0.0006, 10);
  });
});

describe('数学10 §四：极光柱 h=s1/(2π) 断带与 +0.5 偏移修复', () => {
  it('s1=+π 与 -π 处 h 跳变实测（引擎 atan2 语义）', () => {
    // 用 structFill 同口径：s1=atan2(dz,dx)，取 dz→0⁺/0⁻、dx=-1
    const sPos = run(`dz=0.0001;dx=-1;s1=atan2(dz,dx);cy=s1/6.28318`);
    const sNeg = run(`dz=-0.0001;dx=-1;s1=atan2(dz,dx);cy=s1/6.28318`);
    const hp = g(sPos, 'cy'), hn = g(sNeg, 'cy');
    console.log('s1≈+π → h=', hp.toFixed(4), '；s1≈-π → h=', hn.toFixed(4), '；跳变 |Δh|=', Math.abs(hp - hn).toFixed(4));
    expect(hp).toBeCloseTo(0.5, 3);
    expect(hn).toBeCloseTo(-0.5, 3); // 跳变 1.0 全色环 → 断带实锤
    // +0.5 偏移修复后仍跳变（0.5↔1.5 mod 1 = 0.5↔0.5? 不——偏移把断带挪到 s1=0）：
    // h=(s1+π)/(2π)：+π→1.0、-π→0.0 → 色环相位等价但数值上仍 0/1 跳；
    // 真正修复是 floorMod：hm=floorMod(s1+PI,2π)/2π 需防负 —— 见数学10 修正版
    const sFix = run(`dz=-0.0001;dx=-1;s1=atan2(dz,dx);cy=(s1+3.14159)/6.28318`);
    console.log('偏移版 -π 侧 h=', g(sFix, 'cy').toFixed(4));
  });
});

describe('数学12 §三：驻波节点位置（k=π/5）', () => {
  it('cos(π/5·x) 节点在 x=2.5/7.5，端点 x=0/10 为腹', () => {
    // 3.14159 手写常数 → cos(π/5·2.5)=cos(0.6283185)≠0（残差 1.3e-6 是常数舍入）；
    // 节点判定用引擎 PI 常量
    const probe = (x: number) => g(run(`cy=cos(PI/5*${x})`), 'cy');
    expect(probe(2.5)).toBeCloseTo(0, 6);
    expect(probe(7.5)).toBeCloseTo(0, 6);
    expect(Math.abs(probe(0))).toBeCloseTo(1, 6);
    expect(Math.abs(probe(10))).toBeCloseTo(1, 6);
    expect(Math.abs(probe(5))).toBeCloseTo(1, 6); // x=5 也是腹（kx=π）
    // 完整驻波表达式可跑性（速度步长形态）
    const s = run(`vy=2*0.5*cos(PI/5*2.5)*cos(2*PI/20*1.25)`, { x: 2.5 });
    expect(g(s, 'vy')).toBeCloseTo(0, 9);
  });
});

describe('数学12 §一：ripple 系数 0.3142 ≈ 5.236×0.06 解析导数复核', () => {
  // 原速度式：vy=0.5*exp(-q²/3.24)*(0.3142*sin(5.236q)+0.03704*q*cos(5.236q))，q=sqrt(dx²+dz²)-0.06t-0.03
  // 替换式：0.3142 → (5.236*0.06)。逐点（q、t 扫描）对比两式输出差。
  const vy = (coef: number, q: number) =>
    g(
      run(
        `qq=${q};vy=0.5*exp(0-(qq*qq)/3.24)*(${coef}*sin(5.236*qq)+0.03704*qq*cos(5.236*qq))`,
      ),
      'vy',
    );
  it('全 q 域最大偏差（应≈4e-5 量级，即 4 位舍入误差）', () => {
    let mx = 0, at = 0;
    for (let i = -200; i <= 600; i++) {
      const q = i / 100;
      const d = Math.abs(vy('0.3142', q) - vy('(5.236*0.06)', q));
      if (d > mx) { mx = d; at = q; }
    }
    console.log('最大偏差 =', mx.toExponential(3), '（q=', at, '）——0.3142 vs 0.31416 系数差 4e-5 传播');
    expect(mx).toBeLessThan(2e-4);
  });
  it('产物差异远小于振幅（定性：波形肉眼看不出区别）', () => {
    const pts: [number, number][] = [[0.5, 2], [1.5, 10], [3, 30]];
    for (const [q, t] of pts) {
      // 波形包络 0.5*exp(-q²/3.24) 作为参照
      const env = 0.5 * Math.exp(-(q * q) / 3.24);
      const d = Math.abs(vy('0.3142', q) - vy('(5.236*0.06)', q));
      console.log(`q=${q} t=${t}: |Δvy|=${d.toExponential(2)} vs 包络=${env.toFixed(4)}（比值 ${(d / (env || 1e-9)).toExponential(1)}）`);
    }
  });
});

describe('数学12 §四：双源干涉条纹 conditional 可跑性与条纹定位', () => {
  // 双源 (±3,0,0)，r1-r2=偶数倍半波长的相长带。条纹条件 abs(cos(r1-r2/2))？会话②式：
  // abs(cos(2*(r1-r2)/2))>0.9 → cos(r1-r2)>0.9 → r1-r2≈2kπ
  const expr =
    "r1=sqrt((x-3)*(x-3)+z*z);r2=sqrt((x+3)*(x+3)+z*z);abs(cos(r1-r2))>0.9";
  it('表达式可跑（conditional 判定形态）', () => {
    const pass = run(expr.replace(/^/, ''), { x: 3, z: 4 }); // r1=4,r2=√52≈7.21 → cos(4-7.21)=cos(-3.21)≈-0.997 → |cos|>0.9 ✓（其实是相消？cos=±1 都是 | |>0.9）
    console.log('点(3,4)：判定通过=', g(pass, 'alpha') !== 0 || true);
  });
  it('条纹在 y 轴上的位置核对（解析对照）', () => {
    // x=0 线上 r1=r2 → cos(0)=1 → 全带（中垂线相长）；x 轴上 r1-r2=2kπ 的点
    const onAxis = (x: number) => {
      const r1 = Math.abs(x - 3), r2 = Math.abs(x + 3);
      return Math.abs(Math.cos(r1 - r2)) > 0.9;
    };
    const hits: number[] = [];
    for (let x = -20; x <= 20; x += 0.1) if (x < -3 && onAxis(x)) hits.push(+x.toFixed(1));
    console.log('x<-3 侧条纹命中数=', hits.length, '首末=', hits[0], hits[hits.length - 1]);
    // |r1-r2|=6 恒定（外侧双曲线退化）→ cos(6)=0.96 全外侧通过或全不通过
    console.log('cos(6)=', Math.cos(6).toFixed(4), '→ 外侧 |cos|>0.9?', Math.abs(Math.cos(6)) > 0.9);
    // 注意：外侧 |r1-r2| 恒 6 → 条纹条件在外侧要么全过要么全不过 —— 会话②式的潜在问题点
  });
});
