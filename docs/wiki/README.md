# ColorBlock 模组 Wiki

> 面向玩家与进阶用户的 ColorBlock 模组知识库。内容由
> [ColorblockViewer 预览工具项目](https://github.com/LuYuxiaoPKU/ColorblockViewer)
> 按模组 Java 源码 1:1 移植过程中的一手语义整理（1161 个测试锁定），
> 报错文案、表达式行为均与游戏逐字一致。

## 目录

- [00-overview](00-overview.md) — 模组是什么、历史与命名、版本支持
- [01-commands](01-commands.md) — 命令大全（13 个子命令逐条 + 参数表）
- [02-expressions](02-expressions.md) — 表达式系统（语法/变量/函数/矩阵）
- [03-nbt](03-nbt.md) — `type{NBT}` 选项语法与陷阱
- [04-particles](04-particles.md) — 粒子类型清单与版本分区
- [05-examples](05-examples.md) — 实战示例（全部引擎实测）
- [06-faq](06-faq.md) — 常见问题

> 术语口径：**原版模组** = ColorBlock（MCBBS 版本，CC0 协议，原帖已失）；
> **社区版** = AnotherColorBlock（内部名 ParticleEx）；**预览工具** =
> ColorblockViewer（独立浏览器工具，非模组）。三者勿混。

## 快速上手

1. 在游戏内（或 [预览工具](https://luyuxiaopku.github.io/ColorblockViewer/)）输入：
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