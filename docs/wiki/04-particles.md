# 04 · 粒子类型清单

粒子名 = 原版 Minecraft 的粒子标识（`minecraft:end_rod`、`minecraft:flame`、
`minecraft:dust{...}` 等），模组不发明新粒子、只增强生成与控制方式。

## 版本分区

| 版本 | 注册表类型数 | 说明 |
|---|---|---|
| 1.21.11 | 对应旧版 | 类型较少；运动学行为与 26.2 共享同一张表（逐类型核对一致） |
| 26.2 | 112 型 | 新增：geyser 间歇泉系（base/plume/poof）、firefly 萤火虫、current_down 水流、trail 轨迹、sulfur_bubbles 等 |

> 提示：用不存在的类型名，预览与游戏报同样错误；`ambient_entity_effect`
> 在 26.2 客户端里有粒子类但**注册表未注册**——命令用它会直接报错（两侧一致）。

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
| `nautilus` / `enchant` / `vault_connection` | 飞向目标的位置式飞行 | 出生即偏一个速度矢量 |
| `ominous_spawning` | 直线加速飞向 | |
| `bubble` / `dripping_*` / `falling_*` | 水泡/滴水/落水 | 原生运动学各轴系数精确到 float |
| `explosion` / `gust_*` / `sonic_boom` | 爆发/尖啸 | 零速出生、速度被丢弃 |
| `spark` / `scrape` / `wax_*` | 铜器交互火星 | 初速 ×0.01 等 |

（全量类型名表见预览工具设置面板的版本切换与 `docs/evidence/` 证据 JSON。）

## 运动学覆盖（预览引擎）

- **113 个表项**（26.2），摩擦/重力/运动模式/寿命公式全部按字节码逐一核对，
  f2d 精确 double；1.21.11 与 26.2 共享同一张表
- **8 个世界依赖型**明确不建模，回退模组匀速直线：current_down、firefly、
  geyser 系、sulfur_bubbles、trail + 未注册的 ambient_entity_effect——
  它们的行为依赖方块/流体/实体查询（预览没有世界），强行建模只会是另一种近似
- **保真度分级**：预览对每个类型标注 ✅ 字节码核对 / ⚠️ 近似 / ❌ 不在注册表，
  宁低勿高

## 贴图

多帧类型（end_rod/smoke/explosion 等）按原版 age-progress 选帧 + 后 50%
寿命线性淡出（死亡瞬间 alpha=0.5）。个别类型的发光/贴图是视觉近似，
差异清单见预览项目 docs/技术路线.md §7。