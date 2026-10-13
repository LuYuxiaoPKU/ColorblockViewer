---
title: ColorBlock 模组 Wiki
description: 面向玩家与进阶用户的 ColorBlock 模组知识库——命令大全、表达式系统、NBT 语法、粒子类型与实战示例
---

# ColorBlock 模组 Wiki

> 面向玩家与进阶用户的 ColorBlock 模组知识库。内容由
> [ColorblockViewer 预览工具项目](https://github.com/YuEr159/ColorblockViewer)
> 按模组 Java 源码 1:1 移植过程中的一手语义整理（1161 个测试锁定），
> 报错文案、表达式行为均与游戏逐字一致。

## 目录

- [00-overview](overview.md) — 模组是什么、三代沿革与命名、生态工具
- [08-history](history.md) — 模组历史与生态（版本史/延续线/贡献者致谢/引用规范）
- [01-commands](commands.md) — 命令大全（18 个一级子命令逐条 + 三代命令名对照）
- [02-expressions](expressions.md) — 表达式系统（语法/变量表/球坐标/缓动/矩阵）
- [03-nbt](nbt.md) — `type{NBT}` 选项语法与陷阱
- [04-particles](particles.md) — 粒子类型清单与版本分区
- [05-examples](examples.md) — 实战示例（社区案例 + 全部引擎实测）
- [06-faq](faq.md) — 常见问题（含三代粒子上限口径）
- [07-templates](templates.md) — 预览模板库（权威清单，与代码逐字对齐）

> 术语口径：**ColorBlock** = 原版模组（MCBBS，CC0，两代：1.12.2 Forge /
> 1.16.5 Fabric）；**ExParticle** = ColorBlock 高版本延续（hackerm大神，
> NeoForge 1.21.1，根命令 `/particlex`）；**AnotherColorBlock** = 社区重写
> 延续（noone89，根命令 `/particleex`，本预览工具的语义基准）；
> **ColorblockViewer** = 预览工具（独立浏览器工具，非模组）。沿革详见
> [00-overview](overview.md) 与 [08-history](history.md)。

## 快速上手

1. 在游戏内（或 [预览工具](https://yuer159.github.io/ColorblockViewer/)）输入：
   ```
   particleex normal minecraft:flame 0 0 0 1 1 1 1 0 0 0 0 0 0 100
   ```
   在 (0,0,0) 生成 100 个红色火焰粒子，原地燃起。
2. 想让它飞起来：改速度三个数
   ```
   particleex normal minecraft:flame 0 0 0 1 1 1 1 0 0 1 0 0 0 10
   ```
   向上飞（速度 z 或 y 决定方向，见 01-commands）。
3. 想随时间动起来（模组招牌功能）：换 `parameter` 系列，见 02-expressions。