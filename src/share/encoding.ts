// 分享链接（URL 状态编码）：命令列表 + 仿真设置 → 单个 query 参数 ?s=…
//
// 载荷 = { commands: ParticleCommand[], sim: SimConfig } 的 JSON → base64url。
// commands 为纯数据（表单真源，structuredClone/JSON 安全）；decode 对 sim 与
// 默认设置合并（旧链接缺新字段时降级到默认），对结构损坏返回 null（UI toast）。
// 命令文本的人类可读形式仍由 serializeAll 承担（粘贴框）；这里只负责链接。

import type { ParticleCommand } from '../command/types';
import type { SimConfig } from '../sim/types';

export interface SharePayload {
  commands: ParticleCommand[];
  sim: SimConfig;
}

export const SHARE_PARAM = 's';
/** 模板直达参数：`?t=<模板 id>`（只带模板，不带场景；与 ?s= 同时出现时 ?s= 优先） */
export const TEMPLATE_PARAM = 't';

// base64 → base64url（去掉 +/=，URL 安全）；unicode 经 encodeURIComponent 中转
function b64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return decodeURIComponent(escape(atob(pad)));
}

export function encodeShare(payload: SharePayload): string {
  return b64urlEncode(JSON.stringify(payload));
}

// 载荷结构校验（?s= 是外部输入边界：手改/伪造/旧 schema 的链接不得让
// serializeAll 在 createRoot 之前抛 TypeError 白屏整站——校验不过 = 无效链接）
const CMD_KINDS = ['normal', 'conditional', 'parameter', 'group', 'vanilla', 'clearparticle'] as const;

function isVec3(p: unknown): p is { x: { v: number; rel: boolean }; y: { v: number; rel: boolean }; z: { v: number; rel: boolean } } {
  if (!p || typeof p !== 'object') return false;
  const v = p as Record<string, unknown>;
  const coord = (c: unknown): boolean =>
    !!c && typeof c === 'object' && typeof (c as { v?: unknown }).v === 'number' && typeof (c as { rel?: unknown }).rel === 'boolean';
  return coord(v.x) && coord(v.y) && coord(v.z);
}

function isCommand(c: unknown): c is ParticleCommand {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (typeof o.kind !== 'string' || !(CMD_KINDS as readonly string[]).includes(o.kind)) return false;
  if (o.kind === 'clearparticle') return true;
  // vanilla 的 pos 是 Vec3 | null（原版 /particle 允许省略 pos）；其余 kind 必须完整 Vec3
  if (o.kind !== 'vanilla' ? !isVec3(o.pos) : o.pos !== null && !isVec3(o.pos)) return false;
  if (typeof o.name !== 'string') return false;
  if (o.kind === 'group') {
    if (o.sub !== 'remove' && o.sub !== 'change') return false;
    return typeof o.group === 'string';
  }
  const num = (v: unknown): v is number => typeof v === 'number';
  const vec3Plain = (v: unknown): boolean =>
    !!v && typeof v === 'object' && num((v as { x?: unknown }).x) && num((v as { y?: unknown }).y) && num((v as { z?: unknown }).z);
  if (o.kind === 'vanilla') return true; // 其余字段全可选（delta/speed/count/normal/nbt 可 null）
  if (!vec3Plain(o.speed)) return false;
  if (o.kind === 'normal' || o.kind === 'conditional') return num(o.count);
  // parameter：begin/end/step/age 数值（color/speedExpression/speedStep 有缺省，不强制）
  return num(o.begin) && num(o.end) && num(o.step) && num(o.age);
}

function isPos(p: unknown): p is { x: number; y: number; z: number } {
  if (!p || typeof p !== 'object') return false;
  const v = p as Record<string, unknown>;
  return typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number';
}

/** sim 字段类型校验：垃圾值（如 playerPos:5）不得直通引擎配置（~ 坐标 → NaN 静默
 *  画布空白）——逐字段校验，非法字段降级为默认值（与「旧链接缺字段降级」同策略） */
function sanitizeSim(raw: unknown, def: SimConfig): SimConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    playerPos: isPos(o.playerPos) ? (o.playerPos as SimConfig['playerPos']) : def.playerPos,
    defaultLifetime: num(o.defaultLifetime, def.defaultLifetime),
    maxParticles: num(o.maxParticles, def.maxParticles),
    seed: num(o.seed, def.seed),
    mcVersion: typeof o.mcVersion === 'string' ? o.mcVersion : def.mcVersion,
    gridSize: num(o.gridSize, def.gridSize),
    gridVisible: typeof o.gridVisible === 'boolean' ? o.gridVisible : def.gridVisible,
    nativeKinematics: typeof o.nativeKinematics === 'boolean' ? o.nativeKinematics : def.nativeKinematics,
    renderMode: o.renderMode === 'full' || o.renderMode === 'fast' ? o.renderMode : def.renderMode,
  };
}

export function decodeShare(s: string, defaultSim: SimConfig): SharePayload | null {
  try {
    const obj = JSON.parse(b64urlDecode(s)) as {
      commands?: unknown;
      sim?: unknown;
    };
    if (!obj || !Array.isArray(obj.commands)) return null;
    if (!obj.commands.every(isCommand)) return null;
    return {
      commands: obj.commands as ParticleCommand[],
      sim: sanitizeSim(obj.sim, defaultSim),
    };
  } catch {
    return null;
  }
}

/** 当前页面 + 载荷 → 完整分享 URL（origin+pathname 保留 base 子路径） */
export function shareUrl(token: string, origin: string, pathname: string): string {
  return `${origin}${pathname}?${SHARE_PARAM}=${token}`;
}
