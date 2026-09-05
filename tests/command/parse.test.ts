import { describe, it, expect } from 'vitest';
import { parseCommand, parseCommands } from '../../src/command/parser';
import { serialize } from '../../src/command/serialize';
import { CommandParseError } from '../../src/command/tokens';
import type { ParticleCommand, NormalCmd, ParameterCmd } from '../../src/command/types';

const P = parseCommand;

describe('前缀与多行', () => {
  it('/particleex 前缀可去可不去', () => {
    expect(P('particleex clearparticle').kind).toBe('clearparticle');
    expect(P('/particleex clearparticle').kind).toBe('clearparticle');
    expect(P('  /particleex   clearparticle  ').kind).toBe('clearparticle');
  });

  it('多行：跳过空行与 # 注释', () => {
    const cmds = parseCommands('/particleex clearparticle\n\n# 注释行\nparticleex clearparticle');
    expect(cmds).toHaveLength(2);
    expect(cmds.every((c) => c.kind === 'clearparticle')).toBe(true);
  });

  it('未知子命令报错', () => {
    expect(() => P('particleex frobnicate')).toThrow(CommandParseError);
    expect(() => P('particleex frobnicate')).toThrow(/未知子命令/);
  });
});

describe('normal', () => {
  const full = 'particleex normal minecraft:heart 1 2 3 1 0 0 1 0 0.1 0 0.5 0 0.5 50 20 "vy=0.1" 2 g1|g2';
  it('全参数', () => {
    const c = P(full) as NormalCmd;
    expect(c).toMatchObject({
      kind: 'normal', name: 'minecraft:heart',
      pos: { x: { v: 1, rel: false }, y: { v: 2, rel: false }, z: { v: 3, rel: false } },
      color: { r: 1, g: 0, b: 0, a: 1 },
      speed: { x: 0, y: 0.1, z: 0 },
      range: { x: 0.5, y: 0, z: 0.5 },
      count: 50, age: 20, speedExpression: 'vy=0.1', speedStep: 2, group: 'g1|g2',
    });
  });
  it('最简形式取默认 age=0/speedExpression=null/speedStep=1/group=null', () => {
    const c = P('particleex normal flame 0 0 0 1 1 1 1 0 0 0 1 0 1 5') as NormalCmd;
    expect(c.age).toBe(0);
    expect(c.speedExpression).toBeNull();
    expect(c.speedStep).toBe(1);
    expect(c.group).toBeNull();
    expect(c.count).toBe(5);
  });
  it('count < 0 报错', () => {
    expect(() => P('particleex normal flame 0 0 0 1 1 1 1 0 0 0 1 0 1 -1')).toThrow(/count 超出范围/);
  });
  it('age < -1 报错', () => {
    expect(() => P('particleex normal flame 0 0 0 1 1 1 1 0 0 0 1 0 1 5 -2')).toThrow(/age 超出范围/);
  });
  it('缺参数报错带用法', () => {
    expect(() => P('particleex normal flame 0 0 0 1 1 1')).toThrow(/用法：particleex normal/);
  });
  it('参数过多报错', () => {
    // 尾部可选参数写满后仍有多余 token 才触发（前面的多余 token 会被可选参数消耗并报其校验错）
    expect(() => P(`${'particleex normal flame 0 0 0 1 1 1 1 0 0 0 1 0 1 5'} 0 null 1 null extra`)).toThrow(/参数过多/);
  });
});

describe('位置 ~ 相对坐标', () => {
  it('~ / ~n 记 rel', () => {
    const c = P('particleex normal flame ~ ~1.5 ~-2 1 1 1 1 0 0 0 1 0 1 1') as NormalCmd;
    expect(c.pos.x).toEqual({ v: 0, rel: true });
    expect(c.pos.y).toEqual({ v: 1.5, rel: true });
    expect(c.pos.z).toEqual({ v: -2, rel: true });
  });
  it('group 的 pos 也支持 ~', () => {
    const c = P('particleex group remove g "age>3" ~ ~ ~') as Extract<ParticleCommand, { kind: 'group' }>;
    expect(c.sub).toBe('remove');
    expect(c.pos?.x).toEqual({ v: 0, rel: true });
  });
  it('非法坐标报错', () => {
    expect(() => P('particleex normal flame a b c 1 1 1 1 0 0 0 1 0 1 1')).toThrow(/位置/);
  });
});

describe('引号', () => {
  it('表达式含空格 + 引号剥离', () => {
    const c = P('particleex conditional smoke 0 0 0 1 1 1 1 0 0 0 1 0 1 "x,y,z=t,sin(t),cos(t)"') as Extract<ParticleCommand, { kind: 'conditional' }>;
    expect(c.expression).toBe('x,y,z=t,sin(t),cos(t)');
  });
  it('内部转义引号 "" → "', () => {
    const c = P('particleex conditional smoke 0 0 0 1 1 1 1 0 0 0 1 0 1 "a ""b"" c"') as Extract<ParticleCommand, { kind: 'conditional' }>;
    expect(c.expression).toBe('a "b" c');
  });
  it('未闭合引号报错', () => {
    expect(() => P('particleex conditional smoke 0 0 0 1 1 1 1 0 0 0 1 0 1 "x>1')).toThrow(/unterminated/);
  });
});

describe('conditional / parameter 家族', () => {
  it('conditional 的 step 在 age 之前（顺序敏感）', () => {
    const c = P('particleex conditional smoke 0 0 0 1 1 1 1 0 0 0 1 0 1 "y>0" 0.25 5') as Extract<ParticleCommand, { kind: 'conditional' }>;
    expect(c.step).toBe(0.25);
    expect(c.age).toBe(5);
  });
  it('parameter 全参数（非 tick 无 cpt）', () => {
    const c = P('particleex parameter flame 0 0 0 1 0 0 1 0 0 0 0 20 "x,y=t,0" 0.5 30 "vy=0.1" 2 g') as ParameterCmd;
    expect(c.polar).toBe(false);
    expect(c.tick).toBe(false);
    expect(c.rgba).toBe(false);
    expect(c.begin).toBe(0);
    expect(c.end).toBe(20);
    expect(c.expression).toBe('x,y=t,0');
    expect(c.step).toBe(0.5);
    expect(c.cpt).toBe(10); // 非 tick：树内默认 10，仿真不使用
    expect(c.age).toBe(30);
    expect(c.group).toBe('g');
  });
  it('polarparameter 标志', () => {
    const c = P('particleex polarparameter flame 0 0 0 1 1 1 1 0 0 0 0 10 "s1,s2,dis=t*10,t*PI/20,1"') as ParameterCmd;
    expect(c.polar).toBe(true);
    expect(c.color).not.toBeNull();
  });
  it('tickparameter 有 cpt（默认 10）', () => {
    const c = P('particleex tickparameter flame 0 0 0 1 1 1 1 0 0 0 0 10 "x,y=t,0"') as ParameterCmd;
    expect(c.tick).toBe(true);
    expect(c.cpt).toBe(10);
    const c2 = P('particleex tickparameter flame 0 0 0 1 1 1 1 0 0 0 0 10 "x,y=t,0" 0.5 3') as ParameterCmd;
    expect(c2.cpt).toBe(3);
  });
  it('rgbaparameter 无颜色参数', () => {
    const c = P('particleex rgbaparameter flame 0 0 0 0 0.1 0 0 20 "x,y,cr,cg,cb=t,sin(t),1,1,1"') as ParameterCmd;
    expect(c.rgba).toBe(true);
    expect(c.color).toBeNull();
    expect(c.begin).toBe(0);
  });
  it('rgbatickpolarparameter 三标志全开 + cpt', () => {
    const c = P('particleex rgbatickpolarparameter flame 0 0 0 0 0.1 0 0 10 "s1,s2,dis=t*10,t*PI/20,1" 0.2 7') as ParameterCmd;
    expect([c.polar, c.tick, c.rgba]).toEqual([true, true, true]);
    expect(c.cpt).toBe(7);
    expect(c.color).toBeNull();
  });
  it('begin/end 下界 -DBL_MAX，负数可', () => {
    const c = P('particleex parameter flame 0 0 0 1 1 1 1 0 0 0 -5 5 "x=y"') as ParameterCmd;
    expect(c.begin).toBe(-5);
    expect(c.end).toBe(5);
  });
});

describe('group', () => {
  it('group remove 最简（仅组名）', () => {
    const c = P('particleex group remove g1') as Extract<ParticleCommand, { kind: 'group' }>;
    expect(c.sub).toBe('remove');
    expect(c.group).toBe('g1');
    expect(c.expression).toBeNull();
    expect(c.pos).toBeNull();
  });
  it('group remove 表达式 + 位置', () => {
    const c = P('particleex group remove g1 "age>100" 1 2 3') as Extract<ParticleCommand, { kind: 'group' }>;
    expect(c.expression).toBe('age>100');
    expect(c.pos?.x?.v).toBe(1);
  });
  it('group change 两类型', () => {
    const ChangeCmd = { kind: 'group', sub: 'change' } as const;
    const c1 = P('particleex group change parameter g "vy=0.1"') as Extract<ParticleCommand, typeof ChangeCmd>;
    expect(c1.sub).toBe('change');
    expect(c1.type).toBe('parameter');
    expect(c1.expression).toBe('vy=0.1');
    expect(c1.conditionalExpression).toBeNull();
    const c2 = P('particleex group change speedexpression g "vx=0.2" "age>100" 0 5 0') as Extract<ParticleCommand, typeof ChangeCmd>;
    expect(c2.type).toBe('speedexpression');
    expect(c2.conditionalExpression).toBe('age>100');
    expect(c2.pos?.y?.v).toBe(5);
  });
  it('group change 非法 type 报错', () => {
    expect(() => P('particleex group change foo g "vy=0.1"')).toThrow(/parameter 或 speedexpression/);
  });
  it('未知 group 子命令报错', () => {
    expect(() => P('particleex group frob x')).toThrow(/未知 group 子命令/);
  });
});

describe('serialize round-trip', () => {
  const cases: string[] = [
    'particleex normal minecraft:heart 1 2 3 1 0 0 1 0 0.1 0 0.5 0 0.5 50 20 "vy=0.1" 2 g1|g2',
    'particleex normal flame 0 0 0 1 1 1 1 0 0 0 1 0 1 5',
    'particleex conditional smoke ~ ~1.5 ~-2 0.5 0.5 0.5 1 0 0 0 1 0 1 "x,y,z=t,sin(t),cos(t)" 0.25',
    'particleex conditional smoke 0 0 0 1 1 1 1 0 0 0 1 0 1 "a ""b"" c" 0.1 7 null 1.5 g',
    'particleex parameter flame 0 0 0 1 0 0 1 0 0 0 0 20 "x,y=t,0" 0.5 30 "vy=0.1" 2 g',
    'particleex polarparameter flame 0 0 0 1 1 1 1 0 0 0 0 10 "s1,s2,dis=t*10,t*PI/20,1"',
    'particleex tickparameter flame 0 0 0 1 1 1 1 0 0 0 0 10 "x,y=t,0" 0.5 3 -1 null 1 null',
    'particleex rgbaparameter flame 0 0 0 0 0.1 0 0 20 "x,y,cr,cg,cb=t,sin(t),1,1,1"',
    'particleex rgbatickpolarparameter flame ~ ~ ~ 0 0.1 0 0 10 "s1,s2,dis=t*10,t*PI/20,1" 0.2 7 5',
    'particleex group remove g1 "age>100" 1 2 3',
    'particleex group remove g1',
    'particleex group change parameter g "vy=0.1"',
    'particleex group change speedexpression g "vx=0.2" "age>100" 0 5 0',
    'particleex clearparticle',
  ];
  for (const src of cases) {
    it(`round-trip: ${src.slice(0, 60)}`, () => {
      const c1 = P(src);
      const text = serialize(c1);
      const c2 = P(text);
      expect(c2).toEqual(c1);
      // 再一轮保证规范形式稳定
      expect(serialize(c2)).toBe(text);
    });
  }
});
