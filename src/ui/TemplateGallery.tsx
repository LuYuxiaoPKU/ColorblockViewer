// 模板库面板（计划 §九）：展示精编模板（名称/说明/标签/命令文本），
// 每条支持「复制命令」（写剪贴板，失败回退 toast 显示原文）与
// 「载入到命令列表」/「载入并执行」。
//
// 模板文本是**游戏内合法格式**（tests/templates/library.test.ts 逐条守护：
// 可解析 + 过游戏内格式检查 + 引擎实跑零错误），复制出去可直接粘进游戏。

import { useMemo, useState } from 'react';
import { TEMPLATES, templateText, type Template } from '../templates/library';
import { appendCommands, pushToast } from '../store/appState';
import { parseCommands } from '../command/parser';
import { copyText } from './clipboard';

export function TemplateGallery({ onRun }: { onRun: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (key === '') return TEMPLATES;
    return TEMPLATES.filter((t) =>
      [t.name, t.desc, t.tags.join(' '), t.id].join(' ').toLowerCase().includes(key),
    );
  }, [q]);

  /** 载入：解析模板命令 → 追加到命令列表（真源更新 → 粘贴框文本自动对齐） */
  const load = (t: Template): boolean => {
    try {
      appendCommands(parseCommands(templateText(t)));
      pushToast(`已载入模板「${t.name}」（${t.cmds.length} 条命令）`);
      return true;
    } catch (err) {
      // 模板自身有问题（守护测试会先报红，这里只是兜底）
      pushToast(`模板「${t.name}」载入失败：${(err as Error).message}`);
      return false;
    }
  };

  return (
    <div className="pane-section templates">
      <div className="pane-section-head">
        <button className="small" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} 📚 模板库（{TEMPLATES.length}）
        </button>
      </div>
      {open ? (
        <>
          <input
            className="template-search"
            type="search"
            placeholder="搜索模板：名称 / 标签 / 说明"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="template-list">
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
                  <button className="small" onClick={() => load(t)}>
                    载入到命令列表
                  </button>
                  <button
                    className="small primary"
                    onClick={() => {
                      if (load(t)) onRun();
                    }}
                  >
                    载入并执行
                  </button>
                </div>
              </div>
            ))}
            {list.length === 0 ? <div className="muted">没有匹配的模板</div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
