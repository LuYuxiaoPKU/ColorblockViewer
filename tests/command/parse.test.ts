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
  it("单引号定界（brigadier 新版，MC 26.2）：剥引号、'' 转义", () => {
    const c = P("particleex conditional smoke 0 0 0 1 1 1 1 0 0 0 1 0 1 'a ''b'' c'") as Extract<ParticleCommand, { kind: 'conditional' }>;
    expect(c.expression).toBe("a 'b' c");
  });
  it('未闭合单引号报错', () => {
    expect(() => P("particleex conditional smoke 0 0 0 1 1 1 1 0 0 0 1 0 1 'x>1")).toThrow(/unterminated/);
  });
  it('游戏内单引号命令（用户报告 26.2 可运行）：polarparameter 全槽位', () => {
    const c = P("/particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 -10 10 'dis=1;s1=2*t;s2=0' 0.1 20 'i=0.1;(vx,vy,vz)=((i)*cos(s1),0,(i)*sin(s1))' 1 null") as ParameterCmd;
    expect(c.polar).toBe(true);
    expect(c.name).toBe('minecraft:end_rod');
    expect(c.pos.y).toEqual({ v: 2, rel: true });
    expect(c.begin).toBe(-10);
    expect(c.end).toBe(10);
    expect(c.expression).toBe('dis=1;s1=2*t;s2=0');
    expect(c.step).toBe(0.1);
    expect(c.age).toBe(20);
    expect(c.speedExpression).toBe('i=0.1;(vx,vy,vz)=((i)*cos(s1),0,(i)*sin(s1))');
    expect(c.speedStep).toBe(1);
    expect(c.group).toBeNull();
  });
  it('用户真实指令逐字 e2e：/ 前缀 + 含空格单引号条件表达式 + 相对坐标 + 命名空间 + null 组', () => {
    // 用户在游戏内可运行的 conditional 命令（2026-09-07 提供）。
    // 语义注意：表达式里 x/y/z 是相对命令位置的扫描偏移（±range），非世界坐标。
    const raw = "/particleex conditional minecraft:end_rod ~1 ~2 ~ 1 0.95 0.89 1 0 0 0 0.5 0.5 0.5 '(abs(y)==0.5&!(abs(z)<0.5))|(abs(x)==0.5&(!(abs(z)<0.5)|!(abs(y)<0.5)))' 0.1 20 'vy=0.05' 1.0 null";
    const cmds = parseCommands(raw);
    expect(cmds).toHaveLength(1);
    const c = cmds[0] as Extract<ParticleCommand, { kind: 'conditional' }>;
    expect(c.name).toBe('minecraft:end_rod');
    expect(c.pos).toEqual({ x: { v: 1, rel: true }, y: { v: 2, rel: true }, z: { v: 0, rel: true } });
    expect(c.color).toEqual({ r: 1, g: 0.95, b: 0.89, a: 1 });
    expect(c.range).toEqual({ x: 0.5, y: 0.5, z: 0.5 });
    expect(c.expression).toBe("(abs(y)==0.5&!(abs(z)<0.5))|(abs(x)==0.5&(!(abs(z)<0.5)|!(abs(y)<0.5)))");
    expect(c.step).toBe(0.1);
    expect(c.age).toBe(20);
    expect(c.speedExpression).toBe('vy=0.05');
    expect(c.speedStep).toBe(1);
    expect(c.group).toBeNull();
    // 回显保留 / 前缀（粘贴→应用后斜杠不丢，可直接复制回游戏）。
    // 注：规范文本数字去尾零（1.0→1）；表达式无空格/引号 → 不加引号（fmtStr 规则），
    // parse(serialize(c)) 与 c 语义等价（round-trip 约定）。
    expect(serialize(c)).toBe(
      '/particleex conditional minecraft:end_rod ~1 ~2 ~ 1 0.95 0.89 1 0 0 0 0.5 0.5 0.5 ' +
      '(abs(y)==0.5&!(abs(z)<0.5))|(abs(x)==0.5&(!(abs(z)<0.5)|!(abs(y)<0.5))) 0.1 20 vy=0.05 1 null',
    );
    expect(parseCommands(serialize(c))[0]).toEqual(c);
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
    'particle flame',
    'particle dust ~ ~1 ~-2',
    'particle dust{color:0xFF0000,scale:1f} 1 2 3 0.1 0.2 0.3 0 5',
    'particle dust{color:[1.0,0.0,0.0],scale:1.0f} 1 2 3',
    'particle block{BlockState:123} 1 2 3',
    'particle flame 1 2 3 0 0 0 0.5 42',
    'particle flame ~ ~ ~ 0 0 0 0.5 42 normal',
  ];
  for (const src of cases) {
    it(`round-trip: ${src.slice(0, 60)}`, () => {
      const c1 = P(src);
      const text = serialize(c1);
      const c2 = P(text);
      if (c1.kind === 'vanilla') {
        // 原版槽位链：null 槽 = 命令树默认；规范文本用显式默认值补齐链后
        // 再解析 → 默认值显式化（pos null → ~ ~ ~ 等），断言不动点 +
        // 规范文本稳定（语义等价，非逐字段相等）
        expect(serialize(c2)).toBe(text);
        expect(P(text)).toEqual(c2);
        return;
      }
      expect(c2).toEqual(c1);
      // 再一轮保证规范形式稳定
      expect(serialize(c2)).toBe(text);
    });
  }

  it('vanilla 缺槽补齐：pos 有而 delta 空 → 规范文本补 delta 默认 0 0 0', () => {
    // 解析产物无缺口（链连续）；缺口只能来自 UI（设了 speed 未设 delta）
    const c1 = P('particle flame 1 2 3') as Extract<ParticleCommand, { kind: 'vanilla' }>;
    expect(c1.delta).toBeNull();
    const c2 = { ...c1, speed: 0.5, count: 42 };
    const text = serialize(c2);
    expect(text).toBe('/particle flame 1 2 3 0 0 0 0.5 42');
    const c3 = P(text) as Extract<ParticleCommand, { kind: 'vanilla' }>;
    expect(c3.delta).toEqual({ x: 0, y: 0, z: 0 });
    expect(c3.speed).toBe(0.5);
    expect(c3.count).toBe(42);
  });
});

describe('原版 /particle（MC 26.2）', () => {
  const V = (s: string) => P(s) as Extract<ParticleCommand, { kind: 'vanilla' }>;

  it('仅 name：其余槽全 null（命令树默认）', () => {
    const c = V('particle flame');
    expect(c).toEqual({ kind: 'vanilla', name: 'flame', pos: null, delta: null, speed: null, count: null, normal: false, nbt: null });
  });

  it('/particle 前缀 + minecraft: 命名空间', () => {
    const c = V('/particle minecraft:heart');
    expect(c.name).toBe('minecraft:heart');
  });

  it('全槽位：pos 支持 ~，delta 绝对值，speed/count/normal', () => {
    const c = V('particle smoke ~ ~1.5 ~-2 0.5 0.5 0.5 0.3 42 normal');
    expect(c.pos).toEqual({ x: { v: 0, rel: true }, y: { v: 1.5, rel: true }, z: { v: -2, rel: true } });
    expect(c.delta).toEqual({ x: 0.5, y: 0.5, z: 0.5 });
    expect(c.speed).toBe(0.3);
    expect(c.count).toBe(42);
    expect(c.normal).toBe(true);
  });

  it('type{NBT}：剥离 NBT 保留类型名（含命名空间前缀）', () => {
    expect(V('particle dust{color:0xFF0000,scale:1f}').name).toBe('dust');
    expect(V('particle minecraft:block{BlockState:1}').name).toBe('minecraft:block');
  });

  it('type{NBT}：dust 载荷记录到 nbt 字段（取证：1.21.11 ls.class CODEC = color/scale）', () => {
    const c = V('particle dust{color:0x00FF00,scale:2f}');
    expect(c.name).toBe('dust');
    expect(c.nbt).toBe('color:0x00FF00,scale:2f');
  });

  it('type{NBT}：非 dust 类型只校验语法、记录载荷不消费', () => {
    const c = V('particle minecraft:block{BlockState:123}');
    expect(c.name).toBe('minecraft:block');
    expect(c.nbt).toBe('BlockState:123');
  });

  it('dust NBT 缺 color/scale → 报错（游戏内 Can\'t parse particle options）', () => {
    expect(() => V('particle dust{Red:1f}')).toThrow(/dust 的 NBT 需含 color 与 scale/);
    expect(() => V('particle dust{color:0xFF0000}')).toThrow(/需含 color 与 scale/);
  });

  it('dust NBT 未知字段 → 报错（RecordCodecBuilder 严格）', () => {
    expect(() => V('particle dust{color:0xFF0000,scale:1f,Red:1f}')).toThrow(/不应含字段 "Red"/);
  });

  it('dust NBT 值越界 → 报错', () => {
    expect(() => V('particle dust{color:0x1FF0000,scale:1f}')).toThrow(/color 应为 0xRRGGBB/);
    expect(() => V('particle dust{color:[1,0,0,0],scale:1f}')).toThrow(/color 列表应为 3 个/);
    expect(() => V('particle dust{color:0xFF0000,scale:0.001f}')).toThrow(/scale 超出范围/);
    expect(() => V('particle dust{color:0xFF0000,scale:5f}')).toThrow(/scale 超出范围/);
  });

  it('NBT 语法错误 → 报错（花括号不闭合/缺冒号/坏数值）', () => {
    expect(() => V('particle dust{color:0xFF0000')).toThrow(/NBT 解析失败/);
    expect(() => V('particle dust{color}')).toThrow(/缺少冒号/);
    expect(() => V('particle dust{color:0xZZ,scale:1f}')).toThrow(/数值无效/);
    expect(() => V('particle dust{color:{a:1},scale:1f}')).toThrow(/嵌套 NBT 暂不支持/);
  });

  it('delta 不接受 ~（命令树 vec3(0) 绝对坐标）', () => {
    expect(() => V('particle flame 0 0 0 ~ 0 0')).toThrow(/delta/);
  });

  it('speed 必须 ≥ 0', () => {
    expect(() => V('particle flame 0 0 0 0 0 0 -1 5')).toThrow(/speed 超出范围/);
  });

  it('count 必须 ≥ 0', () => {
    expect(() => V('particle flame 0 0 0 0 0 0 0.5 -1')).toThrow(/count 超出范围/);
  });

  it('force / viewers 槽位拒绝（预览无多人分发）', () => {
    expect(() => V('particle flame 0 0 0 0 0 0 0.5 5 force @a')).toThrow(/预览不支持 force/);
    expect(() => V('particle flame 0 0 0 0 0 0 0.5 5 normal viewers @a')).toThrow(/预览不支持 viewers/);
  });

  it('未知尾部 token 落入 pos 槽 → 缺参数报错', () => {
    expect(() => V('particle flame frobnicate')).toThrow(/缺少参数 pos/);
  });

  it('particleex particle … 按未知子命令报错（防误吞）', () => {
    expect(() => P('particleex particle flame')).toThrow(/未知子命令/);
  });

  it('name 空（裸 {NBT}）报错', () => {
    expect(() => V('particle {Red:1f}')).toThrow(/粒子名不能为空/);
  });
});
