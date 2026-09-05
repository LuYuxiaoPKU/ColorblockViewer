// 命令 schema 元数据：各子命令的规范用法（报错时给出，计划 §六.5「中文报错 + 规范用法」）。
// 参数顺序与默认值按 mod 各 *Command.java 的 brigadier 树逐字核对（M2 ground truth）。

export const USAGE: Record<string, string> = {
  normal: 'particleex normal <粒子名> <位置> <颜色> <速度> <范围> <数量> [age] [速度表达式] [speedStep] [group]',
  conditional: 'particleex conditional <粒子名> <位置> <颜色> <速度> <范围> <表达式> [step] [age] [速度表达式] [speedStep] [group]',
  parameter: 'particleex parameter <粒子名> <位置> <颜色> <速度> <begin> <end> <表达式> [step] [age] [速度表达式] [speedStep] [group]',
  polarparameter: 'particleex polarparameter <粒子名> <位置> <颜色> <速度> <begin> <end> <表达式> [step] [age] [速度表达式] [speedStep] [group]',
  tickparameter: 'particleex tickparameter <粒子名> <位置> <颜色> <速度> <begin> <end> <表达式> [step] [cpt] [age] [速度表达式] [speedStep] [group]',
  tickpolarparameter: 'particleex tickpolarparameter <粒子名> <位置> <颜色> <速度> <begin> <end> <表达式> [step] [cpt] [age] [速度表达式] [speedStep] [group]',
  rgbaparameter: 'particleex rgbaparameter <粒子名> <位置> <速度> <begin> <end> <表达式> [step] [age] [速度表达式] [speedStep] [group]',
  rgbapolarparameter: 'particleex rgbapolarparameter <粒子名> <位置> <速度> <begin> <end> <表达式> [step] [age] [速度表达式] [speedStep] [group]',
  rgbatickparameter: 'particleex rgbatickparameter <粒子名> <位置> <速度> <begin> <end> <表达式> [step] [cpt] [age] [速度表达式] [speedStep] [group]',
  rgbatickpolarparameter: 'particleex rgbatickpolarparameter <粒子名> <位置> <速度> <begin> <end> <表达式> [step] [cpt] [age] [速度表达式] [speedStep] [group]',
  'group remove': 'particleex group remove <组> [表达式] [位置]',
  'group change': 'particleex group change <parameter|speedexpression> <组> <表达式> [条件表达式] [位置]',
  clearparticle: 'particleex clearparticle',
};

export const SUBCOMMANDS = [
  'normal',
  'conditional',
  'parameter',
  'polarparameter',
  'tickparameter',
  'tickpolarparameter',
  'rgbaparameter',
  'rgbapolarparameter',
  'rgbatickparameter',
  'rgbatickpolarparameter',
  'group remove',
  'group change',
  'clearparticle',
] as const;
