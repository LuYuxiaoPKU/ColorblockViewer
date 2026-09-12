import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base 必须与 GitHub 仓库名（大小写）一致，部署 GitHub Pages 用
export default defineConfig({
  base: '/ColorblockViewer/',
  plugins: [react()],
  build: {
    // three 是唯一 >500KB 的 chunk，且已改为按需加载（见下）→ 阈值提到 600，
    // 保留「应用自身代码异常膨胀」的告警能力（既有 app/react chunk 均 <200KB）。
    chunkSizeWarningLimit: 600,
    // 产物拆包：three（≈540KB，仅渲染层需要）与 react 各自成 chunk。
    // App 侧用动态 import 加载 render/sync → three chunk 不阻塞首屏：
    // 先出命令面板/设置（可立即输入），three 到达后再挂载画布。
    // 注意：UI 侧不能经 points.ts 取粒子数据（那会把 three 拉回静态图），
    // 纯数据走 render/particleData.ts。
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
