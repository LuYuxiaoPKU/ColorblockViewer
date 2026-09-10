// 保真度分级（fidelityFor，UI「护城河可视化」角标的判定逻辑）：
// ✅ = 该类型的原版运动学有逐类型字节码证据（kinematics 表内）；
// ⚠️ = 近似（仅寿命公式/通用动画，运动学走表外近似；或按类型名近似）；
// ❌ = 不在该版本注册表。规则与 docs/技术路线.md §10 证据边界一致。

import { describe, it, expect } from 'vitest';
import { fidelityFor } from '../../src/sim/kinematics';
import { PARTICLE_DATA } from '../../src/render/particleData';

const TYPES_262 = PARTICLE_DATA['26.2'].types;
const TYPES_12111 = PARTICLE_DATA['1.21.11'].types;

describe('fidelityFor（26.2）', () => {
  it('运动学表内类型 → full（end_rod 双版本表内）', () => {
    expect(fidelityFor('end_rod', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('minecraft:End_Rod', '26.2', TYPES_262)).toBe('full'); // 归一化
    expect(fidelityFor('totem_of_undying', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('portal', '26.2', TYPES_262)).toBe('full');
  });

  it('注册表内但运动学未逐条核对 → approx（dust 按类型名近似；NBT 载荷不参与分级）', () => {
    expect(fidelityFor('dust', '26.2', TYPES_262)).toBe('approx');
    expect(fidelityFor('dust{Red:1f,Green:0f,Blue:0f,Size:1f}', '26.2', TYPES_262)).toBe('approx');
  });

  it('注册表外 → unknown', () => {
    expect(fidelityFor('not_a_particle', '26.2', TYPES_262)).toBe('unknown');
  });

  it('版本分区：1.21.11 仅 end_rod 是 full（§10 证据边界：不臆想跨版本一致）', () => {
    expect(fidelityFor('end_rod', '1.21.11', TYPES_12111)).toBe('full');
    // 26.2 表内的 totem_of_undying 在 1.21.11 分区无表项 → approx
    expect(fidelityFor('totem_of_undying', '1.21.11', TYPES_12111)).toBe('approx');
  });

  it('types 缺省（空）时跳过注册表检查，不产生 unknown', () => {
    expect(fidelityFor('end_rod', '26.2')).toBe('full');
    expect(fidelityFor('dust', '26.2')).toBe('approx');
  });
});
