# 07 · 预览模板库（权威清单）

> 预览工具内置「📚 模板库」的权威清单（侧栏 📚 按钮 → 模板画廊，支持
> 复制命令 / 载入预览 / 一键直达 `https://luyuxiaopku.github.io/ColorblockViewer/?t=<id>`）。
> 本页与代码 [src/templates/library.ts](../../src/templates/library.ts) **逐字对齐**
> （命令文本、标签、说明），代码侧是执行来源，本页是文档来源；代码模板变更时本页同步。
> 模板的详细效果解读见 [05-examples](05-examples.md)。

## 硬性约定（每条模板都过三道闸，测试守护）

1. **可被预览解析器结构化**（parseCommands 成功）；
2. **通过游戏内格式检查**（checkCommandsFormat）——表达式一律带单引号，
   复制出去就是 brigadier 合法格式，可直接粘进游戏；
3. **预览引擎实跑零错误、spawned > 0**——不会出现「看着有模板、一点就报错」。

> 命令要点：`vel` 非零命令速度是刻意的——模组零速命令会触发 stop 回滚，
> 粒子被钉住不动；多行模板 = 多条命令一起载入。

## 已收录模板（当前 2 条）

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

## 待采纳候选（社区高频用法）

| 模板 | 来源 | 状态 |
|---|---|---|
| **呼吸缩放**（`i=0.1*sin(t/5);(vx,vy,vz)=(x*i,y*i,z*i)`，速度指向当前位置 × 正弦系数 → 构型整体缩放） | B 站社区用法，[05-examples](05-examples.md) 已收录（含幅度/周期调参说明） | 待代码模板库采纳 |