# ColorBlockViewer

纯前端静态网站：预览 Minecraft Fabric 模组 **AnotherColorBlock** 的 `/particleex`
粒子效果，以及**原版** `/particle` 命令（粒子类型表/贴图按 1.21.11 / 26.2 分区，
可切换）。粘贴命令（或使用结构化表单），浏览器内 3D 渲染粒子生成与逐 tick 动画。

## 功能

- **10 种模组命令**：`normal` / `conditional` / `parameter` 家族 8 变体（polar/tick/rgba）
  + `group remove|change` + `clearparticle`
- **原版 `/particle`**（命令树逐字核对 `ParticleCommand`；粒子类型表与贴图按
  **1.21.11 / 26.2** 两个版本分区，设置面板可切换）：
  `particle <粒子名> [pos] [delta] [speed] [count] [normal]`，粒子名支持所选版本
  全部注册类型（1.21.11 → 116、26.2 → 126，表单下拉建议）与 `type{NBT}` 复杂类型
  （NBT 载荷按类型名近似渲染）；
  客户端语义复刻：`delta`/`speed` 为各轴**高斯标准差**（位置/速度随机），`count=0`
  为单粒子精确生成
- **双向同步**：表单 ↔ 命令文本，结构化数组为唯一真源（粘贴自动填表，改表自动更新文本）
- **表达式实时校验**：`ExprField` 防抖编译检查，英文原文 + 中文提示 + 语法高亮
- **1:1 语义复刻**：表达式引擎（Int32 除法/取模/常量折叠/矩阵/函数重载）与粒子生命周期
  （customMove 的 pre/stop 回滚、age 恒 0 缺陷、组索引惰性清理、错误消息逐字）按模组
  Java 源码逐字核对，golden 测试锁行为
- **播放控制**：▶⏸ / 单步 / 1x–8x 倍速 / 回放重置；墙钟累加器驱动 20 TPS 逻辑，
  与 60Hz 渲染解耦
- **设置**：玩家位置（`~` 基准）、默认寿命（近似值）、粒子上限、随机种子、
  游戏版本（`/particle` 的粒子类型表与贴图分区）

## 版本支持

- **模组命令**（`/particleex`）：按 AnotherColorBlock **1.21.11** 源码 1:1 语义复刻。
  跨分支源码 diff（1.21 / 1.21.11 / 26.1 / main）确认：1.21.1–26.2 各分支的命令树、
  参数类型、表达式引擎**完全一致**，差异仅在权限 API 与 yarn 改名等渲染侧文件，
  故本预览对模组支持的全部 MC 版本（1.21.1–26.2）语义有效。
- **原版 `/particle`**：粒子类型注册表与贴图按版本分区，当前内置 **1.21.11**
  （116 类型 / 251 贴图）与 **26.2**（126 类型 / 285 贴图），设置面板切换后
  表单下拉与渲染图集同步切换（贴图图集按版本独立缓存）。两版数据均从
  Mojang 官方客户端 jar 提取（sha1 校验）。

## 预览简化（与游戏内差异）

- **贴图近似**：粒子贴图取自 Minecraft 官方客户端（构建脚本
  `npm run assets <版本>` 从 Mojang 官方镜像提取，帧表与 MC data-driven 粒子定义
  一致；当前内置 1.21.11 与 26.2 两版，产物已入库），
  帧动画 1/20 s/帧、颜色按命令值乘法着色、统一加色混合；`block`/`dust`/`item`
  等按方块纹理实时渲染的类型与未知名 → 回退软发光圆点（按类型微调 size/alpha/色相）。
  原版命令的 `type{NBT}`（如 `dust{Red:1f,…}`）不解析 NBT 载荷，按类型名近似
  （dust 用其帧表而非 NBT 指定颜色）
- **原版命令的寿命**：原版按粒子类型各有 duration，预览统一走「默认寿命」近似值
- **原版命令的 force/viewers**：观察者/分发参数与预览无关 → 解析层明确报错
- **匀速直线运动**：无重力/阻力/类型专属运动（smoke 上升等不做）
- **默认寿命近似**：`age=0` 时用单一可配置值（MC 中因粒子类型而异）
- **随机序列不一致**：`normal` 高斯偏移与原版 `/particle` 的 delta/speed 用固定种子
  PRNG，保证同一次预览可复现，不逐粒子对齐游戏内 Java `Random` 序列

## 本地开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # Vitest（621 tests：引擎 golden / 命令解析 / 仿真生命周期 / 渲染 / UI 集成）
npm run build      # tsc --noEmit + vite build（base /ColorblockViewer/）
npm run preview    # 本地预览构建产物
npm run assets     # 重新提取粒子贴图，参数为 MC 版本：npm run assets "26.2"（或 "1.21.11"）
                   # 本地 MC 安装（MC_JAR 环境变量）> 官方镜像；注册表提取需 JDK（javap），
                   # 混淆版本（≤1.21.9）走字节码标记扫描。产物已入库，日常构建无需
```

## 部署

GitHub Actions：`push main` → `npm ci && npm test && tsc --noEmit && vite build`
→ `actions/configure-pages` + `upload-pages-artifact` + `deploy-pages`，
站点地址 `https://luyuxiaopku.github.io/ColorblockViewer/`。

## 技术栈

React 19 + Three.js（自定义点云 shader）+ TypeScript + Vite + Vitest，无后端、无状态库
（`useSyncExternalStore` 轻量外部 store）。
