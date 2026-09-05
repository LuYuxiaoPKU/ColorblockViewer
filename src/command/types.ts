// M2 命令解析类型定义（计划 §3.1 命令 schema）。
// ground truth：mod 的 brigadier 命令树（ParameterCommand / NormalCommand /
// ConditionalCommand / GroupCommand），参数顺序与默认值按各 executes() 实参逐字核对。

// 单个坐标：rel = 源文本含 ~ 或 ^（执行期用可配置玩家位置求值）。
// 预览中 ^（MC 语义「相对上一次位置」，玩家执行时即当前位置）与 ~ 等价，统一 rel。
export interface Coord {
  v: number;
  rel: boolean;
}

// 可含 ~ 的位置（命令位置 = 粒子中心 cx,cy,cz）
export interface Vec3 {
  x: Coord;
  y: Coord;
  z: Coord;
}

// 纯数值三元组（速度/范围，MC 端为 DoubleArgumentType，不接受 ~）
export interface Vec3Plain {
  x: number;
  y: number;
  z: number;
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

// 公共尾部 [age, 0] [speedExpression, null] [speedStep, 1.0] [group, null]
// （ brigadier 可选链前缀封闭：后一参数出现则前一参数必然出现，默认值按 Java executes 实参）
export interface CommonTail {
  age: number;
  speedExpression: string | null;
  speedStep: number;
  group: string | null; // '|' 分隔多组名
}

interface Base {
  name: string; // 粒子名（ParticleArgument；预览不校验枚举，UI 下拉提供建议）
  pos: Vec3; // 命令位置（中心）
}

export interface NormalCmd extends Base, CommonTail {
  kind: 'normal';
  color: RGBA;
  speed: Vec3Plain;
  range: Vec3Plain; // 高斯标准差（≥0）
  count: number; // ≥0
}

export interface ConditionalCmd extends Base, CommonTail {
  kind: 'conditional';
  color: RGBA;
  speed: Vec3Plain;
  range: Vec3Plain;
  expression: string; // 条件表达式（invoke != 0 才生成）
  step: number; // 扫描步长（>0，默认 0.1）
}

export interface ParameterCmd extends Base, CommonTail {
  kind: 'parameter';
  polar: boolean;
  tick: boolean;
  rgba: boolean;
  color: RGBA | null; // rgba* 变体无颜色参数（null）
  speed: Vec3Plain;
  begin: number;
  end: number;
  expression: string;
  step: number; // >0，默认 0.1
  cpt: number; // 每 tick 生成数 ≥1，默认 10（tick 与非 tick 树里都有默认值，非 tick 不使用）
}

export type GroupCmd =
  | { kind: 'group'; sub: 'remove'; group: string; expression: string | null; pos: Vec3 | null }
  | {
      kind: 'group';
      sub: 'change';
      type: 'parameter' | 'speedexpression'; // Java changeType 0/1
      group: string;
      expression: string;
      conditionalExpression: string | null;
      pos: Vec3 | null;
    };

export interface ClearCmd {
  kind: 'clearparticle';
}

export type ParticleCommand = NormalCmd | ConditionalCmd | ParameterCmd | GroupCmd | ClearCmd;
