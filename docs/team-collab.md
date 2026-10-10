# 并行团队协作登记（2026-10-10 建立）

> 目的：让本机多个并行 Claude 会话互知定位、明确关联性，方便后续
> 新会话接手（本文件为协作侧登记；Wiki 正式内容见 docs/wiki/）。

## 成员与定位

| 会话 | 目录 | 定位 | 权威/产出 |
|---|---|---|---|
| **ColorblockViewer 预览**（本会话） | C:\00_Data\RGM\ColorBlockViewer | /particleex 命令语义 1:1 复刻 + 浏览器预览（1161 测试）；Wiki 素材 | docs/使用手册.md、docs/技术路线.md、docs/wiki/ |
| **Bilibili 视频摘要学习** | Bili-Video-Learn | B 站 ColorBlock/粒子视频学习：社区用法、踩坑、生态工具情报 | 社区笔记（标注版本风险） |
| **AnotherColorBlock 模组开发** | C:\00_Data\RGM\AnotherColorBlock | 模组本体（1.21.11 多平台模板 CI 全绿；26.3 适配中） | 命令树/11 S2C payload 语义的权威源；docs/particle-cases.md |
| **NBS-投影项目（NBS2schematic）** | C:\00_Data\RGM\NBS2schematic | NBS 乐谱 → .litematic + particleex 粒子数据包生成器 | 消费模组源码 + 引用预览引擎查证；命令参考笔记（14 字段序/球坐标/image 18 token） |

## 关联性（分工链条）

```
B站视频学习（社区用法/生态情报）
        ↓ 输入
ColorblockViewer 预览（语义 1:1 实现 + Wiki 素材 = 权威口径）
        ↔ 双向校验
AnotherColorBlock 模组（实现事实：命令树/S2C —— 权威源）
        ↓ 查证
NBS2schematic（命令生成器 —— 反向验证我的解析器）
```

- **社区 → 语义 → 实现 → 生成**：视频学到的用法经预览引擎验证后可进 Wiki/模板库；
  模组命令树变更第一时间同步预览；生成器产出的命令由预览引擎反向验证。
- 交换协议：语法事实（实现/生成侧） ↔ 引擎解析确认（预览侧）双向反馈。

## 协作协议（已确认）

1. **Wiki 命令语法以使用手册.md 为权威**（社区笔记标注版本风险，如「1.16.5 亮度参数不填」）
2. **版本差异显式标注**：网易版专属语法标「网易版专属」，不混入国际版口径
3. **命令树变更同步**：模组新增子命令 → 立即通知预览会话（近期无计划，若有 image 扩展会同步）
4. **发现即通报**：image/imageMatrix/video/videoMatrix/clearCache/functionList
   6 子命令为预览缺口（2026-10-10 确认）→ 模组权威字段序已确认、预览解析已落地（55f610d）

## 待办（协作产出）

- [x] 模组会话提供 6 个缺失子命令字段序 → 预览补解析 + Wiki 同步（2026-10-10 完成：rotate 90 倍数、flip 枚举词、speed 逐槽 null、imageMatrix 用 matrix）
- [x] 视频学习会话回传 image 老版本证据（已收：18 token 语法/flip 取值/particleImages/ 路径）→ 与模组确认新版差异（结论：新版字段序同老版本，rotate 必须 90 倍数——NBS 上线 4 天未生效即因字段序）
- [ ] 预览模板库采纳社区高频用法（呼吸缩放 i=0.1*sin(t/5) 等）
- [ ] 参照物原版化：4 种参照物（史蒂夫/命令方块/橡树/袭击哨塔）须用原版贴图、原版建模与建筑结构（2026-10-10 用户要求；当前 121c2df 为纯 three 几何道具，无贴图）
- [x] NBS 参考笔记 ↔ 预览引擎互检（生成命令可被引擎解析：polarparameter/tickpolarparameter/group remove/conditional/image 五类真实命令已进 tests/command/imageCommands.test.ts 回归）

## 环境口径备忘

- 模组当前主分支瞄准：26.3 适配中（26.x 映射生态 modern-yarn）；1.21.11 多平台模板
- 预览基线：26.2 client.jar 混淆版逐字节码（命令树核对）——与模组命令树差异即上述 6 子命令
- 粒子上限：原版 1.6 万 / ColorBlock 104.8 万（2^20）；预览默认 100 万
- 可视距离：normal 32 格 / force 256 格（社区口径）