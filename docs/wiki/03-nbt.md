# 03 · `type{NBT}` 选项语法

粒子名可以携带 `{...}` 选项块（原版 `/particle` 的复合写法，模组命令同用）。

## 基本规则

- 花括号**紧跟粒子名**、中间不能有空格：`minecraft:dust{color:[1,0.3,0.2],scale:1}`
- 选项是 SNBT 风格（方块 NBT 的紧凑子集）：键值对逗号分隔
- 数值类型（前端与游戏同口径）：14 种扁平标量（含无符号位模式、位宽上界），
  格式错误会得到与游戏一致的报错
- 数值默认域：
  - 整数（int）：32 位；`B`/`S`/`I`/`L` 后缀控制位宽（±127/±32767/±2^31-1/64 位）
  - 十六进制 `0x` 无后缀 = **无符号**位模式（如 `0xFFFFFFFF` = -1；
    `0x80000000` = -2147483648）；带 `I` 后缀 = 有符号解读。⚠️ 旧版本有个
    经典 bug：`0x0000FF` 之类的末尾 `F` 会被当成后缀剥掉导致 255 变 15
    （预览已修复，游戏始终正确）

## 各粒子的选项（已验证）

| 粒子 | 选项 | 示例 |
|---|---|---|
| `dust` | `color:[r,g,b]`（0–1）、`scale` | `minecraft:dust{color:[1,0.3,0.2],scale:1}` |
| `dust_color_transition` | `fromColor`、`toColor`、`scale` | 颜色随时间渐变 |
| `vibration` | `destination:{block:{pos:[x,y,z]}}`、`arrival_in_ticks` | 粒子飞向指定方块并震动到达 |
| `trail` | `destination`、`duration` | 拖尾飞行 |
| `block` / `block_marker` | 方块状态 | `minecraft:block{block_state:{Name:"minecraft:stone"}}` |
| `item` | 物品堆 | 展示物品粒子 |
| 其余 26.2 常见类型 | 多数无选项（直接 `minecraft:end_rod` 即可） | — |

粒子选项表按 1.21.11 / 26.2 分区（新版本增加 geyser 系等类型，8 类有
选项载荷的粒子逐字节码核对必填/可选字段——缺必填选项报错文案与游戏一致）。

## 预览工具注意

- 预览的 `type{NBT}` 与游戏逐字段校验一致（含 hex 语义/位宽）
- force/viewers 尾参预览不支持（明确报错，与游戏报错一致）