# 示例画廊

> 模组招牌写法的**动图预览**——由预览工具引擎逐帧渲染回放（循环
> 播放），画面为固定等距视角；命令文本附在卡片内可复制进游戏。
> 动图渲染口径与预览工具一致，命令语义与游戏逐字一致（1161 个测试锁定）。

<style>
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 20px;
  margin: 20px 0;
}
.gallery-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 12px 14px 14px;
  background: var(--vp-c-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gallery-card img {
  width: 100%;
  height: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: #0b0e14; /* 与主站场景底色一致，防加载闪烁 */
  display: block;
}
.gallery-card .tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.gallery-card .tag {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
</style>

<div class="gallery-grid">

<div class="gallery-card">

### 涟漪波面（conditional 表达式）

用条件表达式筛出「水面波形」的网格点，再让每个粒子沿法向做波动——随 t
向外扩散的招牌示例。

<div class="tags"><span class="tag">conditional</span><span class="tag">表达式</span><span class="tag">end_rod</span></div>

<img src="/wiki-gallery/ripple.gif" alt="涟漪波面动图预览" loading="lazy">

<details>
  <summary>查看命令（复制进游戏）</summary>

```text
/particleex conditional minecraft:end_rod ~ ~ ~ 1 0.95 0.89 1 0 0 0 8 0.6 8 '(abs(y-0.5*exp(0-(x^2+z^2)/3.24)*cos(5.236*sqrt(x^2+z^2)))<0.05)&(sqrt(x^2+z^2)<8)' 0.1 200 'vy=0.5*exp(0-(sqrt(dx^2+dz^2)-0.06*t-0.03)*(sqrt(dx^2+dz^2)-0.06*t-0.03)/3.24)*(0.3142*sin(5.236*(sqrt(dx^2+dz^2)-0.06*t-0.03))+0.03704*(sqrt(dx^2+dz^2)-0.06*t-0.03)*cos(5.236*(sqrt(dx^2+dz^2)-0.06*t-0.03)))' 1 null
```

</details>

</div>

<div class="gallery-card">

### 圆周环（polarparameter 环形速度）

极坐标参数命令摆出一个圆环，切向速度表达式随 t 指数衰减 → 粒子绕圈流动
渐趋静止。

<div class="tags"><span class="tag">polarparameter</span><span class="tag">表达式</span><span class="tag">end_rod</span></div>

<img src="/wiki-gallery/ring.gif" alt="圆周环动图预览" loading="lazy">

<details>
  <summary>查看命令（复制进游戏）</summary>

```text
/particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 0 6.2832 'dis=0.05;s1=t;s2=0' 0.0628 20 '(vx,vy,vz)=(0.25*exp(0-(t+0.5)/8)*cos(s1),0,0.25*exp(0-(t+0.5)/8)*sin(s1))' 1 null
```

</details>

</div>

</div>

> 更多玩法与逐参数讲解见 [实战示例](examples.html)；想自己拼特效，从
> [命令大全](commands.html) 与 [表达式系统](expressions.html) 开始。