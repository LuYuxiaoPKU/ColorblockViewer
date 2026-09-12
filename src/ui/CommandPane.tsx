// CommandPane（计划 §九）：粘贴框 + 类型 tabs（新增命令）+ 按 kind 的表单
// （双向同步）+ 设置抽屉 + toast。文本框内容派生自 commands 真源。

import { useMemo, useState } from 'react';
import { serializeAll } from '../command/serialize';
import { checkCommandsFormat } from '../command/gameFormat';
import {
  useAppState,
  getState,
  insertCommandAfter,
  setInputText,
  applyInputText,
} from '../store/appState';
import {
  DEFAULT_NORMAL,
  DEFAULT_CONDITIONAL,
  DEFAULT_VANILLA,
  makeParameter,
  DEFAULT_GROUP_CHANGE,
  DEFAULT_GROUP_REMOVE,
  DEFAULT_CLEAR,
} from '../store/appState';
import type { ParticleCommand } from '../command/types';
import { CommandForm } from './CommandForm';
import { SettingsDrawer } from './SettingsDrawer';
import { StatusToast } from './StatusToast';
import { FeaturedTemplates, TemplateGallery } from './TemplateGallery';

// 类型 tabs（新增命令用；parameter 家族 8 变体收进一个 tab 展开）
const TABS: { label: string; make: () => ParticleCommand }[] = [
  { label: 'normal', make: () => structuredClone(DEFAULT_NORMAL) },
  { label: 'conditional', make: () => structuredClone(DEFAULT_CONDITIONAL) },
  { label: 'particle（原版）', make: () => structuredClone(DEFAULT_VANILLA) },
  { label: 'group change', make: () => structuredClone(DEFAULT_GROUP_CHANGE) },
  { label: 'group remove', make: () => structuredClone(DEFAULT_GROUP_REMOVE) },
  { label: 'clear', make: () => ({ ...DEFAULT_CLEAR }) },
];

const PARAM_VARIANTS = [
  'parameter', 'polarparameter', 'tickparameter', 'tickpolarparameter',
  'rgbaparameter', 'rgbapolarparameter', 'rgbatickparameter', 'rgbatickpolarparameter',
];

export function CommandPane({ onRun }: { onRun: () => void }) {
  const { commands, input, toasts } = useAppState();
  const [inputDirty, setInputDirty] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [paramOpen, setParamOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // 游戏内格式检查（实时）：文本参数按 brigadier 未加引号字符集判定 ——
  // 预览分词宽松（未加引号也能解析），但粘回游戏会被截断，这里如实标出。
  const formatIssues = useMemo(() => checkCommandsFormat(input), [input]);

  const add = (cmd: ParticleCommand) => insertCommandAfter(commands.length - 1, cmd);

  return (
    <div className="command-pane">
      <section className="pane-section">
        <div className="pane-section-head">
          <span>命令（多行，每行一条）</span>
          <button className="small" onClick={() => setGalleryOpen(true)} title="模板展示：复制命令 / 载入">
            📚 模板库
          </button>
          <button className="primary small" onClick={onRun}>执行</button>
        </div>
        {/* 精选入口（常驻）：命令列表为空时是「从模板开始」引导 */}
        <FeaturedTemplates onOpenAll={() => setGalleryOpen(true)} onRun={onRun} />
        <textarea
          className="cmd-input"
          rows={6}
          spellCheck={false}
          value={input}
          onChange={(e) => {
            setInputText(e.target.value);
            setInputDirty(true);
            setApplyError(null);
          }}
        />
        {inputDirty ? (
          <div className="btn-row">
            <button
              onClick={() => {
                const err = applyInputText();
                setApplyError(err);
                setInputDirty(false);
              }}
            >
              应用（解析并同步到表单）
            </button>
            <button
              onClick={() => {
                // 放弃编辑：文本重新对齐真源
                setInputText(serializeAll(getState().commands));
                setInputDirty(false);
              }}
            >
              放弃
            </button>
          </div>
        ) : null}
        {applyError ? (
          <div className="errors">
            {applyError}
            <div className="expr-status-cn">无法结构化的行不会写入表单，请修正后重试。</div>
          </div>
        ) : null}
        {/* 游戏内格式检查：文本参数（表达式/组名）必须满足 brigadier 未加引号字符集，
            否则游戏里会被截断；表单回显/复制链接都按该规范输出（serialize 自动补 '…'） */}
        <div className={formatIssues.length === 0 ? 'format-check ok' : 'format-check bad'}>
          {formatIssues.length === 0 ? (
            <span>
              ✅ 格式检查：每行都符合游戏内 brigadier 格式（表达式已按需用 <code>'…'</code> 包住，可直接粘回游戏）
            </span>
          ) : (
            <>
              <span>
                ⚠️ 格式检查：{formatIssues.length} 行的引号用法与游戏不符（预览仍会宽松解析，但粘回游戏会失败）：
              </span>
              <ul>
                {formatIssues.slice(0, 5).map((r) => (
                  <li key={r.line}>
                    第 {r.line} 行：{r.issues.map((i) => i.message).join('；')}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="pane-section">
        <div className="pane-section-head">
          <span>命令列表（点类型新增）</span>
        </div>
        <div className="btn-row tabs">
          {TABS.map((t) => (
            <button key={t.label} onClick={() => add(t.make())}>
              + {t.label}
            </button>
          ))}
          <span className="tab-wrap">
            <button className={paramOpen ? 'active' : ''} onClick={() => setParamOpen(!paramOpen)}>
              + parameter ▾
            </button>
            {paramOpen ? (
              <div className="tab-sub">
                {PARAM_VARIANTS.map((v) => (
                  <button key={v} className="small" onClick={() => add(makeParameter(v))}>
                    {v}
                  </button>
                ))}
              </div>
            ) : null}
          </span>
        </div>

        <div className="cmd-list">
          {commands.map((c, i) => (
            <CommandForm key={i} cmd={c} i={i} />
          ))}
        </div>
      </section>

      <SettingsDrawer />
      <StatusToast toasts={toasts} />
      {/* 模板库：右侧覆盖面板（画布保持可见，便于「载入并执行」边看边试） */}
      <TemplateGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} onRun={onRun} />
    </div>
  );
}
