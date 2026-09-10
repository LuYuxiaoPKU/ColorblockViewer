import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applySharedSearch } from './share/bootstrap';
import { loadShared, pushToast, getState } from './store/appState';
import './styles.css';

// 分享链接：首渲染前从 ?s= 还原命令与设置（损坏载荷 → toast，不动默认场景）
applySharedSearch(
  window.location.search,
  getState().sim,
  loadShared,
  pushToast,
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
