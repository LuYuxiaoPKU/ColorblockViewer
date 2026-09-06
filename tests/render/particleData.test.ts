// particleData（生成文件）完整性单测：版本分区条目存在、类型全集 ⊇ 帧表键、
// 'type' 前缀不是类型名、两版本共有核心类型。
// 生成脚本：scripts/gen-particle-assets.mjs（按 piston-meta sha1 校验的官方 client jar）。

import { describe, expect, it } from 'vitest';
import { PARTICLE_DATA } from '../../src/render/particleData';
import { textureFor, particleVersionData } from '../../src/render/points';

describe('particleData 版本分区', () => {
  it('两版本条目存在且非空', () => {
    expect(PARTICLE_DATA['26.2']).toBeTruthy();
    expect(PARTICLE_DATA['1.21.11']).toBeTruthy();
    for (const v of ['26.2', '1.21.11']) {
      expect(PARTICLE_DATA[v].types.length).toBeGreaterThanOrEqual(100);
      expect(Object.keys(PARTICLE_DATA[v].frames).length).toBeGreaterThanOrEqual(80);
    }
  });

  it('类型全集 ⊇ 帧表键（有帧的类型必在全集里）', () => {
    for (const v of ['26.2', '1.21.11']) {
      const set = new Set(PARTICLE_DATA[v].types);
      for (const k of Object.keys(PARTICLE_DATA[v].frames)) expect(set.has(k)).toBe(true);
    }
  });

  it("'type' 是 type{NBT} 复合语法前缀、不是类型名（两版本均排除）", () => {
    for (const v of ['26.2', '1.21.11']) {
      expect(PARTICLE_DATA[v].types).not.toContain('type');
    }
  });

  it('核心类型两版本共有；26.2 独有项存在（注册表随版本增长）', () => {
    const a = new Set(PARTICLE_DATA['1.21.11'].types);
    const b = new Set(PARTICLE_DATA['26.2'].types);
    for (const t of ['flame', 'smoke', 'end_rod', 'heart', 'block', 'dust', 'item']) {
      expect(a.has(t), `1.21.11 缺 ${t}`).toBe(true);
      expect(b.has(t), `26.2 缺 ${t}`).toBe(true);
    }
    // 26.2 注册表比 1.21.11 多（如 noxious_gas_cloud 为新版内置）
    expect(b.size).toBeGreaterThan(a.size);
  });

  it('粒子名归一化后按版本查帧表；未知版本回退 undefined 由 textureFor 兜底 null', () => {
    expect(textureFor('minecraft:Smoke', '1.21.11')?.length).toBeGreaterThan(0);
    expect(textureFor('end_rod', '1.21.11')?.length).toBeGreaterThan(0);
    expect(particleVersionData('9.9.9')).toBeUndefined();
    expect(textureFor('flame', '9.9.9')).toBeNull();
  });
});
