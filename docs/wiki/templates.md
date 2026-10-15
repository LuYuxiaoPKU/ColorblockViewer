# 07 · 预览模板库（权威清单）

> 预览工具内置「📚 模板库」的权威清单（侧栏 📚 按钮 → 模板画廊，支持
> 复制命令 / 载入预览 / 一键直达 `https://yuer159.github.io/ColorblockViewer/?t=<id>`）。
> 本页与代码 [src/templates/library.ts](../../src/templates/library.ts) **逐字对齐**
> （命令文本、标签、说明），代码侧是执行来源，本页是文档来源；代码模板变更时本页同步。
> 模板的详细效果解读见 [05-examples](examples.md)。

## 硬性约定（每条模板都过三道闸，测试守护）

1. **可被预览解析器结构化**（parseCommands 成功）；
2. **通过游戏内格式检查**（checkCommandsFormat）——表达式一律带单引号，
   复制出去就是 brigadier 合法格式，可直接粘进游戏；
3. **预览引擎实跑零错误、spawned > 0**——不会出现「看着有模板、一点就报错」。

> 命令要点：`vel` 非零命令速度是刻意的——模组零速命令会触发 stop 回滚，
> 粒子被钉住不动；多行模板 = 多条命令一起载入。

## 已收录模板（当前 7 条）

### ripple · 涟漪波面（conditional 表达式）

- **标签**：`conditional` `表达式` `end_rod`
- **说明**：用条件表达式筛出「水面波形」的网格点，再让每个粒子沿法向做波动
  ——用户实战范例，随 t 向外扩散。
- **命令**（复制即用）：

```
/particleex conditional minecraft:end_rod ~ ~ ~ 1 0.95 0.89 1 0 0 0 8 0.6 8 '(abs(y-0.5*exp(0-(x^2+z^2)/3.24)*cos(5.236*sqrt(x^2+z^2)))<0.05)&(sqrt(x^2+z^2)<8)' 0.1 200 'vy=0.5*exp(0-(sqrt(dx^2+dz^2)-0.06*t-0.03)*(sqrt(dx^2+dz^2)-0.06*t-0.03)/3.24)*(0.3142*sin(5.236*(sqrt(dx^2+dz^2)-0.06*t-0.03))+0.03704*(sqrt(dx^2+dz^2)-0.06*t-0.03)*cos(5.236*(sqrt(dx^2+dz^2)-0.06*t-0.03)))' 1 null
```

### ring · 圆周环（polarparameter 环形速度）

- **标签**：`polarparameter` `表达式` `end_rod`
- **说明**：极坐标参数命令摆出一个圆环，切向速度表达式随 t 指数衰减 →
  粒子绕圈流动渐趋静止。
- **命令**（复制即用）：

```
/particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 0 6.2832 'dis=0.05;s1=t;s2=0' 0.0628 20 '(vx,vy,vz)=(0.25*exp(0-(t+0.5)/8)*cos(s1),0,0.25*exp(0-(t+0.5)/8)*sin(s1))' 1 null
```

### chladni · 克拉德尼节线纹（conditional 模态筛点）

- **标签**：`conditional` `表达式` `end_rod`
- **说明**：方形板驻波模态 cos(nπx/L)cos(mπz/L)+cos(mπx/L)cos(nπz/L) 的零值
  等值线筛点——金属板撒沙振动后的花纹，静态零时间项（n=2, m=3, L=10，
  阈值 0.07 实测命中约 6000 粒）。
- **命令**（复制即用）：

```
/particleex conditional minecraft:end_rod ~ ~ ~ 1 0.95 0.89 1 0 0 0 8 8 0 'abs(cos(0.6283185307179587*x)*cos(0.9424777960769379*z)+cos(0.9424777960769379*x)*cos(0.6283185307179587*z))<0.07' 0.05 200 null 1 null
```

### hypotrochoid · 万花尺繁花（hypotrochoid 内旋线）

- **标签**：`polarparameter` `表达式` `end_rod`
- **说明**：小圆在定圆内滚动：x=(R−r)cos(t)+d·cos((R−r)t/r)，
  z=(R−r)sin(t)−d·sin((R−r)t/r)——R=5 r=3 d=5 转 R/gcd(R,r)=5 圈闭合
  （t∈[0,6π]），三旋钮（R, r, d）调出万花筒图案。
- **命令**（复制即用）：

```
/particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 0 18.84955592153876 'x=2*cos(t)+5*cos(2*t/3);z=2*sin(t)-5*sin(2*t/3);y=0' 0.03 200 'null' 1 null
```

### superformula · 超级公式五瓣花（Gielis 极坐标轮廓）

- **标签**：`rgbapolarparameter` `表达式` `end_rod`
- **说明**：r=[|cos(mφ/4)|^n+|sin(mφ/4)|^n]^(−1/n1) 的五瓣星花（m=5, n=1.7）
  ——一条公式从圆到多边形到花瓣的形态变换器；rgbapolarparameter 随 s1
  转色相（cr/cg/cb 相位差 2π/3）。
- **命令**（复制即用）：

```
/particleex rgbapolarparameter minecraft:end_rod ~ ~2 ~ 0 0 0 0 18.84955592153876 'r=(abs(cos(5*s1/4))^1.7+abs(sin(5*s1/4))^1.7)^(-0.5882352941176471);x=r*1.8*cos(s1);z=r*1.8*sin(s1);y=0;cr=0.5+0.5*cos(s1);cg=0.5+0.5*cos(s1+2.0943951023931953);cb=0.5+0.5*cos(s1+4.1887902047863905);alpha=1' 0.03 200 'null' 1 null
```

### breathing · 呼吸圆环（社区最高频·正弦径向速度）

- **标签**：`polarparameter` `表达式` `vel`
- **说明**：polarparameter 摆出半径 2 的圆环（12 粒，step 0.3 ≈ 2π/0.3 个点，
  每帧速度 = 当前位置 × i，i=0.1·sin(t/5)）——乘性递推使构型整体胀缩
  （周期 2π×5≈31 tick）；r=2 环 200 tick（寿命）实测半径 0.62→2.62 呼吸
  6 个周期。B 站社区最高频用法（[05-examples](examples.md) 载变体出处），
  改 0.1（幅度）/5（周期倒数）调观感。`vel` 标签提示：速度表达式自带
  非零初速意义，但命令速度槽仍须非 0（零速触发模组 stop 回滚钉住粒子）。
- **命令**（复制即用）：

```
/particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 0 6.2832 'x=2*cos(t);z=2*sin(t);y=0' 0.3 200 'i=0.1*sin(t/5);(vx,vy,vz)=(x*i,y*i,z*i)' 1 null
```

### fireworkball · 烟花球（球面枚举 144 粒一次炸开）

- **标签**：`tickpolarparameter` `表达式` `vel`
- **说明**：一维 t 锯齿扫球面（DynFirework 球面枚举模型的引擎落法）：
  `s2=0.35*floorMod(floor(t/16),9)-1.4`（9 层仰角，floorMod double 版
  引擎有注册、communityMath 批次已锁语义）× `s1=0.4*t`（每层 16 点，
  跨度 6.4 rad 覆盖一圈；s1 不取模，cos/sin 周期性自动回绕且各层相位
  错开更自然）。粒子生成在球心（dis=0.01 防 0），速度沿径向 0.3
  （x/dis 即单位方向向量）——end_rod 原版摩擦 0.96 自然减速，扩散渐近
  ≈v0/(1−f)=7.5 格后受重力下垂，即烟花球形。`cpt=144` 一次 tick 全出
  （曾写 143 少一粒——cpt 是每 tick 条数上限，end=143 时须 144）。
- **命令**（复制即用）：

```
/particleex tickpolarparameter minecraft:end_rod ~ ~8 ~ 1 0.95 0.89 1 0 0 0 0 143 's2=0.35*floorMod(floor(t/16),9)-1.4;s1=0.4*t;dis=0.01' 1 144 200 '(vx,vy,vz)=(x/dis*0.3,y/dis*0.3,z/dis*0.3)' 1 null
```

## 待采纳候选（社区高频用法）

| 模板 | 来源 | 状态 |
|---|---|---|
| ~~**呼吸缩放**~~ | B 站社区用法 | ✅ 已采纳为 `breathing` 模板（2026-10-15，见上） |