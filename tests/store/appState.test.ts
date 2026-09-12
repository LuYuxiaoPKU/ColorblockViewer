// M5 store 双向同步（计划 §九）：commands 为唯一真源。
//   改表单 → setCommand → serialize → input 文本更新
//   改粘贴框 → applyInputText（parse）→ 成功写回 commands；失败 commands 不动 + toast

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getState,
  setCommand,
  insertCommandAfter,
  removeCommand,
  setInputText,
  applyInputText,
  setSim,
  makeParameter,
  parameterVariantName,
  DEFAULT_NORMAL,
  DEFAULT_PARAMETER,
  DEFAULT_GROUP_REMOVE,
  DEFAULT_VANILLA,
} from '../../src/store/appState';
import { parseCommands } from '../../src/command/parser';
import { serialize } from '../../src/command/serialize';
import type { ParticleCommand } from '../../src/command/types';

// store 是模块级单例 → 每个用例前重置为可重现状态
function resetStore(): void {
  const fresh = { ...structuredClone(DEFAULT_NORMAL), pos: structuredClone(DEFAULT_NORMAL.pos) };
  setCommand(0, fresh);
  // 清掉其余命令（defaultState 有 2 条）
  while (getState().commands.length > 1) removeCommand(1);
  setSim({ playerPos: { x: 0, y: 0, z: 0 }, defaultLifetime: 20, maxParticles: 20000, seed: 1, mcVersion: '26.2', gridSize: 10, gridVisible: true, nativeKinematics: false });
}

beforeEach(resetStore);

describe('表单 → 文本（serialize 派生）', () => {
  it('改表单字段 → input 文本同步更新', () => {
    const c = { ...structuredClone(DEFAULT_NORMAL), count: 1234 };
    setCommand(0, c);
    expect(getState().input).toContain('1234');
    expect(parseCommands(getState().input)[0].kind).toBe('normal');
  });

  it('改表达式字段 → 按 brigadier 未加引号字符集决定是否加单引号', () => {
    const c = { ...structuredClone(DEFAULT_NORMAL), speedExpression: 'x=1;y=2' };
    setCommand(0, c);
    // ';' '=' 不在未加引号字符集（0-9 A-Z a-z _ - . +）内 → 游戏内必须加引号
    expect(getState().input).toContain("'x=1;y=2'");
    const c2 = { ...c, speedExpression: 'x = 1' };
    setCommand(0, c2);
    expect(getState().input).toContain("'x = 1'"); // 空格同样需要引号
    const c3 = { ...c, speedExpression: 'x_1.plus-2' };
    setCommand(0, c3);
    expect(getState().input).toContain(' x_1.plus-2 '); // 全在集合内 → 裸写
  });

  it('replace 命令 kind → 文本变体名正确', () => {
    setCommand(0, makeParameter('tickpolarparameter'));
    expect(getState().input).toContain('particleex tickpolarparameter');
    setCommand(0, makeParameter('rgbaparameter'));
    expect(getState().input).toContain('particleex rgbaparameter');
  });

  it('vanilla 命令 → 文本为原版形式（无 particleex 前缀，带 / 前缀）', () => {
    setCommand(0, { ...structuredClone(DEFAULT_VANILLA), name: 'smoke' });
    expect(getState().input).toBe('/particle smoke');
  });
});

describe('文本 → 表单（parse 写回）', () => {
  it('合法粘贴 → commands 更新且文本重新对齐', () => {
    setInputText('particleex normal flame 0 0 0 1 0 0 1 0 0 0 0 0 0 5\nparticleex clearparticle\n');
    const err = applyInputText();
    expect(err).toBeNull();
    const cmds = getState().commands;
    expect(cmds.length).toBe(2);
    expect(cmds[0].kind).toBe('normal');
    expect((cmds[0] as typeof DEFAULT_NORMAL).count).toBe(5);
    expect(cmds[1].kind).toBe('clearparticle');
    // 文本重新对齐（canonical 序列化）
    expect(getState().input).toBe(cmds.map(serialize).join('\n'));
  });

  it('无法结构化的行 → commands 不动 + toast 错误', () => {
    const before = getState().commands;
    setInputText('particleex normal flame 0 0 0\n'); // 缺参数
    const err = applyInputText();
    expect(err).not.toBeNull();
    expect(err).toMatch(/用法/);
    expect(getState().commands).toEqual(before);
    expect(getState().toasts.length).toBeGreaterThan(0);
  });

  it('粘贴 8 变体 parameter → 结构标志正确', () => {
    setInputText(
      'particleex tickpolarparameter flame 0 0 0 1 0 0 1 0 0 0 0 6.28 "x=dis*cos(s2)*cos(s1),y=dis*sin(s2)" 0.5 3 0 null 1 null',
    );
    expect(applyInputText()).toBeNull();
    const c = getState().commands[0];
    expect(c.kind).toBe('parameter');
    if (c.kind === 'parameter') {
      expect(c.polar).toBe(true);
      expect(c.tick).toBe(true);
      expect(c.rgba).toBe(false);
      expect(c.cpt).toBe(3);
      expect(parameterVariantName(c)).toBe('tickpolarparameter');
    }
  });

  it('group remove 粘贴 → 结构正确', () => {
    setInputText('particleex group remove g1\n');
    expect(applyInputText()).toBeNull();
    const c = getState().commands[0];
    expect(c.kind).toBe('group');
    expect(JSON.stringify(c)).toBe(JSON.stringify({ ...DEFAULT_GROUP_REMOVE, expression: null, pos: null }));
  });
});

describe('列表操作', () => {
  it('insert/remove 保持真源一致（文本始终对齐）', () => {
    const before = getState().commands.length;
    insertCommandAfter(0, makeParameter('parameter'));
    expect(getState().commands.length).toBe(before + 1);
    expect(getState().input).toBe(getState().commands.map(serialize).join('\n'));
    removeCommand(1);
    expect(getState().commands.length).toBe(before);
    expect(getState().input).toBe(getState().commands.map(serialize).join('\n'));
  });

  it('setSim 合并 patch', () => {
    setSim({ maxParticles: 5000 });
    expect(getState().sim.maxParticles).toBe(5000);
    expect(getState().sim.defaultLifetime).toBe(20); // 未动字段保留
    setSim({ playerPos: { x: 1, y: 2, z: 3 } });
    expect(getState().sim.playerPos).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('round-trip：表单默认值 → serialize → parse → 结构等价', () => {
  const cases: { label: string; c: ParticleCommand }[] = [
    { label: 'normal', c: structuredClone(DEFAULT_NORMAL) },
    { label: 'parameter', c: structuredClone(DEFAULT_PARAMETER) },
    { label: 'rgbatickpolarparameter', c: makeParameter('rgbatickpolarparameter') },
    { label: 'group remove', c: structuredClone(DEFAULT_GROUP_REMOVE) },
    { label: 'vanilla', c: structuredClone(DEFAULT_VANILLA) },
  ];
  for (const { label, c } of cases) {
    it(label, () => {
      const reparsed = parseCommands(serialize(c))[0];
      expect(reparsed).toEqual(c);
    });
  }
});
