// StatusToast：底部浮层显示最近错误/提示（引擎错误 / 解析失败 / 超限），
// 5s 自动消失，可手动关闭。引擎错误（java.lang.Xxx）附中文提示行。

import { useEffect, useRef, useState } from 'react';
import { clearToasts } from '../store/appState';
import { exprCnHint } from './ExprField';

export function StatusToast({ toasts }: { toasts: string[] }) {
  const [visible, setVisible] = useState(false);
  const timer = useRef(0);

  useEffect(() => {
    if (toasts.length === 0) return;
    setVisible(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setVisible(false);
      clearToasts();
    }, 5000);
    return () => window.clearTimeout(timer.current);
  }, [toasts]);

  if (!visible || toasts.length === 0) return null;
  return (
    <div className="toast">
      <div className="toast-head">
        最近消息
        <button className="small" onClick={() => { setVisible(false); clearToasts(); }}>✕</button>
      </div>
      {toasts.map((t, i) => {
        const cn = exprCnHint(t);
        return (
          <div key={i} className="toast-item">
            {t}
            {cn ? <div className="expr-status-cn">{cn}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
