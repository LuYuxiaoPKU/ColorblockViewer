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
  it('运动学表内类型 → full（end_rod 双版本表内；26.2 全量入表家族）', () => {
    expect(fidelityFor('end_rod', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('minecraft:End_Rod', '26.2', TYPES_262)).toBe('full'); // 归一化
    expect(fidelityFor('totem_of_undying', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('portal', '26.2', TYPES_262)).toBe('full');
    // 26.2 全量入表（§10 证据清单：dust 系/firework 系/Drip 系/其余可干净建模）
    expect(fidelityFor('dust', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('dust{Red:1f,Green:0f,Blue:0f,Size:1f}', '26.2', TYPES_262)).toBe('full'); // NBT 载荷不参与分级
    expect(fidelityFor('dust_color_transition', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('firework', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('flash', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('bubble', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('bubble_pop', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('dripping_lava', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('falling_honey', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('crit', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('cloud', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('dragon_breath', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('explosion', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('spit', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('reset_mob_growth', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('vibration', '26.2', TYPES_262)).toBe('full'); // 2026-09-11 核对入表：motion='vibration' 绝对式 lerp 归位
    expect(fidelityFor('vibration{destination:{block:{pos:[1,2,3]}},arrival_in_ticks:20}', '26.2', TYPES_262)).toBe('full'); // NBT 载荷不参与分级
    // 2026-09-12 第二轮核对入表：BaseAshSmoke base 管道 / 自管 tick ≡ base+终端钳制
    expect(fidelityFor('noxious_gas', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('falling_dust', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('falling_dust{Red:1f,Green:1f,Blue:1f}', '26.2', TYPES_262)).toBe('full'); // NBT 载荷不参与分级
    // 2026-09-12 第三轮核对入表：静态类型（零速构造 + 恒定寿命 + tick 无位移）
    expect(fidelityFor('sweep_attack', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('block_marker', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('block_marker{block_state:"minecraft:stone"}', '26.2', TYPES_262)).toBe('full'); // NBT 载荷不参与分级
    expect(fidelityFor('elder_guardian', '26.2', TYPES_262)).toBe('full'); // 零速构造 + gravity 0f + lifetime 30
    // 2026-09-12 第四轮核对入表：Terrain 方块族 + 位置式飞行曲线
    expect(fidelityFor('block', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('block_crumble', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('block{block_state:"minecraft:stone"}', '26.2', TYPES_262)).toBe('full'); // NBT 载荷不参与分级
    expect(fidelityFor('enchant', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('nautilus', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('vault_connection', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('ominous_spawning', '26.2', TYPES_262)).toBe('full');
    // 2026-09-12 第五轮核对入表：dust 系（逐 tick 常量衰减管道 / provider 初速覆写）
    expect(fidelityFor('dust_plume', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('dust_pillar', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('dust_pillar{block_state:"minecraft:stone"}', '26.2', TYPES_262)).toBe('full'); // NBT 载荷不参与分级
    // 2026-09-12 第五轮核对入表：落叶族（tick 无随机的确定性曲线，参数全为 Provider 常量）
    expect(fidelityFor('cherry_leaves', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('pale_oak_leaves', '26.2', TYPES_262)).toBe('full');
    expect(fidelityFor('tinted_leaves', '26.2', TYPES_262)).toBe('full');
  });

  it('注册表内但运动学未逐条核对 → approx（approx 清单类型）', () => {
    expect(fidelityFor('firefly', '26.2', TYPES_262)).toBe('approx'); // 逐 tick 随机位置抖动
    expect(fidelityFor('geyser_base', '26.2', TYPES_262)).toBe('approx'); // NoRender 发射器种子粒子
    expect(fidelityFor('noxious_gas_cloud', '26.2', TYPES_262)).toBe('approx'); // NoRender 发射器：tick 每 2 tick 用 level 随机向可达 sulfur 方块吐 gas（世界状态）
  });

  it('注册表外 → unknown', () => {
    expect(fidelityFor('not_a_particle', '26.2', TYPES_262)).toBe('unknown');
  });

  it('ambient_entity_effect：粒子数据表内有名但 26.2 注册表未注册（type map 无条目，命令走报错路径）→ 按数据表分级为 approx（保守口径，运动学无证据）', () => {
    expect(fidelityFor('ambient_entity_effect', '26.2', TYPES_262)).toBe('approx');
  });

  it('版本分区：1.21.11 仅 end_rod 是 full（§10 证据边界：不臆想跨版本一致）', () => {
    expect(fidelityFor('end_rod', '1.21.11', TYPES_12111)).toBe('full');
    // 26.2 表内的 totem_of_undying 在 1.21.11 分区无表项 → approx
    expect(fidelityFor('totem_of_undying', '1.21.11', TYPES_12111)).toBe('approx');
  });

  it('types 缺省（空）时跳过注册表检查，不产生 unknown', () => {
    expect(fidelityFor('end_rod', '26.2')).toBe('full');
    expect(fidelityFor('dust', '26.2')).toBe('full');
    expect(fidelityFor('block', '26.2')).toBe('full');
  });
});
