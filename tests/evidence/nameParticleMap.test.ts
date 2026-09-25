// 1.21.11 混淆版粒子类型映射取证文件（docs/evidence/name_particle_map_1.21.11.json）
// 完整性锁：115 注册表类型全覆盖、字段完备、与 kinematics 表 1.21.11 分区交叉一致。
// 取证来源：Mojang 官方 1.21.11 client.jar（全混淆）逐类 javap -c -p；
// 构造器调用逐条对 provider dump 核验（112 个 `<init>` + 3 个 static-factory `hms.a`，
// 与 how 字段一致，2026-09-25）。13 个非默认运动学类型已逐字节码与 26.2 比对一致
// → kinematics 表 1.21.11 分区按"差异优先"口径不新增条目（见 kinematics.ts 版本分区注释）。

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
      // friction/gravity = "<float>@" 前缀（如 "0.98f@hlg.hlq-base"，@ 后为来源类.字段路径）
      expect(v.friction, n).toMatch(/^\d+(\.\d+)?f@/);
      expect(v.gravity, n).toMatch(/^\d+(\.\d+)?f@/);
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

  it('13 个已核对一致类型 + end_rod 的粒子类与 2026-09-25 javap 抽样核验一致', () => {
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
    expect(map.verifiedAgainst262).toHaveLength(13);
  });

  it('交叉一致：kinematics 表 1.21.11 分区只含 end_rod（13 类型与 26.2 一致 → 不新增条目，差异优先口径）', () => {
    expect(Object.keys(NATIVE_KINEMATICS['1.21.11'])).toEqual(['end_rod']);
    expect(Object.keys(NATIVE_LIFETIME['1.21.11'])).toEqual(['end_rod']);
    // 13 个已核对类型在 1.21.11 分区无表项 = 走 26.2 一致的常量（表内不重复）
    for (const n of map.verifiedAgainst262) {
      expect(NATIVE_KINEMATICS['1.21.11'][n], n).toBeUndefined();
      expect(NATIVE_KINEMATICS['26.2'][n], `26.2 分区应已收录: ${n}`).toBeDefined();
    }
  });
});
