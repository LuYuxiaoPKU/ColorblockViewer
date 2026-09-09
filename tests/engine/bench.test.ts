import { describe, it } from 'vitest';
import { main } from '../../engine/bench';

// M1 性能门槛（计划 §5.1，2026-09-04 修订 3ms → 16ms，理由见 engine/bench.ts
// 文件头）：4 命令组 × 5000 粒子、每粒子 3 速度 + 1 颜色表达式，≈1.92M 节点/tick。
// 报告型：main() 仅输出中位数 ms/tick 的 ✅/❌（不 assert、不 gate CI）；
// 16ms/tick 门槛与 >25ms/tick 字节码保险丝为观察/触发条件。
describe('engine bench', () => {
  it('20k 粒子 4 表达式：中位数 ms/tick（报告型，门槛 16ms 见 engine/bench.ts）', () => {
    main();
  }, 20000);
});
