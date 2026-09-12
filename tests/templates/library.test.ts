// 模板库守护测试：每条模板都必须「能解析 + 游戏内格式合法 + 引擎实跑零错误」。
//
// 这条测试是模板页面的质量闸门：模板是直接给用户复制进游戏的东西，一旦有人
// 加了 `(` 未加引号的表达式、写错参数个数、或用了不存在的类型，这里立刻红。

import { describe, it, expect } from 'vitest';
import { TEMPLATES, templateById, templateText } from '../../src/templates/library';
import { parseCommands } from '../../src/command/parser';
import { serialize } from '../../src/command/serialize';
import { checkCommandsFormat } from '../../src/command/gameFormat';
import { SimEngine } from '../../src/sim/engine';
import { getState } from '../../src/store/appState';

function engine(): SimEngine {
  // 用站点默认配置（playerPos 等齐全；`~` 坐标解析需要）
  return new SimEngine({ ...getState().sim, seed: 1, nativeKinematics: true, mcVersion: '26.2' });
}

describe('模板库：结构', () => {
  it('非空、id 唯一、字段齐全', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(10);
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TEMPLATES) {
      expect(t.name.trim(), t.id).not.toBe('');
      expect(t.desc.trim(), t.id).not.toBe('');
      expect(t.tags.length, t.id).toBeGreaterThan(0);
      expect(t.cmds.length, t.id).toBeGreaterThan(0);
      for (const c of t.cmds) expect(c.trim(), t.id).not.toBe('');
    }
    expect(templateById('ripple')?.name).toBeTruthy();
    expect(templateById('nope')).toBeUndefined();
  });

  it('模板命令文本 = 逐行拼接（复制按钮的内容）', () => {
    const t = TEMPLATES[2];
    expect(templateText(t)).toBe(t.cmds.join('\n'));
  });
});

describe('模板库：格式与解析（质量闸门）', () => {
  for (const t of TEMPLATES) {
    it(`${t.id}：游戏内格式合法（引号按 brigadier 规则）`, () => {
      expect(checkCommandsFormat(templateText(t))).toEqual([]);
    });

    it(`${t.id}：可被解析器结构化 + 回显稳定（parse→serialize→parse 不变）`, () => {
      const cmds = parseCommands(templateText(t));
      expect(cmds).toHaveLength(t.cmds.length);
      const round = parseCommands(cmds.map(serialize).join('\n'));
      expect(round).toEqual(cmds);
    });

    it(`${t.id}：引擎实跑零错误、有粒子生成`, () => {
      const en = engine();
      let spawned = 0;
      for (const c of parseCommands(templateText(t))) {
        const r = en.runCommand(c);
        expect(r.errors, `${t.id}: ${r.errors.join(' / ')}`).toEqual([]);
        spawned += r.spawned;
      }
      expect(spawned, t.id).toBeGreaterThan(0);
      for (let i = 0; i < 10; i++) en.tickOnce();
      expect(en.tickErrors, t.id).toEqual([]);
      expect(en.aliveCount, t.id).toBeGreaterThan(0);
    });
  }
});
