# 04 · 粒子类型清单

粒子名 = 原版 Minecraft 的粒子标识（`minecraft:end_rod`、`minecraft:flame`、
`minecraft:dust{...}` 等），模组不发明新粒子、只增强生成与控制方式。

## 版本分区（十三桶，1.17.1–26.3）

预览工具按**注册表变化点**把 1.17.1–26.3 切成 13 个桶，桶内小版本共享
同一份类型表与运动学（跨版本行为不变：26.2 建表 → 1.21.11 逐类型字节码
核对一致；1.17–26.3 区间无「同类型行为改变」，只有类型增减）。每桶类型
全集 = client.jar 字节码 `<clinit>` 内置注册 ∪ data-driven JSON 类型表，
与 MC 客户端加载语义一致。

| 桶 | 类型数 | 相对上一桶的变化（jar 注册表实测） |
|---|---|---|
| 1.17.1 | 87 | 基线（含 vibration/dust_color_transition/glow 系/wax 系/scrape/electric_spark/spore_blossom 等 1.17 新增；light/barrier 尚在） |
| 1.18.2 | 85 | −`light`、−`barrier`（被 block_marker 机制取代；block_marker 本桶**尚未**入注册表） |
| 1.19.2 | 93 | +`sculk_charge`/`sculk_charge_pop`/`sculk_soul`/`shriek`/`sonic_boom`（幽匿线）+`block`/`block_marker`/`item`（注册表口径，见下方注） |
| 1.20.1 | 95 | +`cherry_leaves`（1.19.4 的 dripping/falling/landing 三件在正式版合并为一件）、+`egg_crack` |
| 1.20.4 | 101 | +`dust_plume`/`white_smoke`/`gust`/`gust_dust`/`gust_emitter`/`trial_spawner_detection`（1.20.3 批次） |
| 1.20.5 | 110 | +`vault_connection`/`small_gust`/`ominous_spawning`/`raid_omen`/`trial_omen`/`infested`/`item_cobweb`/`dust_pillar`/`trial_spawner_detection_ominous`/`gust_emitter_large`/`gust_emitter_small`；−`gust_dust`/`gust_emitter`（拆分改名） |
| 1.20.6 | 110 | 与 1.20.5 同表 |
| 1.21.1 | 110 | 与 1.20.5 同表 |
| 1.21.4 | 113 | +`trail`/`block_crumble`（1.21.2）+`pale_oak_leaves`（1.21.4） |
| 1.21.8 | 115 | +`firefly`/`tinted_leaves`（1.21.5） |
| 1.21.11 | 116 | +`copper_fire_flame`（1.21.9） |
| 26.2 | 126 | +`geyser`/`geyser_base`/`geyser_plume`/`geyser_poof`（间歇泉）、`sulfur_bubbles`/`sulfur_cube_goo`、`noxious_gas`/`noxious_gas_cloud`、`pause_mob_growth`/`reset_mob_growth` |
| 26.3 | 129 | +`red`/`orange`/`yellow_poplar_leaves`（三色杨树落叶） |

> **注册表口径注**：`block`/`item`（方块/物品碎片）在 1.17.1 的提取结果中
> 不在字节码 `<clinit>` 注册序列（它们的粒子选项走独立硬编码路径），
> 1.19.2 起按常规注册出现——`/particle minecraft:block` 在 1.17–1.18 的
> 可用性以游戏内为准，预览端在 1.17.1/1.18.2 桶对它们报未知类型（宁可
> 拒绝，不给假阳性）。
> **gust 系改名**：1.20.4 桶的 `gust_emitter`/`gust_dust` 在 1.20.5 拆分
> 为 `gust_emitter_large`/`gust_emitter_small`（dust 一线移除）——跨版本
> 写脚本时注意桶边界。
> 1.19.4 桶被有意忽略：其独有的三个 cherry_leaves 变体在 1.20 正式版
> 即合并，取 1.20.1 桶即可覆盖 1.19.4 的绝大多数用法（cherry 三变体
> 本身无法用 /particle 直接生成）。

> 提示：用不存在的类型名，预览与游戏报同样错误；`ambient_entity_effect`
> 在 26.2 客户端里有粒子类但**注册表未注册**——命令用它会直接报错（两侧一致；
> 1.17.1 桶里它反而已注册，可用）。

## 常见类型速查（挑选自运动学有证据族）

| 类型 | 观感/用途 | 备注 |
|---|---|---|
| `end_rod` | 白色发光小点（末地烛粒子） | 最常用：模板/图片打印主力；寿命 60–71 tick |
| `flame` | 火焰火星 | 经典火焰系 |
| `soul_fire_flame` | 幽魂蓝火 | |
| `smoke` / `campfire_*` | 烟雾 | campfire 有 500/F 寿命公式与上飘 |
| `crit` | 暴击星 | 摩擦 0.6、寿命短 |
| `heart` | 爱心 | 寿命恒定 16；`angry_villager` 怒气表情同族 |
| `note` | 音符 | 寿命恒定 6 |
| `dust{...}` | 实心圆盘（可自定义颜色/大小） | NBT 选项见 03 |
| `portal` / `reverse_portal` | 传送门紫色 | 曲线是 1+t−2t²（非标准平滑步） |
| `totem_of_undying` | 图腾粒子 | 寿命 60–71 |
| `snowflake` | 雪花 | 逐轴阻尼 |
| `nautilus` / `enchant` / `vault_connection` | 飞向目标的位置式飞行 | 出生即偏一个速度矢量（vault_connection 1.20.5+） |
| `ominous_spawning` | 直线加速飞向 | 1.20.5+ |
| `bubble` / `dripping_*` / `falling_*` | 水泡/滴水/落水 | 原生运动学各轴系数精确到 float |
| `explosion` / `gust_*` / `sonic_boom` | 爆发/尖啸 | 零速出生、速度被丢弃 |
| `spark` / `scrape` / `wax_*` | 铜器交互火星 | 初速 ×0.01 等；铜火星类型名 = `electric_spark`（全版本一致） |

（全量类型名表见预览工具设置面板的版本切换；每桶边界由
tests/engine/versionBuckets.test.ts 的 12 条断言锁定。）

## 基岩版与网易版（一句话口径）

本模组与预览工具均面向 **Java 版**。基岩版（MCBE）的 `/particle` 粒子
名集合与 Java 版不同（约 176 种，社区有专项整理：
[B 站 @1maginer《176种particle粒子收集》](https://www.bilibili.com/video/BV12qRVY4E4p)、
[B 站 @莱德西多《基岩版1.20粒子效果全收集》](https://www.bilibili.com/video/BV1N4421D72C)）；
网易版（中国版）对原版命令另有改动（粒子名/权限），差异全集超出本 Wiki
范围，上述链接与社区教程（如 @陌苏菌 BV12g411g7Tn）按基岩/网易口径单独
查阅，勿与 Java 版命令混用。

## 运动学覆盖（预览引擎）

- **一张行为表，13 桶共享**（115 表项，26.2 字节码建表 → 1.21.11 逐类型
  核对一致；1.17–26.3 无同类型行为改变），摩擦/重力/运动模式/寿命公式
  全部按字节码逐一核对，f2d 精确 double
- **8 个世界依赖型**明确不建模，回退模组匀速直线：current_down、firefly、
  geyser 系、sulfur_bubbles、trail + 未注册的 ambient_entity_effect——
  它们的行为依赖方块/流体/实体查询（预览没有世界），强行建模只会是另一种近似
- **保真度分级**：预览对每个类型标注 ✅ 字节码核对 / ⚠️ 近似 / ❌ 不在注册表，
  宁低勿高
- **版本过滤**：某桶注册表里没有的类型，命令在该桶下报未知（与游戏内
  一致）——类型存在性由各桶类型表把关，运动学查不到才回退

## 贴图

帧贴图从各桶对应 client.jar 提取（跨版本同帧图内容寻址去重，共享一份）；
多帧类型（end_rod/smoke/explosion 等）按原版 age-progress 选帧 + 后 50%
寿命线性淡出（死亡瞬间 alpha=0.5）。个别类型的发光/贴图是视觉近似，
差异清单见预览项目 docs/技术路线.md §7。

## 引用

- 逐版本类型增量与历史脉络：中文 Minecraft Wiki《Java版粒子》
  （zh.minecraft.wiki/w/Java版粒子，访问日期 2026-10-15）；全部桶边界
  以各版本 client.jar 字节码注册表实测为准（与 Wiki 记载不一致处——
  21w42a 的 block_marker 实际 1.19.2 才入注册表——已按 jar 裁决并标注）