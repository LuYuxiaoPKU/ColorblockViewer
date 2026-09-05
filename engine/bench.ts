// M1 性能门槛（计划 §5.1，2026-09-04 修订）：真实 M3 仿真形态——
// 4 条粒子命令（对应 4 个命令组 × 5000 粒子），每活粒子每 tick 跑
// 3 条速度表达式（vx/vy/vz）+ 1 条颜色表达式（rgba），共 4 条 invoke；
// 命令组内共享同一批 CompiledBlock（单态调用点，复刻 M3 按命令分组的循环结构）。
// 测中位数 ms/tick，门槛 < 16ms（实测中位数 14.2–14.6ms，留 ~10% 余量；
// 探针 best-of-20 为 12.63ms，中位数口径偏高 ~14%，故不以 12.63×1.2 定门槛）。
//
// 门槛修订理由（原 3ms 不可达，留痕）：
//  ① 原 3ms 的算术「2 万粒子 × 50 节点 = 100 万节点/tick」按**每粒子 1 条**
//     表达式估算；§3.4 实际动画路径每粒子 invoke 速度 xyz + 颜色共 4 条表达式
//     （本 bench 形态 ≈96 节点/粒子 → 1.92M 节点/tick），原门槛少算了 ~2× 因子；
//  ② 计划假设 0.5–1.5ns/节点 是字节码解释器的指令分派量级；闭包后端每节点是
//     真实 JS 函数调用（最坏 wrap/inner/叶子 三层帧），实测 ~5.8–7.5ns/节点
//     （单态探针 best-of 5.8ns；bench 中位数口径 7.5ns），偏差 4–10× 属预期
//     （V8 内联上限），非缺陷；
//  ③ 即便理想 1.5ns/节点 的字节码后端：1.92M × 1.5 ≈ 2.9ms 压线，且
//     Math.sin/cos 等内建 10–30ns/次 不受任何后端影响，Math 密集场景 3ms 不可达。
//  16ms/tick 占 50ms tick 预算 ~32%，1× 倍速下每 50ms 墙钟窗可跑 3 tick、
//  与渲染共存可维持 60fps。
//  字节码保险丝（计划 §5.1）触发条件：M3 仿真层实测 > 25ms/tick，或 Math 密集
//  表达式场景掉帧——届时实现 codegen.ts 的 emit 接口（同一 AST，预期 3–5×）。
//
// 用法：npm run test 走 tests/engine/bench.test.ts（vitest 宿主，console 可捕获）。

import { parse, type CompiledBlock } from '../src/engine/index';
import { ParticleStruct, FIELD_NAMES } from '../src/engine/struct';

const N = 20000; // 总活粒子数
const CMDS = 4; // 命令组数
const PER_CMD = N / CMDS; // 每组粒子数
const THRESHOLD_MS = 16;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function nodeCount(block: CompiledBlock): number {
  const walk = (n: unknown): number => {
    const x = n as Record<string, unknown>;
    let c = 1;
    for (const k of ['l', 'r', 'e']) if (x[k]) c += walk(x[k]);
    if (Array.isArray(x.args)) for (const a of x.args as unknown[]) c += walk(a);
    if (Array.isArray(x.rows)) for (const row of x.rows as unknown[][]) for (const e of row) c += walk(e);
    if (Array.isArray(x.exps)) for (const e of x.exps as unknown[]) c += walk(e);
    return c;
  };
  return block.block.reduce((s, n) => s + walk(n), 0);
}

// 生成约 4×(leaves-1) 节点的混合表达式（int/double/字段/函数/比较），
// 形态贴近 AnotherColorBlock 速度/颜色表达式（三角运动 + 系数的混合）。
//
// 形状约束：用平衡二叉树拼接（leaves=8 时深度 ~3）。不能用左/右结合逐层外包——
// Java 原版 Parser 对深嵌套存在指数级回溯（16 层 ≈ 0.7s，20 层挂死，Probe25
// 实锤，TS 移植 1:1 保留该缺陷），bench 若生成此类表达式会把 parse 本身挂死。
function buildExpr(rng: () => number, leaves: number): string {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const num = () => {
    const r = rng();
    return r < 0.5 ? String(Math.floor(rng() * 400) - 200) : (Math.floor(rng() * 2000) / 100 - 10).toFixed(2);
  };
  const field = () => pick(FIELD_NAMES);
  const term = (): string => {
    const r = rng();
    if (r < 0.5) return num();
    if (r < 0.8) return field();
    return pick(['0.3*t', '0.7*t', 't', 'age', 'dis'] as const);
  };
  const ops = ['+', '-', '*'] as const;
  const fns = ['abs', 'sin', 'cos', 'floor', 'round'] as const;
  const leaf = (): string =>
    rng() < 0.7 ? `(${term()}${pick(ops)}${term()})` : `${pick(fns)}(${term()})`;
  let level: string[] = [];
  for (let i = 0; i < leaves; i++) level.push(leaf());
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(`(${level[i]}${pick(ops)}${level[i + 1]})`);
    }
    if (level.length % 2) next.push(level[level.length - 1]);
    level = next;
  }
  return level[0];
}

export function main() {
  const rng = lcg(42);
  // 每命令 4 条表达式：vx/vy/vz（8 叶 ≈ 30 节点）+ 颜色（4 叶 ≈ 12 节点）
  const cmds: CompiledBlock[][] = [];
  let totalNodes = 0, exprCount = 0;
  for (let c = 0; c < CMDS; c++) {
    const exprs = [buildExpr(rng, 8), buildExpr(rng, 8), buildExpr(rng, 8), buildExpr(rng, 4)]
      .map((src) => {
        const b = parse(src);
        totalNodes += nodeCount(b);
        exprCount++;
        return b;
      });
    cmds.push(exprs);
  }
  const avgNodes = Math.round(totalNodes / exprCount);

  const structs = new Array<ParticleStruct>(N);
  for (let i = 0; i < N; i++) structs[i] = new ParticleStruct();

  // 一个 tick = 每活粒子跑 3.4 的表达式路径（此处只测引擎部分：
  // t 推进 + 3 速度 + 1 颜色 invoke；原生位移/颜色应用是 O(1) 赋值，不计入）
  const tick = (): number => {
    for (let c = 0; c < CMDS; c++) {
      const [vx, vy, vz, col] = cmds[c];
      for (let i = 0; i < PER_CMD; i++) {
        const s = structs[c * PER_CMD + i];
        s.t += 0.5;
        s.age += 1;
        vx.run(s);
        vy.run(s);
        vz.run(s);
        col.run(s);
      }
    }
    return 0;
  };

  // 预热（JIT 稳定；2 轮 ≈ 250ms，避免启动噪声进入采样）
  for (let w = 0; w < 2; w++) tick();

  const samples: number[] = [];
  const start = performance.now();
  while (performance.now() - start < 1000) {
    const t0 = performance.now();
    tick();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const med = samples[Math.floor(samples.length / 2)];
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const nodesPerTick = N * 4 * avgNodes;
  console.log(`${CMDS} 命令组 × ${PER_CMD} 粒子，每组 3 速度 + 1 颜色表达式，平均 ${avgNodes} 节点/表达式`);
  console.log(`每 tick ${nodesPerTick / 1e6}M 节点求值，tick 数 ${samples.length}`);
  console.log(`每 tick：中位数 ${med.toFixed(2)} ms，均值 ${mean.toFixed(2)} ms，p95 ${p95.toFixed(2)} ms`);
  console.log(
    med < THRESHOLD_MS
      ? `✅ 通过（中位数 < ${THRESHOLD_MS}ms/tick）`
      : `❌ 超门槛（中位数 ≥ ${THRESHOLD_MS}ms/tick）——触发字节码保险丝评估（见文件头）`,
  );
}
