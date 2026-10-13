# 01 · 命令大全

所有模组命令前缀 `/particleex`（AnotherColorBlock 与两代 ColorBlock；
ExParticle 的根命令是 `/particlex` 且子命令连字符风格，见
[00-overview](overview.md) 的根命令提醒），17 个子命令（8 个 parameter
变体合并叙述；`USAGE` 与模组命令树逐字核对）。

通用约定：

- `<位置>` 是三个数字（x y z），可写 `~`（玩家位置）`~1`（相对）等
- `<颜色>` 是四个数字 r g b a（0–1，a=1 不透明）
- 可选参数 `[age]`：粒子年龄，**-1 = 永久**；缺省 0 = 用类型默认寿命
- 可选参数 `[速度表达式]`：每 tick 对粒子求值写回速度（表达式系统见 02）
- 可选参数 `[group]`：组名（字符串），配合 group 命令批量管理

## 三代命令名对照

| 功能 | ColorBlock 1.12.2 | ColorBlock 1.16.5 | AnotherColorBlock / 本预览 | ExParticle（参考） |
|---|---|---|---|---|
| 函数列表 | `funlist` | `funlist` | **`functionlist`** | `functions` |
| 清粒子 | `clearparticle` | `clearparticle` | **`clearparticle`** | `clear-particle` |
| 清缓存 | `clearcache` | `clearcache` | **`clearcache`** | `clear-cache` |
| 极坐标参数 | `polarparameter` | `polarparameter` | **`polarparameter`** | `polar-parameter` |
| tick 系 | `tickparameter` / `tickpolarparameter` | 同左 | **同左** | `tick-parameter` / `tick-polar-parameter` |
| RGB 系 | `parameterrgb` 系列 | `rgbaparameter` 系列 | **`rgbaparameter` 系列**（4 变体同左） | `rgba-parameter` 系列（4 变体） |
| 图片 | `image` / `imagematrix` | 同左 | **`image` / `imagematrix`** | `image` / `image-matrix` |
| 视频 | — | — | **`video` / `videomatrix`** | `video` / `video-matrix` |
| 粒子名风格 | 驼峰（`endRod`）+ 颜色多**亮度**槽 | 下划线（`end_rod`） | 下划线 | 下划线 |
| 表达式引号 | 不需要 | **必须引号** | 引号（预览自动补） | 必须引号 |

> 预览工具与 AnotherColorBlock 现状统一（2026-10-11 拍板）：`functionlist`
> / `clearparticle` / `clearcache` 连写风格；模组侧历史名不再使用。
> 网上教程按 1.12.2/1.16.5 写的命令在本模组会报「未知子命令」，按上表
> 换算即可。表内 1.12.2/1.16.5 列为 [官方级]（MCBBS 原帖与 OCEAN 站
> 教程页双源），ExParticle 列为 [官方级]（作者教程帖 post/4889）。

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
- **polarparameter**（极坐标）：表达式里 `dis` 是半径、`s1` 是方位角、
  `s2` 是俯仰角（弧度制），`x,y,z` 由换算自动给出（换算公式与推导见
  [02-expressions](expressions.md) 球坐标节）
- **tickparameter**：生成器挂后台，每游戏 tick 额外生成 cpt 个（不阻塞）
- **rgbaparameter**：颜色槽由表达式输出 `cr,cg,cb,alpha=…`（0–1）

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
组名支持 `|` 分隔多组同时操作（[社区级·源码直读]，ExParticle 1.5.2
GroupUtil.add 同款行为）。

## clearparticle / clearcache / functionlist — 工具命令

```
particleex clearparticle
particleex clearcache
particleex functionlist
```

`clearparticle` 清掉全部已生成粒子（含组）；`clearcache` 清图片缓存
（更新同名图片文件后需要）；`functionlist` 列出注册函数——预览端
`clearcache`/`functionlist` 无实际副作用（无图片资源/函数表随引擎内置）。

## image / video — 图片打印与逐帧视频

```
particleex image <粒子名> <x y z> <路径> [scaling=0.1] [xRotate] [yRotate] [zRotate] [flip] [dpb=10] [speed x y z] [age] [speedExpression] [speedStep] [group]
particleex video <粒子名> <x y z> <路径> [scaling] [xRotate] [yRotate] [zRotate] [flip] [dpb] [speed x y z] [age] [speedExpression] [speedStep] [group]
```

- 图片放模组同级 `particleImages/` 目录；预览暂无图片资源 → 报
  `invalid image path: <路径>`（与游戏内一致）
- `rotate` 三槽只接受 **90 的倍数**（0/90/180/270，模组 RotateArgument；
  NBS 生成端曾因填任意角度上线 4 天未生效）
- `flip` 枚举词：`not` / `horizontally` / `vertical`（数字被拒）
- `speed` 三槽逐槽可 `null`（全 `null` = 静止）；`dpb` = 每张图片持续 tick
- 路径含 `/` 等特殊字符时游戏内须单引号包裹（brigadier 未加引号字符集
  不含 `/`，见 06-faq 引号规则）
- `age` 单位 = **游戏 tick**（模组 `ParticleUtil.spawnParticle` 源码实锤：
  `age > 0` → `particle.setLifetime(age)`）；NBS2schematic 侧 1 NBS tick =
  2 游戏 tick（歌词 `age=(end−start)×2` 是单位换算非 bug）
- `video` 逐帧视频 1.21.1 系新增（两代 ColorBlock 没有）；ExParticle 侧
  需 JavaCV 放游戏目录 `javacv/`（[官方级·post/4889]）

**image 字段序三代差异**（[官方级]，MCBBS 原帖 + 专栏 cv21908911 +
模组字节码三源核对）：

| 版本 | 字段序（scaling 之后） |
|---|---|
| 1.12.2 | [x旋转] [y旋转] [z旋转] [翻转] **[速度] [DPB]** [寿命]…（flip 与 speed 对调） |
| 1.16.5 | [x旋转] [y旋转] [z旋转] [翻转] [DPB] **[速度] [寿命]** [速度表达式] [计算间隔] [组] |
| 1.21.1+（本表） | [xRotate] [yRotate] [zRotate] [flip] [dpb] [speed] [age] [速度表达式] [speedStep] [group] |

老教程（1.12.2/1.16.5）的 image 命令直接粘贴会因字段错位而行为异常，
按上表换算。

## imageMatrix / videoMatrix — 矩阵变换版

```
particleex imagematrix <粒子名> <x y z> <路径> [scaling] <matrix> [dpb] [speed x y z] [age] [speedExpression] [speedStep] [group]
particleex videomatrix …（字段序相同）
```

- `<matrix>`：`E3` / `E4` 快捷名，或括号 16 值字面量（如
  `(1,0,0,0,,0,1,0,0,,0,0,1,-100,,0,0,0,1)`，行以 `,,` 分隔、列以 `,`
  分隔；矩阵数学见 [02-expressions](expressions.md)）
- 命令词全小写（`imagematrix` / `videomatrix`）；matrix 版无旋转/翻转槽
  （用矩阵替代）

## 原版 /particle

```
particle <粒子名> [pos x y z] [delta x y z] [speed] [count] [normal]
```

- `<粒子名>` 可用 `type{...}` 复合写法（见 03-nbt），花括号**紧跟粒子名、
  中间不能有空格**
- `[delta]`：三轴的随机偏移范围（结果平方在 |dx|²+|dy|²+|dz|² ≤ delta 内）
- `[count]`：0 = 精确单个粒子
- `force` / `viewers` 尾参：预览工具不支持（会明确报错，与游戏一致）

## 附：ExParticle 独有命令面（预览不支持）

以下命令存在于 ExParticle 1.5.2（hackerm大神），**AnotherColorBlock 与
预览工具均无**——用 ExParticle 的玩家可参考，此处仅列名与一句话：
[社区级·源码直读]（源码 commit 62ccdd4）。

| 命令 | 功能 | 备注 |
|---|---|---|
| `text` | 文字转粒子（字体渲染 → 逐像素粒子） | `[scaling] [expression] [dpb] [speed] [age] [速度表达式] [speedStep] [group]`；dpb=每方块像素数 |
| `custom-normal` / `custom-conditional` / `custom-parameter` / `custom-image` / `custom-image-matrix` / `custom-video` / `custom-video-matrix` | attr 表达式逐粒子决定 size/颜色/alpha/light/gravity/friction 等全部属性 | 用一个 attr 表达式串代替显式属性参数；custom-parameter 下有 normal/polar/tick/tick-polar 四个子模式 |
| `global-variable define\|undefine <int\|double\|quat> <名> <值>` | 全局变量（表达式内直接引用同名标识符） | 客户端另有 `peek` 查看；quat 支持 `(x,y,z,w)` 或 `euler(pitch,yaw,roll)` |
| `user-function define\|undefine <名> <参数> <函数体>` | 用户自定义函数（表达式内 `f(x,2,t)` 调用） | 编译为 ASM 方法；客户端 `list` 列出 |

若你玩的是 AnotherColorBlock（本 Wiki 主口径），以上命令会报未知子命令。
