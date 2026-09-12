// 模板库（右侧覆盖面板）+ 精选入口（chips / 空状态「从模板开始」）。
//
// 位置决策（2026-09-12）：模板是「起点/浏览面」，不该沉在左栏底部——
//   ① 入口放在命令区头部（与「执行」同行），底部那块删除；
//   ② 内容放进**右侧覆盖面板**：卡片有宽度、命令整行可读，且画布仍在左侧可见，
//      点「载入并执行」能当场看到效果，再关掉面板继续调参；
//   ③ 命令区常驻一行精选 chips（命令列表为空时改成「从模板开始」引导）。
//
// 模板文本是**游戏内合法格式**（tests/templates/library.test.ts 逐条守护：
// 可解析 + 过游戏内格式检查 + 引擎实跑零错误），复制出去可直接粘进游戏。

import { useEffect, useMemo, useState } from 'react';
import { TEMPLATES, featuredTemplates, templateText, type Template } from '../templates/library';
import { appendCommands, pushToast, useAppState } from '../store/appState';
import { templateUrl } from '../share/bootstrap';
import { parseCommands } from '../command/parser';
import { copyText } from './clipboard';

/** 载入模板：解析 → 追加到命令真源（粘贴框文本自动对齐）。模板自身的问题由
 *  tests/templates/library.test.ts 提前拦住，这里的 catch 只是兜底。 */
export function loadTemplate(t: Template): boolean {
  try {
    appendCommands(parseCommands(templateText(t)));
    pushToast(`已载入模板「${t.name}」（${t.cmds.length} 条命令）`);
    return true;
  } catch (err) {
    pushToast(`模板「${t.name}」载入失败：${(err as Error).message}`);
    return false;
  }
}

/** 精选入口：常驻一行 chips；命令列表为空时变成「从模板开始」引导 */
export function FeaturedTemplates({ onOpenAll, onRun }: { onOpenAll: () => void; onRun: () => void }) {
  const { commands } = useAppState();
  const picks = featuredTemplates();
  const empty = commands.length === 0;
  return (
    <div className={empty ? 'template-featured empty' : 'template-featured'}>
      <span className="template-featured-label">
        {empty ? '从模板开始（点一下即载入并执行）：' : '精选模板：'}
      </span>
      {picks.map((t) => (
        <button
          key={t.id}
          className="chip"
          title={t.desc}
          onClick={() => {
            if (loadTemplate(t)) onRun();
          }}
        >
          {t.name.replace(/（.*$/, '')}
        </button>
      ))}
      <button className="chip ghost" onClick={onOpenAll}>
        全部 {TEMPLATES.length} 个 →
      </button>
    </div>
  );
}

/** 模板库面板（覆盖式）：展示 + 复制命令 + 载入/载入并执行 */
export function TemplateGallery({
  open,
  onClose,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  onRun: () => void;
}) {
  const [q, setQ] = useState('');

  // Esc 关闭（面板是覆盖式的，键盘退出是基本预期）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const list = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (key === '') return TEMPLATES;
    return TEMPLATES.filter((t) =>
      [t.name, t.desc, t.tags.join(' '), t.id].join(' ').toLowerCase().includes(key),
    );
  }, [q]);

  if (!open) return null;

  return (
    <div className="gallery-overlay" onClick={onClose}>
      <section
        className="gallery-sheet"
        role="dialog"
        aria-label="模板库"
        onClick={(e) => e.stopPropagation()} // 面板内点击不关闭
      >
        <div className="gallery-head">
          <span className="gallery-title">📚 模板库（{TEMPLATES.length}）</span>
          <span className="gallery-hint muted">
            「复制命令」= 游戏内可直接粘贴的文本；「载入」= 追加到左侧命令列表（画布在左侧，可边看边试）
          </span>
          <button className="small" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        <input
          className="template-search"
          type="search"
          placeholder="搜索模板：名称 / 标签 / 说明"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="template-grid">
          {list.map((t) => (
            <div className="template-card" key={t.id}>
              <div className="template-head">
                <span className="template-name">{t.name}</span>
                <span className="template-tags">{t.tags.join(' · ')}</span>
              </div>
              <p className="template-desc">{t.desc}</p>
              <pre className="template-cmd">{templateText(t)}</pre>
              <div className="btn-row">
                <button
                  className="small"
                  onClick={() => copyText(templateText(t), `模板「${t.name}」命令已复制到剪贴板`)}
                  title="复制游戏内可用的命令文本（含表达式引号）"
                >
                  📋 复制命令
                </button>
                <button className="small" onClick={() => loadTemplate(t)}>
                  载入到命令列表
                </button>
                <button
                  className="small"
                  onClick={() =>
                    copyText(
                      templateUrl(t, window.location.origin, window.location.pathname),
                      `模板「${t.name}」链接已复制到剪贴板`,
                    )
                  }
                  title="复制模板直达链接（?t=<id>）：打开即载入该模板"
                >
                  🔗 复制链接
                </button>
                <button
                  className="small primary"
                  onClick={() => {
                    if (loadTemplate(t)) onRun();
                  }}
                >
                  载入并执行
                </button>
              </div>
            </div>
          ))}
          {list.length === 0 ? <div className="muted">没有匹配的模板</div> : null}
        </div>
      </section>
    </div>
  );
}
