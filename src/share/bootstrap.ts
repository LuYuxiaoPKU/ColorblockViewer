// 分享链接启动逻辑（main.tsx 首渲染前调用；与 UI 解耦便于测试）：
// 读 ?s= → decode → loadShared；参数存在但损坏 → toast 提示（不动默认场景）。
// 另支持 `?t=<模板 id>`：只用链接里的模板替换命令列表（?s= 优先，二者可并存）。

import { decodeShare, SHARE_PARAM, TEMPLATE_PARAM, type SharePayload } from './encoding';
import { templateById, templateText, type Template } from '../templates/library';
import { parseCommands } from '../command/parser';
import type { ParticleCommand } from '../command/types';
import type { SimConfig } from '../sim/types';

export function applySharedSearch(
  search: string,
  defaultSim: SimConfig,
  load: (p: SharePayload) => void,
  onInvalid: (msg: string) => void,
): void {
  const params = new URLSearchParams(search);
  const s = params.get(SHARE_PARAM);
  if (s !== null) {
    const p = decodeShare(s, defaultSim);
    if (p) {
      load(p);
      return; // ?s= 是完整场景 → 不再叠加模板
    }
    onInvalid('分享链接无效或已损坏');
    return;
  }
  // ?t=<id>：模板直达链接（只带模板命令；设置走默认）
  const t = params.get(TEMPLATE_PARAM);
  if (t !== null) {
    const tpl = templateById(t);
    if (!tpl) {
      onInvalid(`模板链接无效：没有 id 为「${t}」的模板`);
      return;
    }
    try {
      load({ commands: parseCommands(templateText(tpl)), sim: defaultSim });
    } catch (err) {
      onInvalid(`模板「${tpl.name}」载入失败：${(err as Error).message}`);
    }
  }
}

/** 模板分享链接（`?t=<id>`）：与 shareUrl 同一拼法，保留 base 子路径 */
export function templateUrl(tpl: Template, origin: string, pathname: string): string {
  return `${origin}${pathname}?${TEMPLATE_PARAM}=${tpl.id}`;
}

/** 模板 id → 命令数组（供 UI/测试复用；解析失败抛 CommandParseError） */
export function templateCommands(id: string): ParticleCommand[] {
  const tpl = templateById(id);
  if (!tpl) throw new Error(`没有 id 为「${id}」的模板`);
  return parseCommands(templateText(tpl));
}
