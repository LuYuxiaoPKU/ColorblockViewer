// store（极简版）：单一输入路径——粘贴框文本 → applyInputText（parse）→
// commands 唯一真源，文本是派生（serializeAll）。没有表单编辑路径。

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getState,
  replaceCommands,
  setInputText,
  applyInputText,
  setSim,
  loadShared,
  setPlaying,
  setSpeed,
  setHud,
  pushToast,
  clearToasts,
} from '../../src/store/appState';
import { parseCommands } from '../../src/command/parser';
import { serialize } from '../../src/command/serialize';

const SIM_BASE = { playerPos: { x: 0, y: 0, z: 0 }, defaultLifetime: 20, maxParticles: 20000, seed: 1, mcVersion: '26.2', gridSize: 10, gridVisible: true, nativeKinematics: false };

// store 是模块级单例 → 每个用例前重置为可重现状态
function resetStore(): void {
  replaceCommands([]);
  setInputText('');
  setSim(SIM_BASE);
  setPlaying(false);
  setSpeed(1);
  setHud({ tick: 0, count: 0, dropped: 0 });
  clearToasts();
}

beforeEach(resetStore);

describe('文本 → 真源（applyInputText）', () => {
  it('合法粘贴 → commands 更新且文本重新对齐', () => {
    setInputText('particleex normal flame 0 0 0 1 0 0 1 0 0 0 0 0 0 5\nparticleex clearparticle\n');
    const err = applyInputText();
    expect(err).toBeNull();
    const cmds = getState().commands;
    expect(cmds.length).toBe(2);
    expect(cmds[0].kind).toBe('normal');
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

  it('缺引号表达式粘贴 → 真源保留表达式 + 文本回显按 brigadier 补单引号', () => {
    const head = 'particleex conditional minecraft:end_rod ~ ~ ~ 1 0.95 0.89 1 0 0 0 8 0.6 8 ';
    const tail = ' 0.1 200 vy=0.05 1 null';
    setInputText(head + '(abs(y-0.5)<0.05)&(sqrt(x^2+z^2)<8)' + tail);
    expect(applyInputText()).toBeNull();
    expect(getState().input).toContain("'(abs(y-0.5)<0.05)&(sqrt(x^2+z^2)<8)'");
    expect(getState().input).toContain("'vy=0.05'");
    const c = getState().commands[0];
    expect(c.kind).toBe('conditional');
    if (c.kind === 'conditional') {
      expect(c.expression).toBe('(abs(y-0.5)<0.05)&(sqrt(x^2+z^2)<8)');
    }
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
    }
  });

  it('原版 /particle 粘贴 → vanilla 结构正确（~ 相对坐标）', () => {
    setInputText('particle heart ~ ~1 ~\n');
    expect(applyInputText()).toBeNull();
    const c = getState().commands[0];
    expect(c.kind).toBe('vanilla');
    if (c.kind === 'vanilla') {
      expect(c.name).toBe('heart');
      expect(c.pos).toEqual({ x: { v: 0, rel: true }, y: { v: 1, rel: true }, z: { v: 0, rel: true } });
    }
  });
});

describe('replaceCommands（模板「载入并执行」/ 一键清空）', () => {
  it('整体替换并重新派生文本（不叠加旧命令）', () => {
    replaceCommands(parseCommands('particleex normal flame 0 0 0 1 0 0 1 0 0 0 0 0 0 5\n'));
    const cmds = parseCommands('/particle smoke\n');
    replaceCommands(cmds);
    expect(getState().commands).toHaveLength(1);
    expect(getState().commands[0]).toEqual(cmds[0]);
    expect(getState().input).not.toContain('normal'); // 旧命令不再残留
    expect(parseCommands(getState().input)).toEqual(cmds); // 文本 ↔ 真源一致
  });

  it('空列表 = 一键清空（文本变空）', () => {
    replaceCommands(parseCommands('particleex normal flame 0 0 0 1 0 0 1 0 0 0 0 0 0 5\n'));
    replaceCommands([]);
    expect(getState().commands).toEqual([]);
    expect(getState().input).toBe('');
  });
});

describe('loadShared（?s= 分享链接还原）', () => {
  it('命令 + 设置合并进真源（sim 与当前状态合并）', () => {
    const cmds = parseCommands('particleex normal flame 0 0 0 1 0 0 1 0 0 0 0 0 0 9\n');
    loadShared({ commands: cmds, sim: { ...SIM_BASE, defaultLifetime: 7 } });
    expect(getState().commands).toEqual(cmds);
    expect(getState().input).toBe(cmds.map(serialize).join('\n'));
    expect(getState().sim.defaultLifetime).toBe(7);
    expect(getState().sim.maxParticles).toBe(20000);
  });
});

describe('其余更新函数', () => {
  it('setSim 合并 patch（未动字段保留）', () => {
    setSim({ maxParticles: 5000 });
    expect(getState().sim.maxParticles).toBe(5000);
    expect(getState().sim.defaultLifetime).toBe(20);
    setSim({ playerPos: { x: 1, y: 2, z: 3 } });
    expect(getState().sim.playerPos).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('setPlaying / setSpeed 镜像', () => {
    setPlaying(true);
    expect(getState().playing).toBe(true);
    setSpeed(4);
    expect(getState().speed).toBe(4);
  });

  it('setHud 相同值不触发更新；pushToast 截断到最近 5 条', () => {
    const before = getState();
    setHud({ tick: 0, count: 0, dropped: 0 });
    expect(getState()).toBe(before); // 无变化 → 不产生新对象
    for (let i = 0; i < 7; i++) pushToast('e' + i);
    expect(getState().toasts).toEqual(['e2', 'e3', 'e4', 'e5', 'e6']);
  });
});
