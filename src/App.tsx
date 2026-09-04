export default function App() {
  return (
    <div className="app-layout">
      <aside className="pane">
        <h1>ColorBlockViewer</h1>
        <p className="muted">AnotherColorBlock 粒子效果预览（脚手架占位，M5 实现完整 UI）</p>
      </aside>
      <main className="viewport">
        <div className="viewport-placeholder">3D 视口（M4 接入 Three.js）</div>
      </main>
    </div>
  );
}
