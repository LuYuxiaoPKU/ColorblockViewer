// 剪贴板写入（分享链接 / 模板复制共用）：成功 → 成功 toast；writeText 拒绝
// （权限被拒等）→ 原文兜底 toast（用户可手动复制）；clipboard 不可用（CSP/
// 非安全上下文）→ 直接兜底 toast。clipboard 不可用分支在现有 UI 集成里
// 不可达（tests 用 happy-dom 恒提供 writeText），在这里直测。
// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getState, clearToasts } from '../../src/store/appState';
import { copyText } from '../../src/ui/clipboard';

const OK = '已复制到剪贴板';
const TPL_OK = '模板「圆周环」命令已复制到剪贴板';

function mockClipboard(impl?: (t: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: impl ? { writeText: impl } : undefined,
  });
}

beforeEach(() => {
  clearToasts();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('writeText 成功 → 成功 toast（不含兜底文案）', async () => {
    const w = vi.fn().mockResolvedValue(undefined);
    mockClipboard((t) => w(t));
    copyText('/particleex normal flame 0 0 0 1 0 0 1 0 0 0 0 0 0 5', OK);
    await new Promise((r) => setTimeout(r, 0));
    expect(w).toHaveBeenCalledWith('/particleex normal flame 0 0 0 1 0 0 1 0 0 0 0 0 0 5');
    expect(getState().toasts.at(-1)).toBe(OK);
  });

  it('writeText 拒绝 → 原文兜底 toast（手动复制）', async () => {
    mockClipboard(() => Promise.reject(new Error('denied')));
    copyText('/particleex clearparticle', TPL_OK);
    await new Promise((r) => setTimeout(r, 0));
    const t = getState().toasts.at(-1) ?? '';
    expect(t).toContain('请手动复制');
    expect(t).toContain('/particleex clearparticle');
    expect(t).not.toContain('denied'); // 不泄露内部错误细节
  });

  it('clipboard 不可用 → 兜底 toast（不调 writeText）', async () => {
    mockClipboard(undefined);
    copyText('/particle smoke', OK);
    await new Promise((r) => setTimeout(r, 0));
    const t = getState().toasts.at(-1) ?? '';
    expect(t).toContain('剪贴板不可用');
    expect(t).toContain('/particle smoke');
  });
});
