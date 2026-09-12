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

export function decodeShare(s: string, defaultSim: SimConfig): SharePayload | null {
  try {
    const obj = JSON.parse(b64urlDecode(s)) as {
      commands?: unknown;
      sim?: Partial<SimConfig>;
    };
    if (!obj || !Array.isArray(obj.commands)) return null;
    return {
      commands: obj.commands as ParticleCommand[],
      sim: { ...defaultSim, ...(obj.sim ?? {}) },
    };
  } catch {
    return null;
  }
}

/** 当前页面 + 载荷 → 完整分享 URL（origin+pathname 保留 base 子路径） */
export function shareUrl(token: string, origin: string, pathname: string): string {
  return `${origin}${pathname}?${SHARE_PARAM}=${token}`;
}
