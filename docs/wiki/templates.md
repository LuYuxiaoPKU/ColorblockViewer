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

## 已收录模板（当前 5 条）

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

## 待采纳候选（社区高频用法）

| 模板 | 来源 | 状态 |
|---|---|---|
| **呼吸缩放**（`i=0.1*sin(t/5);(vx,vy,vz)=(x*i,y*i,z*i)`，速度指向当前位置 × 正弦系数 → 构型整体缩放） | B 站社区用法，[05-examples](examples.md) 已收录（含幅度/周期调参说明） | 待代码模板库采纳 |