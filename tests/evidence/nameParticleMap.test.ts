// 1.21.11 混淆版粒子类型映射取证文件（docs/evidence/name_particle_map_1.21.11.json）
// 完整性锁：115 注册表类型全覆盖、字段完备、与 kinematics 表 1.21.11 分区交叉一致。
// 取证来源：Mojang 官方 1.21.11 client.jar（全混淆）逐类 javap -c -p；
// 构造器调用逐条对 provider dump 核验（112 个 `<init>` + 3 个 static-factory `hms.a`，
// 与 how 字段一致，2026-09-25）。115 个非默认运动学类型已逐字节码与 26.2 比对一致
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
// （hmq 族）+ 批次 K1 2 个 2026-09-29：Heart 族（hlg 族）+ 批次 K2 3 个
// 2026-09-29：bubble 系（hki/hkh/hkj）+ 批次 K3 2 个 2026-09-29：
// PlayerCloud 族（hlx 族）+ 批次 K4 2 个 2026-09-29：SculkCharge 族
// （hmc/hmd）+ 批次 K5 6 个 2026-09-29：
// lava/note/spit/splash/totem_of_undying/shriek（hlm/hlp/hmm/hmn/hmt/hme）
// + 批次 K6 11 个 2026-09-29：
// ominous_spawning/enchant/nautilus/vault_connection/dragon_breath/dust_plume/
// elder_guardian/vibration/firework/flash/fishing
// （hlb/hlc×3/hkm/hkr/hks/hmx/hkz$c/hkz$b/hmy）
// + 批次 K7 1 个 2026-09-29：end_rod（hku））
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

  it('115 个已核对一致类型的粒子类与 javap 抽样核验一致', () => {
    // 2026-09-29 批次 K7：end_rod → hku（≡ EndRodParticle：构造器
    // hmf.<init>(…, 0.0125f) ≡ SimpleAnimatedParticle.<init>(…, 0.0125f)、
    // 基类 friction 0.91f 同源、三轴速度直传、quadSize ×0.75f、
    // 寿命 60+nextInt(12)、颜色 15916745（c(I) ≡ setFadeColor(I)）、
    // 构造器末 setSpriteFromAge、move = AABB.move+setBoundingBox+
    // setLocationFromBoundingbox、hku$a 直传一致）
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
    // 2026-09-29 批次 K2：bubble 系 3 型 → hki/hkh/hkj（≡ BubbleParticle/
    // BubbleColumnUpParticle/BubblePopParticle：setSize 0.02f² 与初速
    // ×0.20000000298023224d 同式；bubble tick 自管 yd += 0.002d+三轴
    // ×0.85d+水内检查、column_up gravity −0.125f/friction 0.85f 显式+
    // 寿命 40 同式、pop lifetime 4 固定+gravity 0.008f 字段+基类
    // hmg.a(hmo) 与 26.2 setSpriteFromAge 同式；3 个 provider 与 26.2 对应
    // provider 逐一一致）
    expect(map.types.bubble.particle).toBe('hki');
    expect(map.types.bubble_column_up.particle).toBe('hkh');
    expect(map.types.bubble_pop.particle).toBe('hkj');
    // 2026-09-29 批次 K3：PlayerCloud 族 2 型 → hlx（≡ PlayerCloudParticle：
    // friction 0.96f 显式、sprite first 出生、三轴初速 ×0.1d 后 + 命令速度、
    // 颜色 1.0f−nextFloat·0.3f 三轴同值、quadSize ×1.875f、寿命
    // (int)Math.max((int)(8.0d/(F·0.8d+0.3d))·2.5f,1.0f) 同式、无物理、
    // TRANSLUCENT、tick = super.tick+setSpriteFromAge+2.0d 半径内最近玩家
    // y 高时 y/yd ×(1+0.2d) 修正；2 个 provider 与 26.2 对应 provider
    // 逐一一致）
    expect(map.types.cloud.particle).toBe('hlx');
    expect(map.types.sneeze.particle).toBe('hlx');
    // 2026-09-29 批次 K4：SculkCharge 族 2 型 → hmc/hmd（≡ SculkCharge/
    // SculkChargePopParticle：同构——初速直传+sprite first 出生+friction
    // 0.96f 显式、scale 1.5f/1.0f、无物理、TRANSLUCENT、getLightCoords
    // 覆写 super+withBlock(15)、tick = super.tick+setSpriteFromAge；2 个
    // Record provider 与 26.2 对应 provider 逐一一致：charge setLifetime
    // (nextInt(12)+8)+oRoll/roll 取选项、pop setLifetime (nextInt(4)+6)）
    expect(map.types.sculk_charge.particle).toBe('hmc');
    expect(map.types.sculk_charge_pop.particle).toBe('hmd');
    // 2026-09-29 批次 K5：lava/note/spit/splash/totem_of_undying/shriek →
    // hlm/hlp/hmm/hmn/hmt/hme（hlm ≡ LavaParticle：gravity 0.75f/friction
    // 0.999f 显式、三轴 ×0.800000011920929d 后 yd = nextFloat·0.4f+0.05f、
    // 寿命 16 同式、tick 派生 SMOKE 同式；hlp ≡ NoteParticle：friction 0.66f
    // 显式、三轴 ×0.009999999776482582d 后 yd +0.2d、颜色 sin 三轴同式、
    // 寿命 6；hmm ≡ SpitParticle：基类 hkv（≡ ExplodeParticle）+gravity 0.5f
    // 显式；hmn ≡ SplashParticle：基类 hna（≡ WaterDropParticle）+gravity
    // 0.04f 显式+vy==0 且 (vx!=0 或 vz!=0) 时 (vx,0.1d,vz) 覆写；hmt ≡
    // TotemParticle：基类 hmf
    // （≡ SimpleAnimatedParticle）+1.25f+friction 0.6f+寿命 60+nextInt(12)+
    // 颜色 nextInt(4) 分支同式；hme ≡ ShriekParticle：quadSize 0.85f/delay
    // 选项/寿命 30/gravity 0f 显式/初速 (0,0.1d,0)/extract 双四边旋转同式；
    // 6 个 provider 与 26.2 对应 provider 逐一一致）
    expect(map.types.lava.particle).toBe('hlm');
    expect(map.types.note.particle).toBe('hlp');
    expect(map.types.spit.particle).toBe('hmm');
    expect(map.types.splash.particle).toBe('hmn');
    expect(map.types.totem_of_undying.particle).toBe('hmt');
    expect(map.types.shriek.particle).toBe('hme');
    // 2026-09-29 批次 K6：ominous_spawning → hlb（≡ FlyStraightTowardsParticle：
    // 零速、hasPhysics=false、寿命 (int)(nextFloat·5.0f)+25、位置式 tick
    // srgbLerp 同式、withBlock(15)、provider scale randomBetween(3,5)）；
    // enchant/nautilus/vault_connection 共用 hlc（≡ FlyTowardsPositionParticle：
    // 位置式 tick y 带 −1.2f·f2d(t⁴)、发光?withBlock(15):addSmoothBlockEmission
    // (t⁴)、hlc$c = true+LifetimeAlpha(0.0f,0.6f,0.25f,1.0f)+scale 1.5f）；
    // dragon_breath → hkm（≡ DragonBreathParticle：friction 0.96f、寿命
    // (int)(20.0d/(F·0.8d+0.2d))、落体 yd += 0.002d+move 后 xz ×1.1d/×f2d(0.96f)、
    // hkm$a setPower）；dust_plume → hkr（≡ DustPlumeParticle：hke 15 参
    // dx+0.15000000596046448d、颜色 ARGB(12235202)/255f−nextFloat·0.2f、
    // tick gravity×0.88f+friction×0.92f）；elder_guardian → hks（≡
    // ElderGuardianParticle：直接继承 hlq、entityTranslucent+Guardian 模型、
    // gravity fconst_0、lifetime 30）；vibration → hmx（≡ VibrationSignalParticle：
    // rot/pitch = atan2 同式、tick t = 1.0d/(lifetime−age) 三轴 Mth.lerp 归位、
    // 双四边 rotateX(−t6)/rotateX(t6)）；firework → hkz$c（≡ SparkParticle：
    // 寿命 48+nextInt(12)、extract 跳过 (age+lifetime)/3%2==0、tick trail 派生
    // 新 Spark age = lifetime/2）；flash → hkz$b（≡ OverlayParticle：lifetime 4、
    // alpha = 0.6f−((age+delta)−1.0f)·0.25f·0.5f、7.1f·sin 尺寸）；fishing → hmy
    // （≡ WakeParticle：×0.30000001192092896d 两轴+yd = nextFloat·0.2f+0.1f、
    // 寿命 (int)(8.0d/(F·0.8d+0.2d))、gravity fconst_0、tick istore_1 = 60−lifetime、
    // 三轴 ×0.9800000190734863d、sprites.get(istore_1%4, 4)）；11 个 provider
    // 与 26.2 对应 provider 逐一一致
    expect(map.types.ominous_spawning.particle).toBe('hlb');
    expect(map.types.enchant.particle).toBe('hlc');
    expect(map.types.nautilus.particle).toBe('hlc');
    expect(map.types.vault_connection.particle).toBe('hlc');
    expect(map.types.dragon_breath.particle).toBe('hkm');
    expect(map.types.dust_plume.particle).toBe('hkr');
    expect(map.types.elder_guardian.particle).toBe('hks');
    expect(map.types.vibration.particle).toBe('hmx');
    expect(map.types.firework.particle).toBe('hkz$c');
    expect(map.types.flash.particle).toBe('hkz$b');
    expect(map.types.fishing.particle).toBe('hmy');
    expect(map.verifiedAgainst262).toHaveLength(115);
  });

  it('交叉一致：kinematics 表 1.21.11 分区只含 end_rod（115 类型与 26.2 逐字节码一致 → 差异优先口径；end_rod 唯一表项为引擎 motion 自管口径，非版本差异）', () => {
    expect(Object.keys(NATIVE_KINEMATICS['1.21.11'])).toEqual(['end_rod']);
    expect(Object.keys(NATIVE_LIFETIME['1.21.11'])).toEqual(['end_rod']);
    // 已核对一致的类型分两类：109 个在 26.2 分区有表项（常量一致、表内不重复）；
    // current_down/explosion_emitter/gust_emitter_* /firefly 在 26.2 分区亦无表项
    // （世界状态/发射器近似，两版本同一口径）；trail 是引擎元例外（p.trailTarget
    // 分支，两版本均不在表内）；end_rod 是 1.21.11 分区唯一表项（26.2 分区同有，
    // 常量 0.91f/0.0125f 两侧同源）
    for (const n of map.verifiedAgainst262) {
      if (n === 'end_rod') {
        expect(NATIVE_KINEMATICS['1.21.11']['end_rod']).toStrictEqual({
          friction: 0.9100000262260437,
          gravityY: -0.0005000000074505806,
        });
        continue;
      }
      expect(NATIVE_KINEMATICS['1.21.11'][n], n).toBeUndefined();
      if (
        !['current_down', 'explosion_emitter', 'gust_emitter_large', 'gust_emitter_small', 'firefly', 'trail'].includes(n)
      ) {
        expect(NATIVE_KINEMATICS['26.2'][n], `26.2 分区应已收录: ${n}`).toBeDefined();
      }
    }
  });
});
