import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base 必须与 GitHub 仓库名（大小写）一致，部署 GitHub Pages 用
export default defineConfig({
  base: '/ColorblockViewer/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
