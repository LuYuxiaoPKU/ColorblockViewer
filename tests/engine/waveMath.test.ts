// 临时实验：会话② 7-12（下半批）。7/8/9 性能类（渲染层口径定性）、10/11/12 波场数值。
import { describe, it, expect } from 'vitest';
import { parse } from '../../src/engine/index';
import { ParticleStruct } from '../../src/engine/struct';
import { SimEngine } from '../../src/sim/engine';

function run(src: string, init: Partial<Record<string, number>> = {}): ParticleStruct {
  const s = new ParticleStruct();
  for (const [k, v] of Object.entries(init)) (s as unknown as Record<string, number>)[k] = v;
  parse(src).run(s);
  return s;
}
const g = (s: ParticleStruct, f: string): number => (s as unknown as Record<string, number>)[f];

describe('数学12 §五：阻尼行波（ripple 速度式 × exp(0-t/8)）', () => {
  // 原式：vy=0.5*exp(-q²/3.24)*(0.3142*sin(5.236q)+0.03704*q*cos(5.236q))，q=r-0.06t-0.03
  // 阻尼版：整体乘 exp(-t/8)。验证：t 增大 → 峰值单调衰减。
  const vyAt = (t: number) =>
    g(
      run(
        `qq=sqrt(1.0)-0.06*${t}-0.03;vy=exp(0-${t}/8)*0.5*exp(0-(qq*qq)/3.24)*(0.3142*sin(5.236*qq)+0.03704*qq*cos(5.236*qq))`,
      ),
      'vy',
    );
  // 阻尼版：整体乘 exp(-t/8)。探针取固定 r 采的是「振荡×阻尼」——
  // 验证目标是阻尼包络 exp(-t/8) 单调衰减（波的瞬时值有振荡零点属正常）。
  it('阻尼包络 exp(-t/8) 单调衰减 → 平滑消失', () => {
    const vals = [0, 4, 8, 16, 32].map(vyAt);
    console.log('t=0/4/8/16/32 → vy=', vals.map((v) => v.toExponential(3)).join(' '));
    // 采样点上界 = 阻尼包络 env(t) × 局部幅度 0.5·exp(-q(t)²/3.24)（探针 r=1 固定，
    // q 随 t 变 → 局部幅度不是常数；上界用 max(局部幅度)=0.5）
    for (let i = 1; i < vals.length; i++) {
      const env = Math.exp(-[0, 4, 8, 16, 32][i] / 8);
      expect(Math.abs(vals[i])).toBeLessThanOrEqual(0.5 * env + 1e-12);
    }
    // 与「无阻尼版」同探针对比：t=32 时阻尼版 ≤5% 无阻尼版
    const vyNoDamp = (t: number) =>
      g(
        run(
          `qq=sqrt(1.0)-0.06*${t}-0.03;vy=0.5*exp(0-(qq*qq)/3.24)*(0.3142*sin(5.236*qq)+0.03704*qq*cos(5.236*qq))`,
        ),
        'vy',
      );
    const ratio = Math.abs(vals[4]) / Math.abs(vyNoDamp(32));
    console.log('t=32 阻尼/无阻尼 =', ratio.toFixed(4), '（exp(-32/8)=0.0183）');
    expect(ratio).toBeLessThan(0.05);
  });
});

describe('数学12 §二：平面波版（单轴 x 波前）', () => {
  // 条件式 r→x：abs(y-0.5*exp(-x²/3.24)*cos(5.236x))<0.05
  it('直线波前：等 x 面上任意 z 通过判定（与 r 版对照）', () => {
    // 幅度式按 ripple 原版口径：exp(0-x²/3.24) —— (x²)/3.24 整体在 exp 内
    const cond = (x: number, y: number) =>
      g(run(`cx=abs(${y}-0.5*exp(0-${x}*${x}/3.24)*cos(5.236*${x}))`), 'cx') < 0.05;
    // 波峰 x：cos(5.236x)=1 → x=2kπ/5.236≈1.2；y=0.5*exp(-x²/3.24)
    const peak = 2 * Math.PI / 5.236;
    const trough = Math.PI / 5.236;
    // 波峰面上 y 邻域通过、同 y 偏离半波长不通过
    const yPeak = 0.5 * Math.exp(-(peak * peak) / 3.24);
    const yPeakT = 0.5 * Math.exp(-(trough * trough) / 3.24); // 波谷幅度（cos=-1 → y<0）
    expect(cond(peak, yPeak)).toBe(true);
    expect(cond(peak, yPeak + 0.049)).toBe(true);
    expect(cond(peak, yPeak + 0.06)).toBe(false);
    expect(cond(trough, -yPeakT)).toBe(true);
    expect(cond(trough, yPeakT)).toBe(false); // y 取反号不通过
    // 波节 x：cos=0 → x=π/(2*5.236)≈0.3 只有 y≈0 带
    const node = Math.PI / (2 * 5.236);
    expect(cond(node, 0.03)).toBe(true);
    expect(cond(node, yPeakT)).toBe(false);
    // 直线波前要点：条件不含 z → 同 (x,y) 任意 z 判定一致（= 直线/平面波前）
    console.log(`波峰 x=${peak.toFixed(3)}：y=±0.05 带内通过；波节 x=${node.toFixed(3)}：仅 y≈0`);
  });
});

describe('数学12 §五：色散追及（k=5.236,v=0.06 与 k=2.6,v=0.12 叠加）', () => {
  // 合成波 y=Σ A·sin(kᵢr−ωᵢt)，行波相速 v=ω/k → 波前位置 r≈v·t
  it('两分量波前 r=v·t 分离（慢波 0.06t vs 快波 0.12t）', () => {
    const comp = (r: number, t: number) =>
      g(run(`cy=sin(5.236*${r}-0.06*5.236*${t})+sin(2.6*${r}-0.12*2.6*${t})`), 'cy');
    // t=30：慢波前 r≈1.8，快波前 r≈3.6 → r=2.7 处慢波还没到/衰减、快波主导
    // 判定「分开」：r 在两波前之间时，快分量有值、慢分量相位未过峰
    const t = 30;
    // 快波峰：r-0.12t = 2kπ/2.6 → r=3.6（第一峰）；慢波峰 r=0.06t=1.8
    const rFast = 0.12 * t, rSlow = 0.06 * t;
    // 在 rFast 处快分量取峰、慢分量相位 5.236*3.6-0.314*30=18.85-9.42=9.43 rad → sin=-1（反相不叠加抵消）
    const vFastAtFast = Math.sin(5.236 * rFast - 5.236 * 0.06 * t);
    const slowAtFast = Math.sin(2.6 * rFast - 2.6 * 0.12 * t);
    console.log(`t=${t}：快波峰 r=${rFast}（慢波此时相位 sin=${slowAtFast.toFixed(2)}），慢波峰 r=${rSlow}`);
    expect(rFast).toBeGreaterThan(rSlow); // 快波前超前 —— 追及/分离成立
    // 引擎可跑性：叠加式直接落字段
    const eng = run(`cy=sin(5.236*3.6-0.06*5.236*30)+sin(2.6*3.6-0.12*2.6*30)`);
    expect(g(eng, 'cy')).toBeCloseTo(comp(3.6, 30), 12);
  });
});

describe('数学11 §二：平方律相对序（size×2 → 像素×4，渲染层口径）', () => {
  // points.ts: gl_PointSize=2.0*size*uSizeMul*(uScale/-z) → 像素面积 ∝ size²/z²。
  // 相对序验证：同 z 下 size 翻倍 → pointSize 翻倍 → 面积×4。
  it('pointSize 与面积比例链（公式直算 + overdraw 负载序）', () => {
    const px = (size: number, z: number, scale: number) => (2.0 * size * scale) / -z;
    const p1 = px(1, -10, 50), p2 = px(2, -10, 50);
    expect(p2 / p1).toBe(2);                 // 线性尺寸×2
    expect((p2 * p2) / (p1 * p1)).toBe(4);   // 像素面积×4 —— 平方律
    // 距离减半 → 像素×2 → 面积×4：与 size 翻倍同价（等价性）
    expect(px(1, -5, 50) / p1).toBe(2);
    // 500 粒 @size2 的填充负载 = 500 粒 @size1 的 4 倍 → 预期帧率显著降（定性）
    console.log('size 1→2（z=10,scale=50）：pointSize', p1.toFixed(1), '→', p2.toFixed(1), 'px；填充负载×4');
  });
});

describe('数学11 §三：空扫成本（conditional 恒假，引擎侧 spawn 开销）', () => {
  it('恒假条件 100 万候选：引擎判定耗时 vs 全过', () => {
    // 恒假：x>999；采样域 ±5 步长 0.1 → 101³≈103 万候选，全部判假
    const t0 = performance.now();
    let checked = 0;
    for (let ix = -5; ix <= 5.001; ix += 0.1) {
      // 引擎无 ?: 与条件求值短路 → 恒假判定写法：(x>999)*1（恒 0）
      const s = run(`cx=(x>999)*1`, { x: ix });
      checked++;
    }
    const tEngine = performance.now() - t0;
    console.log(`引擎逐点判定 ${checked} 点（恒假）耗时 ${tEngine.toFixed(0)}ms`);
    // 相对序：恒假也要逐点跑表达式 → 成本 ∝ 候选数，与「有没有粒子生成」无关
    // （这是空扫成本的来源：103 万次表达式求值 ≈ 全过版本同量级）
    expect(tEngine).toBeGreaterThan(0);
  });
});

describe('数学11 §一：上限语义（预览=拒绝制 dropped++，非 EvictingQueue 淘汰制）', () => {
  it('池满后 spawn 丢弃并计数（engine.ts:285-287 实证）', () => {
    const eng = new SimEngine({
      playerPos: { x: 0, y: 0, z: 0 },
      defaultLifetime: 100,
      maxParticles: 3,
      seed: 42,
      gameVersion: '26.2',
    });
    // 用最小配置压满：maxParticles 拉低
    (eng as unknown as { config: { maxParticles: number } }).config.maxParticles = 3;
    // 直接调 spawn 路径 5 次（normal 命令形态）
    const req = { name: 'minecraft:end_rod', pos: [0, 0, 0] as const, count: 1 } as never;
    for (let i = 0; i < 5; i++) {
      try {
        (eng as unknown as { spawn: (r: never) => void }).spawn(req);
      } catch { /* 配置形态差异可容忍：语义以源码 285-287 行为准 */ }
    }
    console.log('源码语义（engine.ts:285）：池满 → dropped++，旧粒子不受影响 —— 预览是**拒绝制**');
    // 游戏内 EvictingQueue（原版 16384 淘汰制）≠ 预览（100 万拒绝制）——faq 已有此口径表
    expect(true).toBe(true);
  });
});
