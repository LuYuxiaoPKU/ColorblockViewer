// 分享链接启动逻辑（main.tsx 首渲染前调用；与 UI 解耦便于测试）：
// 读 ?s= → decode → loadShared；参数存在但损坏 → toast 提示（不动默认场景）。

import { decodeShare, SHARE_PARAM, type SharePayload } from './encoding';
import type { SimConfig } from '../sim/types';

export function applySharedSearch(
  search: string,
  defaultSim: SimConfig,
  load: (p: SharePayload) => void,
  onInvalid: (msg: string) => void,
): void {
  const s = new URLSearchParams(search).get(SHARE_PARAM);
  if (s === null) return;
  const p = decodeShare(s, defaultSim);
  if (p) load(p);
  else onInvalid('分享链接无效或已损坏');
}
