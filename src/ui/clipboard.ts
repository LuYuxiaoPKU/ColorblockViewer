// 剪贴板写入（分享链接 / 模板复制共用）：优先 navigator.clipboard，失败或不可用时
// 回退成 toast 显示原文（用户可手动复制）——与 Viewport 复制分享链接同一策略。
//
// okMsg 契约（脆弱兜底）：成功文案须含「已复制」——失败/不可用分支用它剥掉尾部
// 再接「复制失败/剪贴板不可用」前缀。当前唯一调用方 TemplateGallery 的
// 「模板「X」命令已复制到剪贴板」满足；改文案前先过 tests/ui/clipboard.test.ts
// 的前缀断言。

import { pushToast } from '../store/appState';

export function copyText(text: string, okMsg: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => pushToast(okMsg),
      () => pushToast(`${okMsg.replace(/已复制.*$/, '')}复制失败，请手动复制：\n${text}`),
    );
  } else {
    pushToast(`${okMsg.replace(/已复制.*$/, '')}剪贴板不可用，请手动复制：\n${text}`);
  }
}
