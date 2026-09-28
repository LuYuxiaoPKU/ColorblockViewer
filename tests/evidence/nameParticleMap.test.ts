// 1.21.11 混淆版粒子类型映射取证文件（docs/evidence/name_particle_map_1.21.11.json）
// 完整性锁：115 注册表类型全覆盖、字段完备、与 kinematics 表 1.21.11 分区交叉一致。
// 取证来源：Mojang 官方 1.21.11 client.jar（全混淆）逐类 javap -c -p；
// 构造器调用逐条对 provider dump 核验（112 个 `<init>` + 3 个 static-factory `hms.a`，
// 与 how 字段一致，2026-09-25）。90 个非默认运动学类型已逐字节码与 26.2 比对一致
// （13 个 2026-09-25 + current_down/explosion_emitter/gust_emitter_large+small/
// trail/firefly 2026-09-26 + dust_color_transition 2026-09-29 + 批次 A 10 个
// 2026-09-29：campfire×2/dust/crit/damage_indicator/enchanted_hit/falling_dust/
// sweep_attack/block_marker/reverse_portal + 批次 B 6 个 2026-09-29：dripping 系
// 全族 hkn 族 + 批次 C 3 个 2026-09-29：landing 系 + 批次 D 8 个 2026-09-29：
// falling 系 + 批次 E 13 个 2026-09-29：RisingParticle 系（hmb 族）与
// GlowParticle 系（hld 族）+ glow_squid_ink/squid_ink（hmp 族）+ 批次 F 8 个
// 2026-09-29：smoke/ash 系（hke 族）与 block 系（hms 族）+ dust_pillar
// （hms$b ≡ TerrainParticle$Provider 随 block 系追加）+ 批次 G 5 个 2026-09-29：
// SuspendedTown 族（hmr 族）+ 批次 H 4 个 2026-09-29：item 族（hkg 族）+ 批次 I 7 个
// 2026-09-29：Spell 族（hml 族）+ 批次 J 4 个 2026-09-29：Suspended 族
// （hmq 族）+ 批次 K1 2 个 2026-09-29：Heart 族（hlg 族））
// → kinematics 表 1.21.11 分区按"差异优先"口径
// 不新增条目（见 kinematics.ts 版本分区注释）。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NATIVE_KINEMATICS, NATIVE_LIFETIME } from '../../src/sim/kinematics';
import { PARTICLE_DATA } from '../../src/render/particleData';

const HERE = dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(
  readFileSync(join(HERE, '..', '..', 'docs', 'evidence', 'name_particle_map_1.21.11.json'), 'utf8'),
) as {
  version: string;
  types: Record<
    string,
    { particle: string; provider: string; how: string; friction: string; gravity: string; lifetime: string; chain: string }
  >;
  verifiedAgainst262: string[];
};

const UI_TYPES = new Set(PARTICLE_DATA['1.21.11'].types.filter((t) => t && t !== 'type'));

describe('1.21.11 类型→混淆粒子类映射（取证文件完整性）', () => {
  it('版本标记 = 1.21.11', () => {
    expect(map.version).toBe('1.21.11');
  });

  it('115 注册表类型全覆盖、无 UI 全集外类型（UI 全集 116 = 115 注册 + ambient_entity_effect 这个 data-driven-only：assets JSON 有、注册表 <clinit> 无 → 命令报错路径，不入映射，与 26.2 先例同口径）', () => {
    const names = Object.keys(map.types);
    expect(names).toHaveLength(115);
    for (const n of names) expect(UI_TYPES.has(n), `UI 全集外类型: ${n}`).toBe(true);
    const missing = [...UI_TYPES].filter((n) => !map.types[n]);
    expect(missing).toEqual(['ambient_entity_effect']);
  });

  it('字段完备（粒子类/provider/调用形态/摩擦/重力/寿命分桶/继承链）且无歧义', () => {
    for (const [n, v] of Object.entries(map.types)) {
      // 粒子类 = 顶层或内部类（drip 族为 hkn 内部类 hkn$a..；spore_blossom_air 为匿名类 hmq$b$1）
      expect(v.particle, n).toMatch(/^[a-z0-9]+(\$[a-z0-9]+)*$/);
      expect(v.provider, n).toMatch(/^[a-z0-9]+\$[a-z]$/);
      expect(v.how, n).toMatch(/^direct$|^static-factory:/);
      // friction/gravity = "<float>@" 前缀（如 "0.98f@hlg.hlq-base"，@ 后为来源类.字段路径；
      // gravity 可为负（批次 F smoke 系 −0.1f 构造器参数传入）
      expect(v.friction, n).toMatch(/^\d+(\.\d+)?f@/);
      expect(v.gravity, n).toMatch(/^-?\d+(\.\d+)?f@/);
      expect(['base', 'own'], n).toContain(v.lifetime);
      // 继承链首 = 粒子类本身；链段全为小写混淆名（可含 $ 内部类段、$N 匿名类段；
      // dust 族链末 ma 是 hkq 的泛型上界 <T extends ma>，非继承终点——终点实为 hmg）
      expect(v.chain, n).toMatch(/^[a-z0-9]+(\$[a-z0-9]+)*(<[a-z0-9]+(\$[a-z0-9]+)*)*$/);
      expect(v.chain.startsWith(v.particle), n).toBe(true);
    }
  });

  it('static-factory 仅 block/block_crumble/dust_pillar（hms.a 工厂），其余 112 个走 direct 构造', () => {
    const sf = Object.entries(map.types)
      .filter(([, v]) => v.how.startsWith('static-factory'))
      .map(([n]) => n)
      .sort();
    expect(sf).toEqual(['block', 'block_crumble', 'dust_pillar']);
  });

  it('90 个已核对一致类型 + end_rod 的粒子类与 javap 抽样核验一致', () => {
    expect(map.types.end_rod.particle).toBe('hku');
    expect(map.types.explosion.particle).toBe('hlh');
    expect(map.types.sonic_boom.particle).toBe('hmj');
    expect(map.types.gust.particle).toBe('hle');
    expect(map.types.small_gust.particle).toBe('hle');
    expect(map.types.poof.particle).toBe('hkv');
    expect(map.types.portal.particle).toBe('hly');
    expect(map.types.rain.particle).toBe('hna');
    expect(map.types.snowflake.particle).toBe('hmi');
    expect(map.types.cherry_leaves.particle).toBe('hkx');
    expect(map.types.pale_oak_leaves.particle).toBe('hkx');
    expect(map.types.tinted_leaves.particle).toBe('hkx');
    expect(map.types.trial_spawner_detection.particle).toBe('hmw');
    expect(map.types.trial_spawner_detection_ominous.particle).toBe('hmw');
    // 2026-09-26 补：gust_emitter_large/small 共用一个粒子类 hlf
    expect(map.types.current_down.particle).toBe('hmz');
    expect(map.types.explosion_emitter.particle).toBe('hli');
    expect(map.types.gust_emitter_large.particle).toBe('hlf');
    expect(map.types.gust_emitter_small.particle).toBe('hlf');
    expect(map.types.trail.particle).toBe('hmv');
    expect(map.types.firefly.particle).toBe('hky');
    // 2026-09-29 补：dust_color_transition → hko（基类 hkq ≡ 26.2 DustParticleBase）
    expect(map.types.dust_color_transition.particle).toBe('hko');
    // 2026-09-29 批次 A：campfire×2 → hkk、dust → hkp、crit 族 3 型共用 hkl、
    // falling_dust → hkw、sweep_attack → hkd、block_marker → hkf、
    // reverse_portal → hma（各自构造器/tick 常量与管道顺序与 26.2 对应类一致）
    expect(map.types.campfire_cosy_smoke.particle).toBe('hkk');
    expect(map.types.campfire_signal_smoke.particle).toBe('hkk');
    expect(map.types.dust.particle).toBe('hkp');
    expect(map.types.crit.particle).toBe('hkl');
    expect(map.types.damage_indicator.particle).toBe('hkl');
    expect(map.types.enchanted_hit.particle).toBe('hkl');
    expect(map.types.falling_dust.particle).toBe('hkw');
    expect(map.types.sweep_attack.particle).toBe('hkd');
    expect(map.types.block_marker.particle).toBe('hkf');
    expect(map.types.reverse_portal.particle).toBe('hma');
    // 2026-09-29 批次 B：dripping 系 6 型 → hkn 族（hang 链构造器/tick 与 26.2
    // DripParticle$DripHang/CoolingDripHang 一致：gravity·0.02f、lifetime 40、
    // 到期 addParticle 继承、postMove 三轴 ×0.02d；冷却色 16/(40-age+16)、
    // 4/(40-age+8) 同式；14 个 provider 覆写常量逐一一致）
    expect(map.types.dripping_dripstone_lava.particle).toBe('hkn$a');
    expect(map.types.dripping_lava.particle).toBe('hkn$a');
    expect(map.types.dripping_dripstone_water.particle).toBe('hkn$b');
    expect(map.types.dripping_water.particle).toBe('hkn$b');
    expect(map.types.dripping_honey.particle).toBe('hkn$b');
    expect(map.types.dripping_obsidian_tear.particle).toBe('hkn$b');
    // 2026-09-29 批次 C：landing 系 3 型 → hkn$c（构造器 16.0d 寿命同式、
    // 3 个 provider 覆写常量与 26.2 LavaLand/HoneyLand/ObsidianTearLand 一致）
    expect(map.types.landing_lava.particle).toBe('hkn$c');
    expect(map.types.landing_honey.particle).toBe('hkn$c');
    expect(map.types.landing_obsidian_tear.particle).toBe('hkn$c');
    // 2026-09-29 批次 D：falling 系 8 型 → hkn 族（hkn$j/i/k/d ≡ 26.2
    // FallingParticle/FallAndLand/HoneyFallAndLand/DripstoneFallAndLand、
    // 8 个 provider 覆写常量逐一一致）
    expect(map.types.falling_lava.particle).toBe('hkn$i');
    expect(map.types.falling_water.particle).toBe('hkn$i');
    expect(map.types.falling_obsidian_tear.particle).toBe('hkn$i');
    expect(map.types.falling_dripstone_lava.particle).toBe('hkn$d');
    expect(map.types.falling_dripstone_water.particle).toBe('hkn$d');
    expect(map.types.falling_honey.particle).toBe('hkn$k');
    expect(map.types.falling_nectar.particle).toBe('hkn$j');
    expect(map.types.falling_spore_blossom.particle).toBe('hkn$j');
    // 2026-09-29 批次 E：RisingParticle 系（hmb ≡ RisingParticle、
    // hla ≡ FlameParticle、hmk ≡ SoulParticle）+ GlowParticle 系
    // （hld ≡ GlowParticle，7 个 provider 覆写常量逐一一致）+
    // glow_squid_ink/squid_ink → hmp（≡ SquidInkParticle：friction 0.92f、
    // 无物理、isAir 时 yd −= 0.0074d、provider hmp$a ≡ GlowInkProvider
    // colorFromFloat(1,0.2,0.8)、hmp$b ≡ Provider 黑色，两侧一致）
    expect(map.types.flame.particle).toBe('hla');
    expect(map.types.small_flame.particle).toBe('hla');
    expect(map.types.copper_fire_flame.particle).toBe('hla');
    expect(map.types.soul_fire_flame.particle).toBe('hla');
    expect(map.types.soul.particle).toBe('hmk');
    expect(map.types.sculk_soul.particle).toBe('hmk');
    expect(map.types.glow.particle).toBe('hld');
    expect(map.types.glow_squid_ink.particle).toBe('hmp');
    expect(map.types.electric_spark.particle).toBe('hld');
    expect(map.types.scrape.particle).toBe('hld');
    expect(map.types.wax_off.particle).toBe('hld');
    expect(map.types.wax_on.particle).toBe('hld');
    expect(map.types.squid_ink.particle).toBe('hmp');
    // 2026-09-29 批次 F：smoke/ash 系 → hke 族（hke ≡ BaseAshSmokeParticle
    // 构造器/tick/尺寸与 26.2 逐指令一致，5 个 provider 覆写常量逐一一致）
    // + block 系 → hms（≡ TerrainParticle：gravity 1.0f 显式、颜色 0.6f×3
    // 乘 tint、uo/vo = nextFloat·3.0f、getU/V0/1 四式同式；3 个 provider
    // 与 26.2 TerrainParticle 系逐一一致）+ dust_pillar 追加（hms$b ≡
    // TerrainParticle$Provider 随 block 系逐指令核对一致）
    expect(map.types.smoke.particle).toBe('hmh');
    expect(map.types.white_smoke.particle).toBe('hnc');
    expect(map.types.large_smoke.particle).toBe('hll');
    expect(map.types.ash.particle).toBe('hkc');
    expect(map.types.white_ash.particle).toBe('hnb');
    expect(map.types.block.particle).toBe('hms');
    expect(map.types.block_crumble.particle).toBe('hms');
    expect(map.types.dust_pillar.particle).toBe('hms');
    // 2026-09-29 批次 G：SuspendedTown 族 5 型 → hmr（≡ SuspendedTownParticle：
    // 颜色 nextFloat·0.1f+0.2f、setSize 0.02f²、quadSize ×= nextFloat·0.6f+0.5f、
    // 三轴 ×0.02d、寿命 (int)(20.0d/(F·0.8d+0.2d)) 同式、tick 自管 ×0.99d；
    // 5 个 provider 覆写与 26.2 对应 provider 逐一一致）
    expect(map.types.composter.particle).toBe('hmr');
    expect(map.types.dolphin.particle).toBe('hmr');
    expect(map.types.egg_crack.particle).toBe('hmr');
    expect(map.types.happy_villager.particle).toBe('hmr');
    expect(map.types.mycelium.particle).toBe('hmr');
    // 2026-09-29 批次 H：item 族 4 型 → hkg（≡ BreakingItemParticle：
    // 初速 ×0.10000000149011612d 后 + 命令速度、gravity 1.0f 显式、quadSize
    // ÷2、uo/vo = nextFloat·3.0f 两次、getU/V0/1 四式同式、getSprite 管道
    // 与缺失态回退两侧一致；4 个 provider 与 26.2 BreakingItemParticle 系
    // 逐一一致（cobweb/slime_ball/snowball 固定项 + item 直接取 item））
    expect(map.types.item.particle).toBe('hkg');
    expect(map.types.item_cobweb.particle).toBe('hkg');
    expect(map.types.item_slime.particle).toBe('hkg');
    expect(map.types.item_snowball.particle).toBe('hkg');
    // 2026-09-29 批次 I：Spell 族 7 型 → hml（≡ SpellParticle：friction
    // 0.96f/gravity −0.1f/speedUpWhenYMotionIsBlocked、yd ×0.20000000298023224d、
    // 零速时 xz ×0.10000000149011612d、尺寸 ×0.75f、寿命 (int)(8.0d/(F·0.8d+0.2d))
    // 同式、无物理、TRANSLUCENT、tick 自管 alpha 0.05f·lerp 衰减+
    // isCloseToScopingPlayer（9.0d/旁观者/非创造）清零；4 个 provider 与 26.2
    // SpellParticle 系逐一一致）
    expect(map.types.effect.particle).toBe('hml');
    expect(map.types.instant_effect.particle).toBe('hml');
    expect(map.types.witch.particle).toBe('hml');
    expect(map.types.entity_effect.particle).toBe('hml');
    expect(map.types.infested.particle).toBe('hml');
    expect(map.types.raid_omen.particle).toBe('hml');
    expect(map.types.trial_omen.particle).toBe('hml');
    // 2026-09-29 批次 J：Suspended 族 4 型 → hmq（≡ SuspendedParticle：
    // 出生 y−0.125d、setSize 0.01f²、quadSize ×= (nextFloat·0.6f+0.2f)、
    // 寿命 (int)(16.0d/(F·0.8d+0.2d)) 同式、无物理、friction fconst_1
    // 显式、gravity fconst_0 显式、OPAQUE；4 个 provider 与 26.2 对应
    // provider 逐一一致）
    expect(map.types.crimson_spore.particle).toBe('hmq');
    expect(map.types.spore_blossom_air.particle).toBe('hmq$b$1');
    expect(map.types.underwater.particle).toBe('hmq');
    expect(map.types.warped_spore.particle).toBe('hmq');
    // 2026-09-29 批次 K1：Heart 族 2 型 → hlg（≡ HeartParticle：
    // speedUpWhenYMotionIsBlocked、friction 0.86f 显式、三轴初速
    // ×0.009999999776482582d、yd 再 +0.1d、quadSize ×1.5f、寿命 16、
    // 无物理、getQuadSize (age+delta)/lifetime·32.0f·clamp 同式；2 个
    // provider 与 26.2 对应 provider 逐一一致）
    expect(map.types.angry_villager.particle).toBe('hlg');
    expect(map.types.heart.particle).toBe('hlg');
    expect(map.verifiedAgainst262).toHaveLength(90);
  });

  it('交叉一致：kinematics 表 1.21.11 分区只含 end_rod（90 类型与 26.2 一致 → 不新增条目，差异优先口径）', () => {
    expect(Object.keys(NATIVE_KINEMATICS['1.21.11'])).toEqual(['end_rod']);
    expect(Object.keys(NATIVE_LIFETIME['1.21.11'])).toEqual(['end_rod']);
    // 已核对一致的类型分两类：84 个在 26.2 分区有表项（常量一致、表内不重复）；
    // current_down/explosion_emitter/gust_emitter_* /firefly 在 26.2 分区亦无表项
    // （世界状态/发射器近似，两版本同一口径）；trail 是引擎元例外（p.trailTarget
    // 分支，两版本均不在表内）
    for (const n of map.verifiedAgainst262) {
      expect(NATIVE_KINEMATICS['1.21.11'][n], n).toBeUndefined();
      if (
        !['current_down', 'explosion_emitter', 'gust_emitter_large', 'gust_emitter_small', 'firefly', 'trail'].includes(n)
      ) {
        expect(NATIVE_KINEMATICS['26.2'][n], `26.2 分区应已收录: ${n}`).toBeDefined();
      }
    }
  });
});
