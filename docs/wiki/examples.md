# 05 · 实战示例

> 逐节标注来源与验证状态。**「引擎实测」**= 本仓库预览引擎实跑零错误、
> spawned>0（26.2 引擎，2026-10-14 验证批次）；其余按置信级标注。

## 预览模板（与代码逐字对齐，清单见 [07-templates](templates.md)）

### 实心方块（conditional 规则点阵）

conditional 的「范围」是采样域——三维 ±range 的网格上逐点生成，
`null` 表达式 = 全点生成。**这正是「实心方块」的正解**：

```
particleex conditional minecraft:flame 0 0 0 1 1 1 1 0 0 0 4 4 4 null 0.5
```

- 范围 `4 4 4` → 采样域 ±4 → **8×8×8 格**方块
- 步长 `0.5` → 每轴 17 点 → **4913 个粒子**全格点（引擎实测坐标精确覆盖）

### 1×1×1 方块（命令方块那么大）

```
particleex conditional minecraft:flame 0 0.5 0 1 1 1 1 0 0 0 0.5 0.5 0.5 null 0.25   （125 个，较疏）
particleex conditional minecraft:flame 0 0.5 0 1 1 1 1 0 0 0 0.5 0.5 0.5 null 0.1    （1331 个，较实）
```

`0 0.5 0` 让方块底面贴 y=0 地面。换 `end_rod` 粒子 = 白色发光块；
加寿命参数 `... 0.1 -1`（age=-1）= 永久挂住不掉。

### 空心壳

```
particleex conditional minecraft:end_rod 0 0 0 1 0.95 0.89 1 0 0 0 5 5 5
  '(abs(x)==5&!(abs(y)<5&abs(z)<5))|(abs(y)==5&!(abs(x)<5&abs(z)<5))|(abs(z)==5&!(abs(x)<5&abs(y)<5))'
```

三组条件 = 三对正方形面（每面排除中心区防棱重复计数）。

### 涟漪波面（conditional 表达式筛选 + 波动速度）

```
particleex conditional minecraft:end_rod ~ ~ ~ 1 0.95 0.89 1 0 0 0 8 0.6 8
  '(abs(y-0.5*exp(0-(x^2+z^2)/3.24)*cos(5.236*sqrt(x^2+z^2)))<0.05)&(sqrt(x^2+z^2)<8)'
  0.1 200 'vy=0.5*exp(0-(sqrt(dx^2+dz^2)-0.06*t-0.03)*(sqrt(dx^2+dz^2)-0.06*t-0.03)/3.24)*(0.3142*sin(5.236*(sqrt(dx^2+dz^2)-0.06*t-0.03))+0.03704*(sqrt(dx^2+dz^2)-0.06*t-0.03)*cos(5.236*(sqrt(dx^2+dz^2)-0.06*t-0.03)))' 1 null
```

水面波形：条件筛出波面网格点，速度表达式让每个粒子沿法向波动、随 t 扩散
（用户实战范例，预览内置模板 ripple）。

### 圆周环（polarparameter 环形速度）

```
particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 0 6.2832
  'dis=0.05;s1=t;s2=0' 0.0628 20 '(vx,vy,vz)=(0.25*exp(0-(t+0.5)/8)*cos(s1),0,0.25*exp(0-(t+0.5)/8)*sin(s1))' 1 null
```

`dis=0.05` 半径步进、`s1` 扫 0→2π、切向速度随 t 指数衰减 → 粒子绕圈渐静
（预览内置模板 ring）。

## 社区经典案例（首批 6 例，引擎实测 2026-10-14）

> 来源：OCEAN 生成器站案例库（mc.ecyft.top，访问日期 2026-10-13；原命令
> 为 1.16.5 口径，本节命令与 1.21.1+ 字段序一致可直接用）；作者归属见
> 各条。挑选标准 = 引擎可验证 + 作者明确 + 六种命令面各一例。
> 其余 11 例见文末折叠清单。

### 正方体壳（Junior_Mo，conditional）✅ 引擎实测 spawned=116

```
particleex conditional minecraft:end_rod ~ ~1 ~ 0 1 1 1 0 0 0 0.5 0.5 0.5
  '(abs(y)==0.5&!(abs(z)<0.5))|(abs(x)==0.5&(!(abs(z)<0.5)|!(abs(y)<0.5)))' 0.1 0 'vy=0.01' 1.0 null
```

原作的正方体表达式：三对对面 + 排除中心区防棱重复；`vy=0.01` 让壳缓慢
上浮。与上方「空心壳」同思路的原始版本。

### 立体球（OCEAN，polarparameter）✅ 引擎实测 spawned=5500

```
particleex polarparameter minecraft:firework ~ ~2 ~ 0 1 0 1 0 0 0 0 550
  's1=t;s2=t/50;dis=t/10'
```

球面螺旋：s1 每单位 t 转 1 弧度、s2 每 50 单位 t 才走 1 弧度 → 频率比
50:1 互质近似 → 球面均匀覆盖；`dis=t/10` 让半径同步增大（生长动画）。
**球坐标 s1/s2/dis 语义与均匀覆盖口诀见 [02-expressions](expressions.md)**。

### 菊型球（故知，rgbapolarparameter）✅ 引擎实测 spawned=1250

```
particleex rgbapolarparameter minecraft:end_rod ~ ~5 ~ 0 0 0 -60.0 65.0
  's1,s2,dis=t*0.2,t*PI/3.1415926,5;cr,cg,cb=sin(t/7)/4+0.75,sin(t/5)/4+0.75,sin(t/3)/4+0.75;s1=s1*dis;s2=s2*dis'
  0.1 0 0 1.0 null
```

三个要点：① `s1=s1*dis;s2=s2*dis` 把角度乘半径（菊瓣从球心放射张开的
关键技巧）；② RGB 三通道用不同频率正弦漂移 → 色相连续变化；③
`PI/3.1415926≈1` 是作者刻意的近似（s2 每单位 t 走约 1 弧度）。

### 桃心（OCEAN，tickparameter）✅ 引擎实测 spawned=601

```
particleex tickparameter minecraft:end_rod ~ ~3 ~ 0.6 0.2 1 1 0 0 0 -3.0 3.0
  'x=(16*pow(sin(t),3))/7;y=(13*cos(t)-5*cos(2*t)-2*cos(3*t)-cos(4*t))/7' 0.01 20 0 'vy=0.0'
```

经典心形参数方程（16sin³t / 13cost−5cos2t−2cos3t−cos4t），范围 ±3、
步长 0.01 → 601 点勾出完整心形；`vy=0` 防重力漂移。**数学解读**：
这是隐式心形线的参数化版本，系数 16/7 与 13/5/2/1 来自曲线归一化
（推导见社区数学笔记 [社区级·推导]）。

### 旋转的球体（OCEAN，polarparameter + 矩阵 + RGB）✅ 引擎实测 spawned=2001

```
particleex polarparameter minecraft:end_rod ~ ~3 ~ 1 1 1 1 0 0 0 -100.0 100.0
  's1,s2,dis=t*10,t*PI/200,10' 0.1 0
  'a=0.05;(vx,,vy,,vz)=(-sin(a),0,-cos(a),,0,1,0,,cos(a),0,-sin(a))*(x*2*sin(a),,0.1,,z*2*sin(a));cr=sin(t/7)/2+0.5;cg=sin(t/5)/2+0.5;cb=sin(t/3)/2+0.5' 1.0 null
```

模组招牌复合案例：球坐标摆点 + **旋转矩阵驱动速度场** + RGB 三频变色。
旋转矩阵解读（[社区级·推导]）：`a=0.05` 是小角度步进，`2·sin(a)≈0.1`
即小角弧长（弧度制下弦长≈弧长），矩阵乘出「绕 y 轴缓旋 + 微升」的
合成速度。矩阵语法见 [02-expressions](expressions.md)。

### 粒子缠绕（OCEAN，normal + 旋转速度场）✅ 引擎实测 spawned=500

```
particleex normal minecraft:end_rod ~ ~1 ~ 0.5 0 0.5 1 0 0. 0 10 5 5 500 200
  'a=0.08;(vx,,vy,,vz)=(-sin(a),0,-cos(a),,0,1,0,,cos(a),0,-sin(a))*(x*2*sin(a),,0,,z*2*sin(a))' 1.0 null
```

与「旋转的球体」同一速度场，但生成方式换成 normal 高斯散点（范围
5 5 5、数量 500）——对比两例可直观看出**同一速度场对不同初始分布
的整形效果**（散点被卷成缠绕柱）。

<details>
<summary>其余 11 例（OCEAN 站案例库清单，命令为 1.16.5 原式，按 01-commands 字段序表换算后可用）</summary>

心形曲线（polarparameter）、围圈、竖立的圆、散开的圆（循环）、粒子升华、
七芒星（双频正弦叠加）、V 字形、触手状（tan 极坐标）、星星、螺旋
（Junior_Mo，tickparameter+RGB）、金葵绽放（random 绽放 + 缩放衰减
`i=0.8*0.7^t`）。另有 **Junior_Mo 锐角星型**（参数方程 5 角星 + 旋转
矩阵速度场）与**地狱之眼完整脚本**（开场×4 缩放衰减 `i=4.7*0.5^t` +
持续×4 + 收场×4 `i=-.5` + clearparticle）两个大型案例，原文见 OCEAN
站案例库。

</details>

## 呼吸缩放（社区最高频模板）

```
particleex normal minecraft:end_rod 0 0 0 1 1 1 1 0 0 0 0 0 0 200
  'i=0.1*sin(t/5);(vx,vy,vz)=(x*i,y*i,z*i)'
```

速度指向当前位置 × 正弦呼吸系数 → 构型整体缩放。改幅度/周期：
`0.1`（幅度）与 `/5`（周期）。B 站教程 10+ 集成稿（最高频社区模板，
示例：@陌苏菌《上下浮动粒子》BV12g411g7Tn 等变体）。

## 原版 /particle（预览同样支持）

```
particle minecraft:soul_fire_flame 0 100 0 0.5 0.5 0.5 0.05 50
particle minecraft:dust{color:[1,0.3,0.2],scale:1} 0 64 0 0 0 0 1 1
```

注意 y 高度：**预览场景看原点附近（y=0 地面）**，游戏常用高度
（如 y=64/100）在预览视野之外——预览里把 y 放 0–4。

## 图片打印（image）与逐帧视频

字段序已按模组确认（三代差异表见 [01-commands](commands.md)），真实歌词
逐帧命令实例（NBS2schematic 生成端实锤）：

```
particleex image minecraft:end_rod 11 8 0 lyric/s0000_l0.png 0.03125 0 90 0 not 10 0 0 0 16 null 1 null
```

- `rotate` 只认 90 倍数、`flip` 枚举 not/horizontally/vertical；`speed`
  三槽逐槽可 null
- 逐帧视频用 `video`（字段序相同）；矩阵变换用 `imagematrix`/`videomatrix`
- 路径含 `/` 时游戏内须单引号包裹；预览无图片资源 → 与游戏一致报
  `invalid image path: <路径>`

---

*来源与致谢*：正方体/锐角星型/螺旋 = Junior_Mo；菊型球 = 故知；其余
OCEAN 案例 = Minecraft_OCEAN（[OCEAN 生成器站](https://mc.ecyft.top)案例库，
访问日期 2026-10-13）。社区技巧（呼吸缩放/缓动/浮点陷阱）来自 B 站
教程生态（@Minecraft_OCEAN @翊尘呀 等，见 [08-history](history.md) 致谢）。
全部 6 个首批案例已过预览引擎实跑验证（2026-10-14）。
