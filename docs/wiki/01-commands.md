# 01 · 命令大全

所有模组命令前缀 `/particleex`，13 个子命令（`USAGE` 与模组命令树逐字核对）。
通用约定：

- `<位置>` 是三个数字（x y z），可写 `~`（玩家位置）`~1`（相对）等
- `<颜色>` 是四个数字 r g b a（0–1，a=1 不透明）
- 可选参数 `[age]`：粒子年龄，**-1 = 永久**；缺省 0 = 用类型默认寿命
- 可选参数 `[速度表达式]`：每 tick 对粒子求值写回速度（表达式系统见 02）
- 可选参数 `[group]`：组名（字符串），配合 group 命令批量管理

## normal — 批量生成（最常用）

```
particleex normal <粒子名> <位置> <颜色> <速度> <范围> <数量> [age] [速度表达式] [speedStep] [group]
```

在位置附近生成 `<数量>` 个粒子，每个粒子的偏移 = **高斯随机 × 范围**
（三轴独立）。⚠️ **范围是高斯分布的标准差，不是均匀方块的边长**：
粒子集中在中心、边缘稀疏且可能远超出范围（高斯无界）。想要规则
方块/网格，用 conditional（见 05-examples）。

```
particleex normal minecraft:flame 0 0 0 1 1 1 1 0 0 1 0 0 0 100
```

## conditional — 按表达式筛选网格点

```
particleex conditional <粒子名> <位置> <颜色> <速度> <范围> <表达式> [step] [age] [速度表达式] [speedStep] [group]
```

在 `位置 ± 范围` 的三维网格上逐点采样（间距 = step，默认 0.1），
表达式结果**非 0 的点生成粒子**，0 的点跳过；表达式写 `null` = 全点生成。
`x`/`y`/`z` 是相对采样点坐标（相对位置），`dx`/`dz` 是相对中心的水平偏移。

典型用途：实心方块、空心壳、水面波形（见 05-examples）。

## parameter 家族 — 表达式扫参（模组招牌）

```
particleex parameter     <粒子名> <位置> <颜色> <速度> <begin> <end> <表达式> [step] [age] [速度表达式] [speedStep] [group]
particleex polarparameter    （同参数结构；表达式变量带 s1/s2/dis 极坐标）
particleex tickparameter     （多一个 [cpt]：每 tick 分批发多少个）
particleex tickpolarparameter
particleex rgbaparameter     （**没有** <颜色> 槽；颜色由表达式输出 cr/cg/cb/alpha）
particleex rgbapolarparameter
particleex rgbatickparameter
particleex rgbatickpolarparameter
```

参数 `t` 从 `begin` 扫到 `end`（步长 step，默认 0.1），每个 t 值：
位置/速度/颜色由表达式决定。

- **parameter**（直角坐标）：表达式写 `x,y,z=…`（位置）、`vx,vy,vz=…`（速度）
- **polarparameter**（极坐标）：表达式里`dis` 是半径方向、`s1`/`s2` 是角度
  卷绕变量（0→2π），`x,y,z` 由换算自动给出
- **tickparameter**：生成器挂后台，每游戏 tick 额外生成 cpt 个（不阻塞）
- **rgbaparameter**：颜色槽由表达式输出 `cr,cg,cb,alpha=…`（微信用）

非 tick 系（parameter/polarparameter/rgbaparameter）在命令执行时一次性
跑完循环；tick 系在后台持续生成，直到 t 到 end。

## group — 批量管理已生成粒子

```
particleex group remove <组> [表达式] [位置]
particleex group change <parameter|speedexpression> <组> <表达式> [条件表达式] [位置]
```

- `remove`：按表达式条件移除组内粒子（无表达式 = 全组移除）
- `change parameter`：把组内粒子的位置/颜色参数改成表达式的输出
  （例：`"x=5;cr=1;cg=0;cb=0;vx=0.2"`）
- `change speedexpression`：替换组内粒子的速度表达式

粒子名参数里有 <组> 的生成命令会把粒子加入该组（group 参数）。

## clearparticle — 清空

```
particleex clearparticle
```

清掉全部已生成粒子（含组），无需参数。

## 原版 /particle

```
particle <粒子名> [pos x y z] [delta x y z] [speed] [count] [normal]
```

- `<粒子名>` 可用 `type{...}` 复合写法（见 03-nbt），花括号**紧跟粒子名、
  中间不能有空格**
- `[delta]`：三轴的随机偏移范围（结果平方在 |dx|²+|dy|²+|dz|² ≤ delta 内）
- `[count]`：0 = 精确单个粒子
- `force` / `viewers` 尾参：预览工具不支持（会明确报错，与游戏一致）