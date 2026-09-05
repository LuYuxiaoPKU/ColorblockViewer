import { describe, it } from 'vitest';
import { main } from '../../engine/bench';

// M1 性能门槛（计划 §5.1）：2 万粒子 × ~50 节点，中位数 ms/tick < 3ms。
describe('engine bench', () => {
  it('20k × 50 节点速度表达式 < 3ms/tick', () => {
    main();
  }, 20000);
});
