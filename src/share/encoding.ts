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

// 校验口径 = parser 产物 schema（command/types.ts）逐字段：serializeAll 对任一
// 缺失/错型字段都会读 undefined 属性抛 TypeError（createRoot 前白屏）。
// 不查 parser 产物中不存在的字段（如 conditional 无 count——查了合法命令反被拒）。
function isPlain3(v: unknown): boolean {
  return !!v && typeof v === 'object'
    && typeof (v as { x?: unknown }).x === 'number'
    && typeof (v as { y?: unknown }).y === 'number'
    && typeof (v as { z?: unknown }).z === 'number';
}

function isRGBA(v: unknown): boolean {
  return !!v && typeof v === 'object'
    && typeof (v as { r?: unknown }).r === 'number'
    && typeof (v as { g?: unknown }).g === 'number'
    && typeof (v as { b?: unknown }).b === 'number'
    && typeof (v as { a?: unknown }).a === 'number';
}

function isStrOrNull(v: unknown): boolean {
  return v === null || typeof v === 'string';
}

function isTail(t: unknown): boolean {
  return !!t && typeof t === 'object'
    && typeof (t as { age?: unknown }).age === 'number'
    && isStrOrNull((t as { speedExpression?: unknown }).speedExpression)
    && typeof (t as { speedStep?: unknown }).speedStep === 'number'
    && isStrOrNull((t as { group?: unknown }).group);
}

function isCommand(c: unknown): c is ParticleCommand {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (typeof o.kind !== 'string' || !(CMD_KINDS as readonly string[]).includes(o.kind)) return false;
  if (o.kind === 'clearparticle') return true;
  // group 无 name/pos 顶层字段（pos 挂在各变体上，可 null），单独分流
  if (o.kind === 'group') {
    if (o.sub === 'remove') return typeof o.group === 'string' && isStrOrNull(o.expression) && (o.pos === null || isVec3(o.pos));
    if (o.sub === 'change') {
      if (o.type !== 'parameter' && o.type !== 'speedexpression') return false;
      return typeof o.group === 'string' && typeof o.expression === 'string' && isStrOrNull(o.conditionalExpression) && (o.pos === null || isVec3(o.pos));
    }
    return false;
  }
  if (typeof o.name !== 'string') return false;
  // vanilla 的 pos 是 Vec3 | null（原版 /particle 允许省略 pos）；其余 kind 必须完整 Vec3
  if (o.kind !== 'vanilla' ? !isVec3(o.pos) : o.pos !== null && !isVec3(o.pos)) return false;
  if (o.kind === 'vanilla') {
    return (o.delta === null || isPlain3(o.delta))
      && (o.speed === null || typeof o.speed === 'number')
      && (o.count === null || typeof o.count === 'number')
      && typeof o.normal === 'boolean'
      && isStrOrNull(o.nbt);
  }
  if (!isPlain3(o.speed) || !isTail(o)) return false;
  // range/color 仅 normal 与 conditional 有（parameter 无 range、color 与 rgba 互锁）
  if (o.kind === 'normal' || o.kind === 'conditional') {
    if (!isPlain3(o.range) || !isRGBA(o.color)) return false;
  }
  if (o.kind === 'normal') return typeof o.count === 'number';
  if (o.kind === 'conditional') return typeof o.expression === 'string' && typeof o.step === 'number';
  // parameter：polar/tick/rgba 决定变体；color 与 rgba 互锁（parser：
  // rgba 变体无 color 槽 → 恒 null；非 rgba 变体恒 RGBA）
  return typeof o.polar === 'boolean' && typeof o.tick === 'boolean' && typeof o.rgba === 'boolean'
    && (o.rgba === true ? o.color === null : isRGBA(o.color))
    && typeof o.begin === 'number' && typeof o.end === 'number'
    && typeof o.expression === 'string' && typeof o.step === 'number'
    && typeof o.cpt === 'number';
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
    mcVersion: o.mcVersion === '26.2' || o.mcVersion === '1.21.11' ? o.mcVersion : def.mcVersion,
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
