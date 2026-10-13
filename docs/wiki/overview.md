# 00 · 模组总览

## 这是什么

ColorBlock 是一个为 Minecraft 增加粒子命令的模组：用一条（或一组）
命令在指定位置生成大量自定义粒子，并支持**用表达式随时间控制粒子的
位置、速度、颜色**——做出涟漪、圆环、波形、拖尾等复杂特效，不需要
资源包、不需要模型。

它新增的命令以 `/particleex` 开头（版本差异见下）；同时保留原版
`/particle` 的全部能力（预览工具也可解析原版命令）。

## 模组沿革（三代）

| 代际 | 模组 | MC 版本 | 加载器 | 状态 |
|---|---|---|---|---|
| 第一代 | ColorBlock 1.0.0 | 1.12.2 | Forge | 停止维护（MCBBS 已关站） |
| 第二代 | ColorBlock（exparticle-1.0.0-1.16.5.jar） | 1.16.5 | Fabric | 停止维护（过渡版） |
| 第三代 | **ExParticle**（hackerm大神） | 1.21.1+ | NeoForge | 活跃维护，LGPL-3.0 |
| 社区重写版 | **AnotherColorBlock**（noone89） | 1.17.1 – 26.2+ 多分支 | Fabric + NeoForge | 活跃维护，GPL-3.0 |

**沿革叙事**：ColorBlock 由 Junior_Mo 与 Is_GK（团队 Another Era）
开发，2019-10-04 发布于 MCBBS（帖号 917845），版本史
0.0.1（2019-10）→ 0.0.7（分组）→ 0.0.8（粒子多线程）→ 1.0.0（2021-05，
指令格式修改、支持 1.16.5、表达式执行提速 3 倍）。MCBBS 关站后原帖
不可访问，教程由翊尘呀的 mcmod 教程帖（post/4889）继承。此后两条
延续线并存：hackerm 大神的 **ExParticle**（NeoForge 1.21.1，命令面
扩展了 custom 系列 / text / global-variable / user-function 等）；以及
noone89 的 **AnotherColorBlock**（社区重写，多 MC 版本分支，命令树
1:1 沿用 ColorBlock）——本 Wiki 的预览工具即按后者的命令语义 1:1 复刻。

> ⚠️ **根命令元信息勿混**：AnotherColorBlock（及两代 ColorBlock）的
> 根命令是 **`/particleex`**；ExParticle（hackerm）的根命令是
> **`/particlex`**，且子命令命名改用连字符风格
> （`polar-parameter` / `clear-particle` / `rgba-parameter`…）。
> 两系命令语义同源但拼写不同，粘贴命令前先确认你装的是哪个模组。

**来源**：MCBBS 原帖内容经社区存档转述（B 站 @翊尘呀《ColorBlock 教程
——更好的粒子》专栏 cv21908911，声明摘抄自 MCBBS 917845；访问日期
2026-10-10）；两代根命令分别由 AnotherColorBlock 1.21.11 发行 jar 的
命令注册字节码与 ExParticle 1.5.2 源码（github.com/hackermdch/ExParticle，
commit 62ccdd4）直读核实。

## 名称速查（易混口径）

| 名称 | 指代 | 说明 |
|---|---|---|
| **ColorBlock** | 原版模组（两代） | MCBBS 发布，CC0 协议（据社区版转述，原帖已失无法直查）；1.0.0 终版支持 1.12.2 Forge / 1.16.5 Fabric |
| **ExParticle** | ColorBlock 高版本延续 | hackerm大神，NeoForge 1.21.1，LGPL-3.0，根命令 `/particlex`；[mcmod 条目](https://www.mcmod.cn/class/17493.html) · [GitHub](https://github.com/hackermdch/ExParticle) · [Modrinth](https://modrinth.com/mod/exparticle) |
| **AnotherColorBlock** | 社区重写延续 | noone89，多版本分支，GPL-3.0（新增代码），根命令 `/particleex`；[GitHub](https://github.com/YuEr159/AnotherColorBlock) |
| **ColorblockViewer** | 预览工具（本项目） | 独立浏览器工具（非模组），按 AnotherColorBlock 命令语义 1:1 复刻 |

> 早期社区讨论中「ExParticle」有时被误当作与 ColorBlock 无关的同类
> 工具——实际它是同一条开发线的延续（原版 1.16.5 Fabric 版 jar 文件名
> 就叫 `exparticle-1.0.0-1.16.5.jar`，且翊尘呀专栏结尾明确推荐 ExParticle
> 为「ColorBlock 的高版本移植」），Wiki 全文按此口径。

## 版本支持（本 Wiki 与预览工具的口径）

- **命令树与表达式引擎**：按 AnotherColorBlock 的 1.21.11 与 26.2 分支
  1:1 移植，跨版本语义一致已验证（1161 个测试锁定）
- **粒子类型表 / 贴图**：按 1.21.11 与 26.2 分区（旧版本类型少，26.2
  新增 geyser 间歇泉系、firefly 萤火虫、trail 轨迹等）
- **ExParticle 独有命令面**（text / custom 系列 / global-variable /
  user-function 等）不属于预览工具覆盖范围，见
  [01-commands](commands.md) 的附表（[社区级·源码直读] 标注）

## 预览工具（强烈推荐配合使用）

https://yuer159.github.io/ColorblockViewer/

- 粘贴命令 → 立刻看效果 → 满意后复制回游戏，命令文本一字不改
- 引擎与模组 1:1 复刻：报错文案、表达式求值、粒子寿命与运动全部一致
- 内置模板（涟漪波面 / 圆周环，清单见 [07-templates](templates.md)）演示模组招牌写法
- 设置面板可切快速模式（纯色圆点）跑大场景

## 生态工具一览

| 工具 | 作者 | 说明 |
|---|---|---|
| [ColorblockViewer](https://yuer159.github.io/ColorblockViewer/) | YuEr159 | 本 Wiki 配套的浏览器预览（1:1 语义） |
| OCEAN 指令生成器站 | Minecraft_OCEAN | mc.ecyft.top（镜像 tools.pj568.top、colorblock.neocities.org），网页选参数生成命令 + 17 个现成案例 + 1.12.2/1.16.5 模式切换 |
| Particlex Viewer | Minecraft_OCEAN | viewer.dbi.top，网页预览器（另一条实现路线） |
| NBS2schematic | YuEr159 | 乐谱 → schematic + particleex 命令生成器（图片/歌词逐帧打印实例来源） |

## 能力边界（Wiki 读者须知）

预览引擎已实现：全部 18 个模组一级子命令 + 原版 /particle 解析；表达式引擎
（含矩阵、条件、随机）；`type{NBT}` 选项（8 类粒子选项）；26.2 运动学
覆盖 100+ 类型（摩擦/重力/寿命与游戏逐字节码一致）。

**不实现**：force/viewers 尾参（原版命令，预览明确报错）；世界依赖的
粒子行为（碰撞、方块检查、流体随机——预览没有世界，见 04-particles）；
纯渲染的贴图发光效果按列表近似（差异清单见预览项目 docs/技术路线.md）。

---

*来源与致谢*：模组沿革与生态事实来自 MCBBS 原帖（917845）的社区转述
链与 [mcmod.cn](https://www.mcmod.cn/class/17493.html) 条目；两代根命令
与命令面为源码/字节码直读（见上标注）；社区教程生态致谢
Minecraft_OCEAN（教程视频与工具站）、翊尘呀（两代教程文档）。部分原始
资料存档于 Bili-Video-Learn 知识库（含 OCR/ASR 原始数据）。完整引用
清单见 [08-history](history.md)。
