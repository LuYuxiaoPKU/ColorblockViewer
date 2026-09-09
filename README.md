# ColorBlockViewer

> **v1.0** · 纯前端静态网站 · 无需安装游戏，浏览器里预览 Minecraft 粒子效果

[在线体验](https://luyuxiaopku.github.io/ColorblockViewer/) ·
[技术路线综述](docs/技术路线.md)

## 这是什么

Minecraft 玩家调粒子效果的痛点：`/particle` 或模组的粒子命令参数多、表达式
复杂，改一次就要回游戏里执行一次看效果，来回切换非常低效。

**ColorBlockViewer 把粒子模拟搬进浏览器**：粘贴命令（或用结构化表单填参数），
页面内 3D 实时渲染粒子的生成、运动与逐 tick 动画，支持播放/单步/倍速/重置。
命令语法与求值语义**按模组 Java 源码 1:1 复刻**——包括报错提示文案，预览里
对的行为，进游戏就是同样的行为。

## 预览对象

### 1. AnotherColorBlock 模组的 `/particleex` 命令

**AnotherColorBlock** 是一个 Minecraft Fabric 粒子效果模组：它用自定义
`/particleex` 命令生成位置/颜色/速度随表达式逐 tick 变化的粒子——例如极坐标
运动（`x,y,z=4*cos(t*0.2),0,4*sin(t*0.2)` 的环形火焰）、颜色随时间渐变、
条件触发生成、粒子分组批量修改。命令家族共 13 个子命令：

- `normal` — 固定参数生成
- `conditional` — 表达式条件触发生成
- `parameter` / `polarparameter` / `tickparameter` / `tickpolarparameter` —
  位置随参数/极坐标/tick 表达式变化
- `rgbaparameter` / `rgbapolarparameter` / `rgbatickparameter` /
  `rgbatickpolarparameter` — 颜色随表达式变化
- `group remove` / `group change` — 粒子分组批量移除/改写
- `clearparticle` — 清空全部预览粒子

模组 1.21.1–26.2 各版本分支的命令树与表达式引擎经源码 diff 确认完全一致，
因此本预览对模组支持的**全部 MC 版本**语义有效。

### 2. 原版 `/particle` 命令

`particle <粒子名> [pos] [delta] [speed] [count] [normal]`，粒子名覆盖所选
MC 版本的**全部注册类型**（1.21.11 → 116 种、26.2 → 126 种，表单下拉建议），
支持 `type{NBT}` 复杂类型写法。粒子类型表与贴图按 **1.21.11 / 26.2** 双版本
分区（设置面板切换），数据从 Mojang 官方客户端 jar 提取（sha1 校验）。
客户端语义复刻：`delta`/`speed` 为各轴高斯标准差，`count=0` 为单粒子精确生成。

## 功能一览

- **双向同步**：表单 ↔ 命令文本，结构化数组为唯一真源（粘贴自动填表，
  改表自动更新文本）
- **表达式实时校验**：防抖编译检查，英文原文 + 中文提示 + 语法高亮
- **1:1 语义复刻**：表达式引擎（Int32 除法/取模/常量折叠/矩阵/函数重载）与
  粒子生命周期按模组源码逐字核对，golden 测试锁行为（697 个测试）
- **播放控制**：▶⏸ / 单步 / 0.125×–8× 倍速（0.25×/0.5×/0.125× 慢速档便于
  逐帧观察）/ 回放重置；20 TPS 逻辑与 60Hz 渲染解耦
- **设置**：玩家位置（`~` 基准）、默认寿命、粒子上限、随机种子、游戏版本、
  3D 网格、原版运动学（26.2 约 50 个类型按字节码证据做摩擦/重力/随机寿命/
  portal 漂移等，可关闭回退匀速直线）
- **官方贴图**：粒子使用从 MC 官方客户端提取的真实贴图；多帧类型按原版
  age-progress 语义选帧（随寿命推进、只播一遍）+ 后半程线性淡出

## 领域位置

Minecraft 粒子效果的可调试性长期是个空白点：原版 `/particle` 只能进游戏实测，
社区资料基本是 Wiki 的参数表；表达式驱动的模组粒子命令更是没有官方外的
可视化工具，调参靠"改一行、回游戏、跑一遍、截图"循环。

已有先例按形态分三类（检索核查于 2026-09-07）：

- **游戏内预览/生成模组**：[ParticlePeek](https://modrinth.com/mod/particlepeek)
  （Fabric，GUI 浏览粒子、实时预览并复制 `/particle` 命令，需进游戏）；
  [ExParticle](https://modrinth.com/mod/exparticle)（NeoForge 1.21.1，
  `/particlex` + 数学表达式 + `tick-parameter` 逐 tick 子命令，游戏内运行）
- **浏览器内粒子编辑器**：[Snowstorm](https://jannisx11.github.io/snowstorm/)
  （基岩版粒子 JSON/Molang 编辑器，双击 HTML 离线打开、实时 3D 预览，
  但不接收 Java 版命令文本）
- **参考文档**：Minecraft Wiki 的
  [`/particle` 命令](https://zh.minecraft.wiki/w/命令/particle)、
  [粒子清单](https://zh.minecraft.wiki/w/Java版粒子)、
  [粒子数据格式](https://zh.minecraft.wiki/w/粒子数据格式)（命令用 SNBT）

"网页 3D 粒子编辑"与"命令/表达式驱动粒子"两条路径各自都有先例，但截至检索日
**未发现**同时满足「免安装网页 + 粘贴命令文本 + 3D 实时 + 逐 tick 动画」的
公开项目。ColorBlockViewer 的定位正是把两者结合：命令解析、参数化表达式与
逐 tick 3D 预览在浏览器内一次完成；不做粒子编辑/导出（游戏内用模组/数据包
即可完成），与上述工具和 Wiki 参考互补而非重叠。

## 快速使用

1. 打开在线页面（或 `npm run dev` 本地开发）
2. 在左侧粘贴 `/particleex …` 或 `/particle …` 命令 → 自动解析填表
3. 点「执行」→ 右侧 3D 视口播放；参数改动即时反映在命令文本
4. 表达式输错会当场红字提示，不用进游戏才发现

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # Vitest（697 tests）
npm run build      # tsc --noEmit + vite build
npm run preview    # 本地预览构建产物
npm run assets "26.2"   # 重新提取指定 MC 版本的粒子贴图（需本地 MC 或官方镜像；
                        # 注册表提取需 JDK。产物已入库，日常构建无需）
```

**技术栈**：React 19 + Three.js（自定义点云 shader）+ TypeScript + Vite +
Vitest，无后端。GitHub Actions 自动部署到 GitHub Pages。

架构细节、1:1 移植方法论、验证策略与已知简化清单见
[技术路线综述](docs/技术路线.md)。
