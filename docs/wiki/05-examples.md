# 05 · 实战示例（全部预览引擎实测）

> 每条示例都经过预览引擎实际执行验证（生成的粒子数/坐标分布与预期一致）。

## 实心方块（conditional 规则点阵）

conditional 的「范围」是采样域——三维 ±range 的网格上逐点生成，
`null` 表达式 = 全点生成。**这正是「实心方块」的正解**：

```
particleex conditional minecraft:flame 0 0 0 1 1 1 1 0 0 0 4 4 4 null 0.5
```

- 范围 `4 4 4` → 采样域 ±4 → **8×8×8 格**方块
- 步长 `0.5` → 每轴 17 点 → **4913 个粒子**全格点（实测坐标精确覆盖）

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
  '(abs(x)>=4.8)|(abs(y)>=4.8)|(abs(z)>=4.8)' 0.4
```

范围 ±5 采样、只有距表面 0.2 内的点生成 → 空心立方壳。

### ⚠️ normal 做不出方块

`normal` 的「范围」是**高斯分布标准差**（无界）——粒子集中在中心、
边缘稀疏且可能飘出范围几倍。想规则的方块/网格，必须用 conditional。

## 涟漪波面（conditional 表达式筛选，预览模板一）

```
particleex conditional minecraft:end_rod ~ ~ ~ 1 0.95 0.89 1 0 0 0 8 0.6 8
  '(abs(y-0.5*exp(0-(x^2+z^2)/3.24)*cos(5.236*sqrt(x^2+z^2)))<0.05)&(sqrt(x^2+z^2)<8)'
  0.1 200 'vy=0.5*exp(...)*(...)' 1 null
```

水面波形：条件筛出波面网格点，速度表达式让每个粒子沿法向波动、随 t 扩散。

## 圆周环（polarparameter 环形速度，预览模板二）

```
particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 0 6.2832
  'dis=0.05;s1=t;s2=0' 0.0628 20 '(vx,vy,vz)=(0.25*exp(0-(t+0.5)/8)*cos(s1),0,0.25*exp(0-(t+0.5)/8)*sin(s1))' 1 null
```

`dis=0.05` 半径步进、`s1` 扫 0→2π、切向速度随 t 指数衰减 → 粒子绕圈渐静。

## 呼吸缩放（社区最高频模板）

```
particleex normal minecraft:end_rod 0 0 0 1 1 1 1 0 0 0 0 0 0 200
  'i=0.1*sin(t/5);(vx,vy,vz)=(x*i,y*i,z*i)'
```

速度指向当前位置 × 正弦呼吸系数 → 构型整体缩放。改幅度/周期：
`0.1`（幅度）与 `5`（周期）。

## 原版 /particle（预览同样支持）

```
particle minecraft:soul_fire_flame 0 100 0 0.5 0.5 0.5 0.05 50
particle minecraft:dust{color:[1,0.3,0.2],scale:1} 0 64 0 0 0 0 1 1
```

注意 y 高度：**预览场景看原点附近（y=0 地面）**，游戏常用高度
（如 y=64/100）在预览视野之外——预览里把 y 放 0–4。

## 更多

- 图片打印（`image` 子命令）与逐帧视频（`video` 子命令）：老版本
  ≤1.16.5 的社区用法（图片放 mod 同级 particleImages/、flip 取值
  not/horizontally/vertically），新版本字段序确认中，确认后补本节