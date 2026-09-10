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
});

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
