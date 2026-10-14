// 版本桶测试：13 桶类型表（particleData.ts）的边界校验——类型清单随版本单调
// 增长（除 light/allay_dust 移除与 cherry 三件合并），抽查关键类型的桶边界。
// 预期清单来自 CC《多版本粒子预览扩展调研.md》§二（中文 Wiki 历史节 + jar 实测闭合）。
import { describe, it, expect } from 'vitest';
import { PARTICLE_DATA } from '../../src/render/particleData';

const BUCKETS = ['1.17.1','1.18.2','1.19.2','1.20.1','1.20.4','1.20.5','1.20.6','1.21.1','1.21.4','1.21.8','1.21.11','26.2','26.3'] as const;

const has = (v: string, t: string) => PARTICLE_DATA[v]?.types.includes(t) ?? false;

describe('版本桶类型表：关键类型边界', () => {
  it('13 桶数据齐全且类型数 ≥ 81（1.17 基线）', () => {
    for (const v of BUCKETS) {
      const d = PARTICLE_DATA[v];
      expect(d, `${v} 缺条目`).toBeDefined();
      expect(d.types.length).toBeGreaterThanOrEqual(80);
    }
  });
  it('sculk 系 1.19 起才有（1.19.2 ✓ / 1.18.2 ✗）', () => {
    expect(has('1.18.2', 'sculk_soul')).toBe(false);
    expect(has('1.19.2', 'sculk_soul')).toBe(true);
    expect(has('1.19.2', 'sonic_boom')).toBe(true);
  });
  it('gust 系 1.20.3+（1.20.4 ✓ / 1.20.1 ✗）', () => {
    expect(has('1.20.1', 'gust')).toBe(false);
    expect(has('1.20.4', 'gust')).toBe(true);
  });
  it('vault_connection 1.20.5+；small_gust/ominous_spawning 同批', () => {
    expect(has('1.20.4', 'vault_connection')).toBe(false);
    expect(has('1.20.5', 'vault_connection')).toBe(true);
    expect(has('1.20.5', 'small_gust')).toBe(true);
    expect(has('1.20.5', 'ominous_spawning')).toBe(true);
  });
  it('trail/block_crumble 1.21.2+（桶 1.21.4 起出现）', () => {
    expect(has('1.21.1', 'trail')).toBe(false);
    expect(has('1.21.4', 'trail')).toBe(true);
    expect(has('1.21.4', 'block_crumble')).toBe(true);
  });
  it('firefly 1.21.5+（桶 1.21.8）；copper_fire_flame 1.21.9+（桶 1.21.11）', () => {
    expect(has('1.21.4', 'firefly')).toBe(false);
    expect(has('1.21.8', 'firefly')).toBe(true);
    expect(has('1.21.8', 'copper_fire_flame')).toBe(false);
    expect(has('1.21.11', 'copper_fire_flame')).toBe(true);
  });
  it('geyser 系/sulfur 系 26.2 起', () => {
    expect(has('1.21.11', 'geyser')).toBe(false);
    expect(has('26.2', 'geyser')).toBe(true);
    expect(has('26.2', 'sulfur_bubbles')).toBe(true);
  });
  it('poplar 三色杨树 26.3 起', () => {
    expect(has('26.2', 'red_poplar_leaves')).toBe(false);
    expect(has('26.3', 'red_poplar_leaves')).toBe(true);
  });
  it('cherry_leaves 1.20 起有合并版（1.19.2 无）', () => {
    expect(has('1.19.2', 'cherry_leaves')).toBe(false);
    expect(has('1.20.1', 'cherry_leaves')).toBe(true);
  });
  it('light/barrier 1.17 有、1.18 一并移除；block_marker 1.19.2 起有（jar 实测：1.18.2 注册表三者中仅 light/barrier 消失、block_marker 未入——Wiki 21w42a 记载与 1.18.2 正式版注册表以 jar 为准）', () => {
    expect(has('1.17.1', 'light')).toBe(true);
    expect(has('1.17.1', 'barrier')).toBe(true);
    expect(has('1.17.1', 'block_marker')).toBe(false);
    expect(has('1.18.2', 'light')).toBe(false);
    expect(has('1.18.2', 'barrier')).toBe(false);
    expect(has('1.18.2', 'block_marker')).toBe(false);
    expect(has('1.19.2', 'block_marker')).toBe(true);
  });
  it('类型数随桶不减（允许的移除例外：1.17.1→1.18.2 移除 light/barrier）', () => {
    const REMOVALS: Record<string, string[]> = { '1.18.2': ['light', 'barrier'] };
    for (let i = 1; i < BUCKETS.length; i++) {
      const prevV = BUCKETS[i - 1];
      const curV = BUCKETS[i];
      const prev = PARTICLE_DATA[prevV].types.filter((t) => !(REMOVALS[curV] ?? []).includes(t)).length;
      const cur = PARTICLE_DATA[curV].types.length;
      expect(cur, curV + '(' + cur + ') < ' + prevV + '(净 ' + prev + ')').toBeGreaterThanOrEqual(prev);
    }
  });
  it('运动学表覆盖全部桶（NATIVE_KINEMATICS 桶键）', async () => {
    const { NATIVE_KINEMATICS } = await import('../../src/sim/kinematics');
    for (const v of BUCKETS) expect(NATIVE_KINEMATICS[v], `${v} 缺运动学桶键`).toBeDefined();
  });
});
