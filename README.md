# ColorBlockViewer

纯前端静态网站：预览 Minecraft Fabric 模组 **AnotherColorBlock** 的 `/particleex` 粒子效果。
粘贴命令（或使用结构化表单），浏览器内 3D 渲染粒子生成与逐 tick 动画。

## 功能

- **10 种粒子命令**：`normal` / `conditional` / `parameter` 家族 8 变体（polar/tick/rgba）
  + `group remove|change` + `clearparticle`
- **双向同步**：表单 ↔ 命令文本，结构化数组为唯一真源（粘贴自动填表，改表自动更新文本）
- **表达式实时校验**：`ExprField` 防抖编译检查，英文原文 + 中文提示 + 语法高亮
- **1:1 语义复刻**：表达式引擎（Int32 除法/取模/常量折叠/矩阵/函数重载）与粒子生命周期
  （customMove 的 pre/stop 回滚、age 恒 0 缺陷、组索引惰性清理、错误消息逐字）按模组
  Java 源码逐字核对，golden 测试锁行为
- **播放控制**：▶⏸ / 单步 / 1x–8x 倍速 / 回放重置；墙钟累加器驱动 20 TPS 逻辑，
  与 60Hz 渲染解耦
- **设置**：玩家位置（`~` 基准）、默认寿命（近似值）、粒子上限、随机种子

## 预览简化（与游戏内差异）

- **贴图近似**：粒子贴图取自 Minecraft 26.2 官方客户端（构建脚本
  `npm run assets` 从 Mojang 官方镜像提取，帧表与 MC data-driven 粒子定义一致），
  帧动画 1/20 s/帧、颜色按命令值乘法着色、统一加色混合；`block`/`dust`/`item`
  等按方块纹理实时渲染的类型与未知名 → 回退软发光圆点（按类型微调 size/alpha/色相）
- **匀速直线运动**：无重力/阻力/类型专属运动（smoke 上升等不做）
- **默认寿命近似**：`age=0` 时用单一可配置值（MC 中因粒子类型而异）
- **随机序列不一致**：`normal` 高斯偏移用固定种子 PRNG，保证同一次预览可复现，
  不逐粒子对齐游戏内 Java `Random` 序列

## 本地开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # Vitest（585 tests：引擎 golden / 命令解析 / 仿真生命周期 / 渲染 / UI 集成）
npm run build      # tsc --noEmit + vite build（base /ColorblockViewer/）
npm run preview    # 本地预览构建产物
npm run assets     # 重新提取 MC 26.2 粒子贴图（本地 MC 安装 > 官方镜像；产物已入库，日常构建无需）
```

## 部署

GitHub Actions：`push main` → `npm ci && npm test && tsc --noEmit && vite build`
→ `actions/configure-pages` + `upload-pages-artifact` + `deploy-pages`，
站点地址 `https://luyuxiaopku.github.io/ColorblockViewer/`。

## 技术栈

React 19 + Three.js（自定义点云 shader）+ TypeScript + Vite + Vitest，无后端、无状态库
（`useSyncExternalStore` 轻量外部 store）。
