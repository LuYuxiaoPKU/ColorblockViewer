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

/** 原版 /particle（MC 26.2，net.minecraft.server.commands.ParticleCommand 逐字核对）：
 *  /particle <name> [pos] [delta] [speed] [count] [force] [normal]
 *  - 槽位链前缀封闭（name 必填，其余依次可选）；
 *  - name 支持 type 与 type{NBT}（dust/block/item 等复杂类型）；NBT 载荷预览不解析，
 *    类型名保留（渲染层按类型名取帧表）；
 *  - pos 支持 ~（命令树 vec3()）；delta 为绝对值（命令树 vec3(0)，各轴高斯标准差）；
 *  - 客户端语义（ClientPacketListener.handleParticleEvent）：delta = 各轴高斯标准差，
 *    speed = 各轴速度高斯标准差（均随机，非方向/大小向量）；count=0 = 单粒子；
 *  - force / viewers <玩家> 槽位预览无意义（无多人分发）→ 解析层拒绝。 */
export interface VanillaCmd {
  kind: 'vanilla';
  name: string; // 粒子类型名（可选 minecraft: 前缀；type{NBT} 的 NBT 已剥离）
  pos: Vec3 | null; // null = 命令树默认（执行者位置；预览 = 玩家位置）
  delta: Vec3Plain | null; // null = 命令树默认 Vec3.ZERO（绝对值，各轴高斯标准差）
  speed: number | null; // float ≥ 0，null = 命令树默认 0（各轴速度高斯标准差）
  count: number | null; // int ≥ 0，null = 命令树默认 0（= 单粒子）
  /** 尾部 normal 字面量（命令树 [normal] [viewers]，viewers 预览不支持；
   *  无该字面量时客户端走「force」分支，预览等价 —— 见 execVanilla 注释） */
  normal: boolean;
  /** type{NBT} 的 NBT 载荷（null = 无；解析层按 nbt/particleOptions.ts 收录的
   *  14 个扁平标量类型逐类型 CODEC 校验，渲染层消费渲染色/大小倍数——
   *  见 command/parser.ts parseVanillaNbt 与 sim/spawn.ts nbtVisuals 注释）。
   *  取证（26.2 命名版逐类 javap；1.21.11 混淆版同构）：
   *  dust 的 CODEC = { color: RGB_COLOR_CODEC(0xRRGGBB int 或 [r,g,b] 0-1),
   *  scale: FLOAT validate [0.01,4] }，REDSTONE = {color:0xFF0000, scale:1}。 */
  nbt: string | null;
}

export type ParticleCommand = NormalCmd | ConditionalCmd | ParameterCmd | GroupCmd | ClearCmd | VanillaCmd;
