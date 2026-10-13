# 08 · 模组历史与生态

> 本页是 ColorBlock 模组的历史沿革叙事与社区生态致谢。命令对照表在
> [01-commands](commands.md)（日常要查的放正文，这里不做重复表格）。

## 一、ColorBlock 时代（2019–2022）

ColorBlock 由 **Junior_Mo** 与 **Is_GK**（团队 Another Era）开发，
2019-10-04 发布于 MCBBS（帖号 tid=917845，标题《[1.16.5-1.12.2]
[ColorBlock——新的粒子特效拓展]用粒子去做很多有意思的东西》，
最后编辑 2022-11-20）。

**版本史**（据原帖，经社区转述）：

| 版本 | 时间 | 要点 |
|---|---|---|
| 0.0.1 | 2019-10 | 首发 |
| 0.0.7 | 2019-11 | 分组（group）功能 |
| 0.0.8 | — | 粒子多线程更新 |
| **1.0.0** | 2021-05 | 指令格式修改、支持 1.16.5、表达式执行提速 3 倍（终版） |

发布物：ColorBlock-1.0.0-1.12.2.jar（Forge）与
exparticle-1.0.0-1.16.5.jar（Fabric，需 JVM 参数
`--add-opens java.base/java.lang=ALL-UNNAMED`）。1.12.2 配置为
.properties（`MaxParticleCount:1048576`=2²⁰）、1.16.5 为 JSON。
原模组以 **CC0 1.0 Universal**（公共领域）协议发布（据社区维护版
README 转述；原帖随 MCBBS 关站已不可直查）。

> MCBBS（mcbbs.net）已关站，原帖只能经互联网档案馆或社区转述链
> 查阅。本 Wiki 的原帖事实均来自转述，已核对多处来源一致性。

## 二、两条延续线（2022–今）

### ExParticle（hackerm大神，2024-12 起）

- **[EP]粒子扩展（ExParticle）**，NeoForge 1.21.1，LGPL-3.0 开源：
  [mcmod 条目](https://www.mcmod.cn/class/17493.html) ·
  [GitHub](https://github.com/hackermdch/ExParticle) ·
  [Modrinth](https://modrinth.com/mod/exparticle)（2026-08 仍在更新，最新 1.5.2）
- 命令面在 ColorBlock 基础上扩展：custom 系列（attr 表达式逐点算属性）、
  **text**（文字转粒子）、**global-variable**（全局变量）、
  **user-function**（用户自定义函数）、video/video-matrix（视频转粒子，
  需 JavaCV）；子命令改连字符命名风格，根命令改为 `/particlex`
- 版本亮点：1.4.0 新增 e2q/e2qd/normalize 函数、矩阵支持三元表达式；
  1.4.1 修复 conditional 速度表达式 bug（issue #16）；1.5.0 新增外部
  mod API（ExParticleApi / CustomEvaluator）
- 表达式引擎实现为 **ASM 字节码编译**（Lexer→Parser→Optimize→隐藏类），
  非逐 tick 解释——这是它性能的底气（详见
  [02-expressions](expressions.md) 底层实现节，[社区级·源码直读]）

### AnotherColorBlock（noone89，社区重写）

- 社区维护版，开发代号 ParticleEx（Mod ID `particleex`），根命令沿用
  **`/particleex`**，命令树 1:1 沿用 ColorBlock：23+ 个 MC 版本分支
  （1.17.1 – 26.2+），每分支 Fabric + NeoForge 双加载器；
  [GitHub](https://github.com/YuEr159/AnotherColorBlock)
- 新增代码按 GPL-3.0 发布（原 CC0 部分维持 CC0）；本 Wiki 的预览工具
  ColorblockViewer 即按它的命令语义 1:1 复刻

## 三、生态工具（OCEAN 三件套与预览器）

**Minecraft_OCEAN**（B 站 UID 693976733，服务器技术支持：爱吃饺子的
吴先生）补齐了早期生态的工具链：

| 工具 | 地址 | 说明 |
|---|---|---|
| 指令生成器站 | mc.ecyft.top（镜像 tools.pj568.top、colorblock.neocities.org） | 网页选参数生成命令；内置 17 个现成案例与模板；1.12.2/1.16.5 模式切换 |
| Particlex Viewer | viewer.dbi.top | 网页版粒子预览器（另一条实现路线） |
| 官方教程视频 | B 站《更好的粒子》《赋予生命的粒子》《粒子特效在线预览器》 | 三集教学（BV1984y1s79M / BV1Ue4y137o7 / BV17P49zeERE） |

另有 **ColorblockViewer**（本项目，YuEr159）：
[yuer159.github.io/ColorblockViewer](https://yuer159.github.io/ColorblockViewer/)
——按 AnotherColorBlock 命令语义 1:1 复刻的浏览器预览，粘贴命令即可
验证效果（1161 个测试锁定）。

## 四、文档线

| 作者 | 作品 | 说明 |
|---|---|---|
| 翊尘呀 | B 站专栏 [cv21908911](https://www.bilibili.com/read/cv21908911)（1.16.5 字段序，2025-02 编辑）+ [mcmod 教程帖 post/4889](https://www.mcmod.cn/post/4889.html)（1.21.1 表达式语法全表） | 声明前两三章改编自 MCBBS 失效原帖——原帖教程事实上的继承者；专栏结尾明确推荐 ExParticle |
| Minecraft_OCEAN | OCEAN 站教程页（5 步安装/各子命令/运算符表/mcfunction） | 1.16.5 口径，声明参考原帖 |
| 本 Wiki | [ColorblockViewer Wiki](https://yuer159.github.io/ColorblockViewer/wiki/) | 按 26.2/1.21.11 语义 1:1 整理，含版本差异与来源标注 |

## 五、贡献者致谢

**开发**：Junior_Mo、Is_GK（ColorBlock 原作）· hackerm大神
（ExParticle 延续）· noone89（AnotherColorBlock 社区重写）
**工具**：Minecraft_OCEAN（生成器站/预览器/教程）、爱吃饺子的吴先生
（服务器支持）· YuEr159（ColorblockViewer / NBS2schematic）
**文档与教学**：翊尘呀（两代教程）· PFS_Godcommands（圆形函数库）、
故知（菊型球等案例）、VipExArtz / 矾丰Wind / 启辰早学 / 钻石君 /
ATC_rock 等（B 站教学 UP 群像）· 1maginer / vipolertu / 莱德西多
（基岩版粒子名录）

> 完整的「谁做了什么」图谱（含各条目的依据链接）由社区情报库维护，
> 本页只收录对模组与工具链有直接贡献者。

## 六、引用规范（本 Wiki 全站执行）

- **视频**：B 站 @UP主《标题》（BV 号）——静态定稿物，不加访问日期
- **专栏/文档**：作者《标题》（平台 + cv号/post号）
- **站点**：站名 + URL——在线内容可能变化，**标注访问日期**
- **置信级标注**：[源码级]（模组/游戏字节码或源码直读）、[官方级]
  （作者发布帖/文档原文）、[社区级]（视频/论坛/专栏转述；未实测的
  推导加「·推导」、未验证的标「待验证」）
- 引用 Bili-Video-Learn 知识库存档时以脚注一句话提及（该库为本地
  私库，不提供链接），Wiki 正文只链公开来源
