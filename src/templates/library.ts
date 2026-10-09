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
    desc: '极坐标参数命令摆出一个圆环，切向速度表达式随 t 指数衰减 → 粒子绕圈流动渐趋静止。',
    tags: ['polarparameter', '表达式', 'end_rod'],
    cmds: [
      "/particleex polarparameter minecraft:end_rod ~ ~2 ~ 1 0.95 0.89 1 0 0 0 0 6.2832 'dis=0.05;s1=t;s2=0' 0.0628 20 '(vx,vy,vz)=(0.25*exp(0-(t+0.5)/8)*cos(s1),0,0.25*exp(0-(t+0.5)/8)*sin(s1))' 1 null",
    ],
  },
];

/** 按 id 查模板（分享链接/测试用） */
export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** 模板命令文本（多行用 \n 连接），即「复制」按钮写进剪贴板的内容 */
export function templateText(t: Template): string {
  return t.cmds.join('\n');
}
