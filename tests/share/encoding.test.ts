// 分享链接编码（src/share/encoding.ts）：URL 安全 base64url + JSON 载荷的
// round-trip、损坏容错、sim 字段合并降级。

import { describe, it, expect } from 'vitest';
import { encodeShare, decodeShare, shareUrl, SHARE_PARAM, type SharePayload } from '../../src/share/encoding';
import type { SimConfig } from '../../src/sim/types';

const SIM: SimConfig = {
  playerPos: { x: 0, y: 1, z: 0 },
  defaultLifetime: 20,
  maxParticles: 20000,
  seed: 1,
  mcVersion: '26.2',
  gridSize: 10,
  gridVisible: true,
  nativeKinematics: true,
  renderMode: 'full',
  reference: 'none',
};

const CMDS = [
  {
    kind: 'vanilla' as const,
    name: 'end_rod',
    pos: null,
    delta: null,
    speed: 0.1,
    count: 50,
    normal: false,
    nbt: null,
  },
];

describe('encodeShare/decodeShare round-trip', () => {
  it('完整载荷往返一致（含 unicode 命令名/表达式）', () => {
    const payload: SharePayload = {
      commands: [
        ...CMDS,
        {
          kind: 'parameter' as const,
          polar: false,
          tick: false,
          rgba: false,
          name: 'flame',
          pos: { x: { v: 1, rel: true }, y: { v: 2, rel: false }, z: { v: 3, rel: false } },
          color: { r: 1, g: 0.5, b: 0.2, a: 1 },
          speed: { x: 0, y: 0, z: 0 },
          begin: 0,
          end: 12.56,
          expression: "x,y,z=cos(t),0,sin(t);cr=1",
          step: 0.25,
          cpt: 10,
          age: 40,
          speedExpression: 'vy=0.1',
          speedStep: 1,
          group: 'g1|g2',
        },
      ],
      sim: { ...SIM, mcVersion: '1.21.11', seed: 42 },
    };
    const tok = encodeShare(payload);
    // URL 安全：无 + / = 与空白
    expect(tok).not.toMatch(/[+/=\s]/);
    expect(tok).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeShare(tok, SIM);
    expect(back).toEqual(payload);
  });

  it('sim 缺字段 → 与 defaultSim 合并（旧链接降级）', () => {
    const tok = encodeShare({ commands: CMDS, sim: { seed: 7 } as unknown as SimConfig });
    const back = decodeShare(tok, SIM)!;
    expect(back.sim.seed).toBe(7);
    expect(back.sim.mcVersion).toBe(SIM.mcVersion);
    expect(back.sim.maxParticles).toBe(SIM.maxParticles);
    expect(back.commands).toEqual(CMDS);
  });

  it('sim 整体缺失 → 全默认', () => {
    const obj = JSON.stringify({ commands: CMDS });
    const tok = encodeShare({ commands: CMDS, sim: {} as SimConfig });
    void obj;
    const back = decodeShare(tok, SIM)!;
    expect(back.sim).toEqual(SIM);
  });

  it('损坏/非 JSON/缺 commands → null（不抛异常）', () => {
    expect(decodeShare('!!!not-base64!!!', SIM)).toBeNull();
    expect(decodeShare(encodeShare({ commands: 'nope', sim: SIM } as unknown as SharePayload), SIM)).toBeNull();
    const bad = encodeShare({ commands: CMDS, sim: SIM }).slice(0, 10) + '###';
    expect(decodeShare(bad, SIM)).toBeNull();
  });

  it('commands 元素级校验：畸形命令（手改/伪造 ?s=）→ null，不直通 serializeAll 白屏', () => {
    // 回归：曾只查 Array.isArray(commands)——{commands:[{}]} 直通 loadShared →
    // serializeAll 读 c.pos.rel 抛 TypeError → createRoot 前崩 → 整站白屏
    const tok = (o: unknown) => b64(o);
    expect(decodeShare(tok({ commands: [{}] }), SIM)).toBeNull();
    expect(decodeShare(tok({ commands: [null, CMDS[0]] }), SIM)).toBeNull();
    expect(decodeShare(tok({ commands: [{ kind: 'normal', name: 'flame' }] }), SIM)).toBeNull(); // 缺 pos
    expect(decodeShare(tok({ commands: [{ ...CMDS[0], pos: { x: { v: 1 } } }] }), SIM)).toBeNull(); // pos 缺 rel
    expect(decodeShare(tok({ commands: [{ ...CMDS[0], name: 5 }] }), SIM)).toBeNull(); // name 非 string
    expect(decodeShare(tok({ commands: [{ kind: 'bogus' }] }), SIM)).toBeNull(); // 未知 kind
    expect(decodeShare(tok({ commands: [{ kind: 'group', pos: vec3(), name: 'g', sub: 'explode', group: 'g1' }] }), SIM)).toBeNull(); // sub 非法
    expect(decodeShare(tok({ commands: [{ ...CMDS[0], pos: { x: 1, y: 2, z: 3 } }] }), SIM)).toBeNull(); // vanilla pos 须 Vec3|null
  });

  it('vanilla pos:null 合法（原版 /particle 允许省略 pos）→ 校验通过', () => {
    const tok = b64({ commands: [CMDS[0]], sim: SIM });
    const back = decodeShare(tok, SIM);
    expect(back).not.toBeNull();
    expect(back!.commands).toEqual(CMDS);
  });

  it('vanilla delta/speed/count/normal/nbt 全 null（命令树最小载荷）→ 合法', () => {
    const c = { kind: 'vanilla', name: 'flame', pos: null, delta: null, speed: null, count: null, normal: false, nbt: null };
    const back = decodeShare(b64({ commands: [c], sim: SIM }), SIM);
    expect(back).not.toBeNull();
    expect(back!.commands).toEqual([c]);
  });

  it('vanilla 结构畸形（非对象元素 / 未知 kind）→ null', () => {
    expect(decodeShare(b64({ commands: ['flame'] }), SIM)).toBeNull();
    expect(decodeShare(b64({ commands: [3] }), SIM)).toBeNull();
  });

  // 回归（第四波审查）：isCommand 曾漏校验 color/range/expression 等 serializeAll
  // 必读字段——伪造 ?s= 缺 color 仍直通 serializeAll 读 c.color.r 抛 TypeError
  // createRoot 前白屏；同时曾误要求 conditional 的 count（parser 产物无此字段）
  // → 合法 conditional 命令无法分享。
  const normalCmd = {
    kind: 'normal', name: 'flame', pos: vec3(),
    color: { r: 1, g: 0.5, b: 0.2, a: 1 }, speed: { x: 0, y: 0.1, z: 0 }, range: { x: 0.2, y: 0, z: 0 },
    count: 10, age: 40, speedExpression: null, speedStep: 1, group: null,
  };
  const condCmd = {
    kind: 'conditional', name: 'flame', pos: vec3(),
    color: { r: 1, g: 0.5, b: 0.2, a: 1 }, speed: { x: 0, y: 0.1, z: 0 }, range: { x: 0.2, y: 0, z: 0 },
    expression: "x>0", step: 0.5, age: 40, speedExpression: null, speedStep: 1, group: null,
  };
  const paramCmd = {
    kind: 'parameter', polar: false, tick: false, rgba: false, name: 'flame', pos: vec3(),
    color: { r: 1, g: 0.5, b: 0.2, a: 1 }, speed: { x: 0, y: 0.1, z: 0 },
    begin: 0, end: 6.28, expression: "x,y,z=cos(t),0,sin(t);cr=1", step: 0.25, cpt: 10,
    age: 40, speedExpression: null, speedStep: 1, group: null,
  };
  const rgbaParamCmd = { ...paramCmd, rgba: true, color: null };
  const groupRemove = { kind: 'group', sub: 'remove', group: 'g1', expression: null, pos: null };
  const groupChange = {
    kind: 'group', sub: 'change', type: 'parameter', group: 'g1',
    expression: "x=1", conditionalExpression: null, pos: null,
  };

  it('合法 normal/conditional/parameter(含 rgba 变体)/group remove/change → 校验通过', () => {
    const back = decodeShare(b64({ commands: [normalCmd, condCmd, paramCmd, rgbaParamCmd, groupRemove, groupChange], sim: SIM }), SIM);
    expect(back).not.toBeNull();
    expect(back!.commands).toEqual([normalCmd, condCmd, paramCmd, rgbaParamCmd, groupRemove, groupChange]);
  });

  it('normal/conditional/parameter 缺 serializeAll 必读字段 → null（伪造 ?s= 白屏回归）', () => {
    expect(decodeShare(b64({ commands: [{ ...normalCmd, color: undefined }] }), SIM)).toBeNull(); // 缺 color
    expect(decodeShare(b64({ commands: [{ ...normalCmd, range: undefined }] }), SIM)).toBeNull(); // 缺 range
    expect(decodeShare(b64({ commands: [{ ...normalCmd, count: undefined }] }), SIM)).toBeNull(); // 缺 count
    expect(decodeShare(b64({ commands: [{ ...condCmd, color: undefined }] }), SIM)).toBeNull(); // 缺 color
    expect(decodeShare(b64({ commands: [{ ...condCmd, expression: undefined }] }), SIM)).toBeNull(); // 缺 expression
    expect(decodeShare(b64({ commands: [{ ...paramCmd, begin: undefined }] }), SIM)).toBeNull(); // 缺 begin
    expect(decodeShare(b64({ commands: [{ ...paramCmd, expression: undefined }] }), SIM)).toBeNull(); // 缺 expression
    expect(decodeShare(b64({ commands: [{ ...paramCmd, cpt: undefined }] }), SIM)).toBeNull(); // 缺 cpt
    expect(decodeShare(b64({ commands: [{ ...rgbaParamCmd, color: { r: 1, g: 1, b: 1, a: 1 } }] }), SIM)).toBeNull(); // rgba 变体 color 须 null（parser 互锁）
    expect(decodeShare(b64({ commands: [{ ...paramCmd, color: null }] }), SIM)).toBeNull(); // 非 rgba 变体 color 不可 null
    expect(decodeShare(b64({ commands: [{ ...paramCmd, polar: 'no' }] }), SIM)).toBeNull(); // polar 须 boolean
    expect(decodeShare(b64({ commands: [{ ...normalCmd, age: '40' }] }), SIM)).toBeNull(); // 尾部 age 须 number
  });

  it('conditional 无 count 字段（parser 产物 schema）→ 校验通过，不得误拒', async () => {
    // P1 回归：旧 isCommand 要求 num(o.count)——合法 conditional 分享往返即被拒
    const back = decodeShare(b64({ commands: [condCmd], sim: SIM }), SIM);
    expect(back).not.toBeNull();
    // serialize 可安全消费（崩溃面验证）
    const { serialize } = await import('../../src/command/serialize');
    expect(serialize(back!.commands[0])).toContain('particleex conditional');
  });

  it('group 校验：change 缺 type / remove 缺 expression 槽 → null；带 pos 的 change 合法', () => {
    expect(decodeShare(b64({ commands: [{ ...groupChange, type: undefined }] }), SIM)).toBeNull();
    expect(decodeShare(b64({ commands: [{ kind: 'group', sub: 'remove', group: 'g1' }] }), SIM)).toBeNull(); // 缺 expression 槽
    expect(decodeShare(b64({ commands: [{ ...groupChange, conditionalExpression: 'x>0', pos: vec3() }] }), SIM)).not.toBeNull();
  });

  it('vanilla 可选字段错型 → null（delta 非 plain3 / speed 非 number / normal 非 boolean）', () => {
    expect(decodeShare(b64({ commands: [{ ...CMDS[0], delta: { x: '0', y: 0, z: 0 } }] }), SIM)).toBeNull();
    expect(decodeShare(b64({ commands: [{ ...CMDS[0], speed: 'fast' }] }), SIM)).toBeNull();
    expect(decodeShare(b64({ commands: [{ ...CMDS[0], normal: 'yes' }] }), SIM)).toBeNull();
  });

  it('sim mcVersion 仅接受 1.21.11 / 26.2，其余降级默认（防未知版本进渲染层取空类型表）', () => {
    const back = decodeShare(b64({ commands: CMDS, sim: { mcVersion: '1.20' } }), SIM);
    expect(back!.sim.mcVersion).toBe(SIM.mcVersion);
    const ok = decodeShare(b64({ commands: CMDS, sim: { mcVersion: '1.21.11' } }), SIM);
    expect(ok!.sim.mcVersion).toBe('1.21.11');
  });

  it('sim 类型校验：垃圾值降级默认（playerPos:5 不得直通引擎 → ~ 坐标 NaN 空白）', () => {
    const tok = b64({ commands: CMDS, sim: { playerPos: 5, maxParticles: 'many', seed: NaN, renderMode: 'ultra', gridSize: 5 } });
    const back = decodeShare(tok, SIM);
    expect(back).not.toBeNull();
    expect(back!.sim.playerPos).toEqual(SIM.playerPos);
    expect(back!.sim.maxParticles).toBe(SIM.maxParticles);
    expect(Number.isFinite(back!.sim.seed)).toBe(true);
    expect(back!.sim.renderMode).toBe(SIM.renderMode);
    expect(back!.sim.gridSize).toBe(5); // 合法字段保留
  });
});

function vec3() {
  return { x: { v: 1, rel: false }, y: { v: 2, rel: false }, z: { v: 3, rel: false } };
}

/** 测试辅助：对象 → base64url token（与 encodeShare 同编码，绕过其类型约束注入畸形载荷） */
function b64(o: unknown): string {
  const b64u = btoa(unescape(encodeURIComponent(JSON.stringify(o))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64u;
}

describe('shareUrl', () => {
  it('拼 origin + pathname + ?s=token', () => {
    const url = shareUrl('abc_-123', 'https://x.github.io', '/ColorblockViewer/');
    expect(url).toBe('https://x.github.io/ColorblockViewer/?s=abc_-123');
    expect(SHARE_PARAM).toBe('s');
  });
});

describe('applySharedSearch 引导', () => {
  it('无 ?s= 参数 → 不调用 load/onInvalid', async () => {
    const { applySharedSearch } = await import('../../src/share/bootstrap');
    let loaded = false;
    let invalid = false;
    applySharedSearch('', SIM, () => { loaded = true; }, () => { invalid = true; });
    expect(loaded).toBe(false);
    expect(invalid).toBe(false);
  });

  it('有效 ?s= → load(解码载荷)', async () => {
    const { applySharedSearch } = await import('../../src/share/bootstrap');
    let loaded: SharePayload | null = null;
    const tok = encodeShare({ commands: CMDS, sim: SIM });
    applySharedSearch('?s=' + tok, SIM, p => { loaded = p; }, () => { throw new Error('should not invalidate'); });
    expect(loaded).not.toBeNull();
    expect(loaded!.commands).toEqual(CMDS);
  });

  it('无效 ?s= → onInvalid 回调', async () => {
    const { applySharedSearch } = await import('../../src/share/bootstrap');
    let loaded = false;
    let msg = '';
    applySharedSearch('?s=bogus', SIM, () => { loaded = true; }, m => { msg = m; });
    expect(loaded).toBe(false);
    expect(msg).toContain('分享链接无效');
  });
});

describe('模板直达链接 ?t=<id>', () => {
  it('有效 ?t=ripple → load(模板命令 + 当前设置)', async () => {
    const { applySharedSearch } = await import('../../src/share/bootstrap');
    const { TEMPLATES, templateText } = await import('../../src/templates/library');
    const tpl = TEMPLATES[0];
    let loaded: SharePayload | null = null;
    applySharedSearch('?t=' + tpl.id, SIM, p => { loaded = p; }, m => { throw new Error(m); });
    expect(loaded).not.toBeNull();
    expect(loaded!.commands).toHaveLength(tpl.cmds.length);
    expect(loaded!.sim).toEqual(SIM); // 设置保持当前值（模板链接只带模板）
    // 命令文本与模板一致（回显后逐字相同）
    const { serialize } = await import('../../src/command/serialize');
    expect(loaded!.commands.map(serialize).join('\n')).toBe(templateText(tpl));
  });

  it('未知 id → onInvalid（提示该 id 不存在）', async () => {
    const { applySharedSearch } = await import('../../src/share/bootstrap');
    let msg = '';
    applySharedSearch('?t=not_a_template', SIM, () => { throw new Error('should not load'); }, m => { msg = m; });
    expect(msg).toContain('模板链接无效');
    expect(msg).toContain('not_a_template');
  });

  it('?s= 与 ?t= 同时出现 → ?s=（完整场景）优先', async () => {
    const { applySharedSearch } = await import('../../src/share/bootstrap');
    const tok = encodeShare({ commands: CMDS, sim: SIM });
    let loaded: SharePayload | null = null;
    applySharedSearch('?s=' + tok + '&t=ripple', SIM, p => { loaded = p; }, m => { throw new Error(m); });
    expect(loaded!.commands).toEqual(CMDS);
  });

  it('templateUrl 拼 origin + pathname + ?t=<id>', async () => {
    const { templateUrl } = await import('../../src/share/bootstrap');
    const { TEMPLATES } = await import('../../src/templates/library');
    expect(templateUrl(TEMPLATES[0], 'https://x.dev', '/ColorblockViewer/')).toBe(
      `https://x.dev/ColorblockViewer/?t=${TEMPLATES[0].id}`,
    );
  });
});
