// 模板库：精编粒子效果模板（中文名 + 说明 + 标签 + 游戏内可直接使用的命令文本）。
//
// 硬性约定（tests/templates/library.test.ts 逐条守护）：
//  ① 每条模板都能被本仓库解析器结构化（parseCommands 成功）；
//  ② 通过**游戏内格式检查**（checkCommandsFormat）—— 表达式一律带单引号，
//     复制出去就是 brigadier 合法格式，可直接粘进游戏；
//  ③ 预览引擎实跑零错误、spawned > 0（不会出现「看着有模板、一点就报错」）。
//
// 约定：多行模板 = 多条命令（同一模板内的命令一起载入）；`vel` 提示用于说明
// 为什么要给非零命令速度（模组零速命令会触发 stop 回滚，粒子被钉住不动）。

export interface Template {
  id: string;
  /** 中文名（列表主标题） */
  name: string;
  /** 一句话说明：效果 + 命令要点 */
  desc: string;
  /** 标签：子命令 / 类型 / 原版运动学亮点 */
  tags: string[];
  /** 命令文本（含 `/` 前缀，可直接复制进游戏；多行按顺序载入） */
  cmds: string[];
}

export const TEMPLATES: Template[] = [
  {
    id: 'ripple',
    name: '涟漪波面（conditional 表达式）',
    desc: '用条件表达式筛出「水面波形」的网格点，再让每个粒子沿法向做波动 —— 用户实战范例，随 t 向外扩散。',
    tags: ['conditional', '表达式', 'end_rod'],
    cmds: [
      "/particleex conditional minecraft:end_rod ~ ~ ~ 1 0.95 0.89 1 0 0 0 8 0.6 8 '(abs(y-0.5*exp(0-(x^2+z^2)/3.24)*cos(5.236*sqrt(x^2+z^2)))<0.05)&(sqrt(x^2+z^2)<8)' 0.1 200 'vy=0.5*exp(0-(sqrt(dx^2+dz^2)-0.06*t-0.03)*(sqrt(dx^2+dz^2)-0.06*t-0.03)/3.24)*(0.3142*sin(5.236*(sqrt(dx^2+dz^2)-0.06*t-0.03))+0.03704*(sqrt(dx^2+dz^2)-0.06*t-0.03)*cos(5.236*(sqrt(dx^2+dz^2)-0.06*t-0.03)))' 1 null",
    ],
  },
  {
    id: 'ring',
    name: '圆周环（polarparameter 环形速度）',
    desc: '极坐标参数命令摆出一个圆环，速度表达式给切向速度 → 粒子绕圈流动。',
    tags: ['polarparameter', '表达式', 'end_rod'],
    cmds: [
      "/particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 -10 10 'dis=1;s1=2*t;s2=0' 0.1 20 'i=0.1;(vx,vy,vz)=((i)*cos(s1),0,(i)*sin(s1))' 1 null",
    ],
  },
  {
    id: 'sphere',
    name: '球面壳（conditional 网格 + dis 筛选）',
    desc: '范围 3×3×3、步长 1 扫出 7³ 个网格点，用 `dis>2.5` 只留球壳上的点 —— 最省事的球面。',
    tags: ['conditional', '网格', '几何'],
    cmds: ["/particleex conditional minecraft:end_rod 0 0 0 1 0.8 0.6 1 0 0 0 3 3 3 'dis>2.5' 1 100 null 1 null"],
  },
  {
    id: 'spiral',
    name: '螺旋上升（parameter + t 曲线）',
    desc: 'parameter 让 t 从 0 到 2π 连续取值，表达式直接写成螺旋线 —— 一次生成 64 个粒子。',
    tags: ['parameter', '几何', 'flame'],
    cmds: ["/particleex parameter minecraft:flame 0 0 0 1 0.5 0.2 1 0 0 0 0 6.283 'x,y,z=2*cos(t),t*0.5,2*sin(t)' 0.1 200 null 1 null"],
  },
  {
    id: 'heart',
    name: '心形轮廓（parameter 心形方程）',
    desc: '经典心形参数方程摆点：x=0.8·sin³t、y=0.05·(13cos t−5cos2t−2cos3t−cos4t)。零命令速度 → 静止成形。',
    tags: ['parameter', '几何', 'heart'],
    cmds: ["/particleex parameter minecraft:heart 0 1 0 1 0.2 0.3 1 0 0 0 0 6.283 'x,y,z=0.8*sin(t)^3,0.05*(13*cos(t)-5*cos(2*t)-2*cos(3*t)-cos(4*t)),0' 0.1 200 null 1 null"],
  },
  {
    id: 'grow',
    name: '逐 tick 生长螺旋（tickparameter）',
    desc: 'tickparameter 每 tick 生成 3 个粒子、t 持续递增 → 效果随时间「长」出来，而不是一次成形。',
    tags: ['tickparameter', '时间演化', 'end_rod'],
    cmds: ["/particleex tickparameter minecraft:end_rod 0 0 0 1 1 1 1 0 0 0 0 20 'x,y,z=0.3*t*cos(t*6),0.1*t,0.3*t*sin(t*6)' 1 3 200 null 1 null"],
  },
  {
    id: 'gradient',
    name: '颜色渐变柱（rgbatickparameter）',
    desc: 'rgbatick 变体可以逐 tick 同时改位置与颜色（cr/cg/cb）—— 这里让柱体从蓝渐变到红。',
    tags: ['rgbatickparameter', '颜色', 'end_rod'],
    cmds: ["/particleex rgbatickparameter minecraft:end_rod 0 0 0 0 0 0 0 30 'x,y,z,cr,cg,cb=0.2*t,0.05*t,0,t/30,0.3,1-t/30' 1 2 200 null 1 null"],
  },
  {
    id: 'trail',
    name: '拖尾归位（trail NBT）',
    desc: 'trail 的 target 是绝对坐标：粒子每 tick 向目标插值，末 tick 精确落到目标点（原版行为，逐字节码核对）。',
    tags: ['trail', 'NBT', '运动学'],
    cmds: ["/particleex normal minecraft:trail{target:[0.0,2.0,0.0],color:[1.0,0.4,0.1],duration:20} 0 0 0 1 1 1 1 1 0 0 0 0 0 4 0 null 1 null"],
  },
  {
    id: 'vibration',
    name: '幽匿振动归位（vibration NBT）',
    desc: 'vibration 的 destination 指向方块中心、arrival_in_ticks 控制时长 —— 粒子绝对式 lerp 飞向声源。',
    tags: ['vibration', 'NBT', '运动学'],
    cmds: ["/particleex normal minecraft:vibration{destination:{block:{pos:[0,2,0]}},arrival_in_ticks:25} 0 0 0 1 1 1 1 1 0 0 0 0 0 4 0 null 1 null"],
  },
  {
    id: 'flytowards',
    name: '位置式飞行：附魔（enchant）',
    desc: 'enchant 用「命令位置 + 速度矢量」当出生点，然后整条轨迹收束回命令位置 —— 速度参数在这里是**形状**，不是速度。',
    tags: ['运动学', 'fly_towards', 'enchant'],
    cmds: ["/particleex normal minecraft:enchant 0 1 0 1 1 1 1 3 3 0 0 0 0 8 0 null 1 null"],
  },
  {
    id: 'leaves',
    name: '落叶飘落（cherry_leaves 曲线）',
    desc: '落叶族的 flowAway 曲线（pow(f2,1.25)）会自然飘散；注意要给非零命令速度，否则模组零速回滚会把它钉住。',
    tags: ['运动学', 'leaves', 'cherry_leaves'],
    cmds: ["/particleex normal minecraft:cherry_leaves 0 3 0 1 1 1 1 0.2 0 0 0 0 0 40 0 null 1 null"],
  },
  {
    id: 'dustpillar',
    name: '原版尘柱（dust_pillar + 方块态）',
    desc: '26.2 的 dust_pillar 走 provider：三次高斯决定初速（x/z 命令速度被覆写）、寿命 20+I(20)。方块态贴图由 NBT 给。',
    tags: ['原版 /particle', 'NBT', 'dust_pillar'],
    cmds: ['/particle dust_pillar{block_state:"minecraft:sand"} ~ ~1 ~ 0.5 0.5 0.5 0.2 60'],
  },
  {
    id: 'blockdebris',
    name: '原版方块碎屑（block + 方块态）',
    desc: 'Terrain 方块族：friction 0.98f + 重力 1.0f，贴图取方块材质 —— 换 block_state 就是换材质。',
    tags: ['原版 /particle', 'NBT', 'block'],
    cmds: ['/particle block{block_state:"minecraft:stone"} ~ ~1 ~ 0.5 0.5 0.5 0.2 60'],
  },
  {
    id: 'dustcloud',
    name: '原版彩色尘云（dust + color/scale）',
    desc: 'dust 的 NBT 带 color 与 scale，渲染色按 NBT 着色、大小按 scale 放大 —— 200 个粒子铺成一片云。',
    tags: ['原版 /particle', 'NBT', 'dust'],
    cmds: ['/particle dust{color:[1.0,0.35,0.1],scale:2.0} ~ ~1 ~ 1 0.5 1 0.05 200'],
  },
];

/** 精选模板（入口 chips 与「从模板开始」引导用）：几何直观、一眼看懂效果 */
export const FEATURED_IDS = ['ripple', 'ring', 'spiral', 'heart'] as const;

/** 按 id 查模板（分享链接/测试用） */
export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** 精选模板对象（顺序 = FEATURED_IDS；id 写错会被过滤掉） */
export function featuredTemplates(): Template[] {
  return FEATURED_IDS.map(templateById).filter((t): t is Template => t !== undefined);
}

/** 模板命令文本（多行用 \n 连接），即「复制」按钮写进剪贴板的内容 */
export function templateText(t: Template): string {
  return t.cmds.join('\n');
}
