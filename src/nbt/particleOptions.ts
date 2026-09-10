// 原版 /particle 的 type{NBT} 载荷：各类型 ParticleOptions CODEC 的字段 schema。
// 取证（26.2 命名版 client.jar 逐类 javap；1.21.11 混淆版 vt.class 同构核对）：
//  - 类型 → options 类映射：ParticleTypes.<clinit> 的 register 调用序列 +
//    BootstrapMethods 表（lambda$static$N → 各 Options.CODEC），见
//    「技术路线 §7 / §10 证据清单」。
//  - 字段 codec：
//      RGB_COLOR_CODEC  = Codec.INT(0xRRGGBB, 0-16777215) .withAlternative(VECTOR3F [r,g,b] 0-1)
//      ARGB_COLOR_CODEC = Codec.INT(0xAARRGGBB) .withAlternative(VECTOR4F [a,r,g,b] 0-1)
//      SCALE            = Codec.FLOAT.validate(s∈[0.01,4])（ScalableParticleOptionsBase，
//                        构造器 Mth.clamp 同区间）—— 越界 = 解码失败
//      POSITIVE_INT     = ExtraCodecs.intRangeWithMessage(1, intMax)（<clinit> 字节码
//                        iconst_1 实参确认：v<1 || v>intMax → 拒绝）—— geyser 系 water_blocks 用
//  - 必填性（字节码 fieldOf / optionalFieldOf 逐处核对）：
//      fieldOf        = 必填（缺 → Can't parse particle options）；
//      optionalFieldOf= 可选，缺省值 = 字节码实参（effect 的 color 缺省 -1 即
//      0xFFFFFFFF 白、power 缺省 1f —— 与 create 构造器一致）。
// 26.2 共 22 类携带载荷：本表 14 个扁平标量类型（16 个类型名）；嵌套 8 类
// （block/block_marker/block_crumble/falling_dust/dust_pillar = BlockState、
// item = ItemStackTemplate、vibration = PositionSource+ticks、trail = Vec3+color+duration）
// 需要嵌套 NBT → 解析层统一「嵌套 NBT 暂不支持」，见 command/parser.ts。
// 1.21.11：effect/instant_effect/entity_effect/tinted_leaves/flash/dragon_breath/
// dust_color_transition/sculk_charge/shriek 的 schema 与 26.2 一致；
// geyser/geyser_base/geyser_poof/geyser_plume 仅 26.2 注册（1.21.11 无此类型，
// 命令按未知类型回显失败，不经由此表）。
// SNBT 十六进制字面量语义（两版字节码均坐实，parse.ts 按此实现）：
//  - 26.2 net/minecraft/nbt/SnbtGrammar：hex 数字集 [0-9a-fA-F]（F 是数字不是
//    float 后缀）；无后缀默认 INT 且走 parseUnsignedInt（0x80000000 → 取补
//    -2147483648 的 int 位模式），显式 I 后缀走有符号 parseInt。
//  - 1.21.11 混淆版 vt.class（= 同代 SnbtGrammar）：vt$c 数字字面量规则
//    （base vt$b a/b/c → radix 2/10/16 三档 tableswitch）+ vt$3 hex 谓词
//    tableswitch（48-57 '0'-'9'、65-70 'A'-'F'、97-102 'a'-'f'、95 '_'
//    数字分隔符）+ vt$g SIGNED/UNSIGNED + vt$i 后缀枚举（c=BYTE d=SHORT
//    e=INT f=LONG，a/b=FLOAT/DOUBLE 走浮点规则；vt$c.a 的 ordinal 2-5
//    tableswitch 实锤 c/d/e/f → parseByte/parseShort/parseInt/parseLong）
//    + 无后缀经 requireNonNullElse 兜底 vt$i.e = INT 无符号路径
//    （parseUnsignedInt）—— 与 26.2 逐条同构。两版一致，解析层无需分区。

import type { NbtVal } from './parse';

export type FieldKind = 'rgb' | 'argb' | 'scale' | 'float' | 'int' | 'posint';

export interface OptionField {
  /** SNBT 字段名（= 字节码 fieldOf 的字符串常量） */
  key: string;
  kind: FieldKind;
  /** 可选字段（optionalFieldOf）的缺省值 = 字节码实参；undefined = 必填 */
  def?: number;
}

/** 类型名 → 字段 schema（顺序 = 字节码 fieldOf/optionalFieldOf 出现序，
 *  错误消息按此序报首个缺失）。 */
export const OPTION_FIELDS: Record<string, OptionField[]> = {
  // DustParticleOptions：{ color: RGB 必填, scale: SCALE 必填 ∈[0.01,4] }
  // （REDSTONE = {color:0xFF0000, scale:1}；两字段均 fieldOf 必填）
  dust: [{ key: 'color', kind: 'rgb' }, { key: 'scale', kind: 'scale' }],
  // DustColorTransitionOptions：{ from_color: RGB, to_color: RGB, scale: SCALE } 三字段均必填
  dust_color_transition: [
    { key: 'from_color', kind: 'rgb' },
    { key: 'to_color', kind: 'rgb' },
    { key: 'scale', kind: 'scale' },
  ],
  // SpellParticleOption：{ color: RGB 可选缺省 -1（0xFFFFFFFF 白）, power: FLOAT 可选缺省 1 }
  effect: [{ key: 'color', kind: 'rgb', def: -1 }, { key: 'power', kind: 'float', def: 1 }],
  instant_effect: [{ key: 'color', kind: 'rgb', def: -1 }, { key: 'power', kind: 'float', def: 1 }],
  // ColorParticleOption：{ color: ARGB 必填 }
  entity_effect: [{ key: 'color', kind: 'argb' }],
  tinted_leaves: [{ key: 'color', kind: 'argb' }],
  flash: [{ key: 'color', kind: 'argb' }],
  // PowerParticleOption：{ power: FLOAT 可选缺省 1 }
  dragon_breath: [{ key: 'power', kind: 'float', def: 1 }],
  // SculkChargeParticleOptions：{ roll: FLOAT 必填 }
  sculk_charge: [{ key: 'roll', kind: 'float' }],
  // ShriekParticleOption：{ delay: INT 必填 }
  shriek: [{ key: 'delay', kind: 'int' }],
  // GeyserParticleOptions：{ water_blocks: POSITIVE_INT 必填（≥1，ExtraCodecs
  // intRangeWithMessage(1, intMax)）}。仅 26.2 注册（1.21.11 无此类型）。
  geyser: [{ key: 'water_blocks', kind: 'posint' }],
  geyser_plume: [{ key: 'water_blocks', kind: 'posint' }],
  // GeyserBaseParticleOptions：{ water_blocks: POSITIVE_INT, burst_impulse_base: FLOAT } 均必填
  geyser_base: [
    { key: 'water_blocks', kind: 'posint' },
    { key: 'burst_impulse_base', kind: 'float' },
  ],
  geyser_poof: [
    { key: 'water_blocks', kind: 'posint' },
    { key: 'burst_impulse_base', kind: 'float' },
  ],
};

/** SCALE 的 validate 区间（ScalableParticleOptionsBase：fcmpl 0.01 / fcmpg 4.0） */
export const SCALE_MIN = 0.01;
export const SCALE_MAX = 4;

/** 字段 codec 种类 → 中文提示用语 */
const KIND_CN: Record<FieldKind, string> = {
  rgb: 'RGB 颜色',
  argb: 'ARGB 颜色',
  scale: '浮点数（范围 [0.01, 4]）',
  float: '浮点数',
  int: '整数',
  posint: '正整数（≥1）',
};

/** 解析颜色字段值 → 0-1 分量。返回 null = 非法（调用方报错）。
 *  rgb → 3 分量；argb → 4 分量（alpha 在前，与 VECTOR4F 编码序一致）。 */
export function parseColorField(val: NbtVal, kind: 'rgb' | 'argb'): number[] | null {
  const n = kind === 'rgb' ? 3 : 4;
  const maxInt = n === 3 ? 0xffffff : 0xffffffff; // rgb → 0xFFFFFF；argb → 0xFFFFFFFF
  if (Array.isArray(val)) {
    if (val.length !== n || val.some(v => typeof v !== 'number' || v < 0 || v > 1)) return null;
    return (val as number[]).slice();
  }
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= maxInt) {
    // SNBT 整数字面量（十进制或 0x…，类型后缀剥除后已为 JS number）
    const out: number[] = [];
    for (let i = n - 1; i >= 0; i--) out.push(((val >>> (i * 8)) & 0xff) / 255);
    return out;
  }
  return null;
}

/** 可选颜色字段的缺省值（= 字节码 optionalFieldOf 实参；如 -1 = 0xFFFFFFFF 白）。
 *  渲染层消费用：缺省颜色按 0x… 位展开，负数按无符号 32 位处理。 */
export function defaultColorComponents(def: number, kind: 'rgb' | 'argb'): number[] {
  const n = kind === 'rgb' ? 3 : 4;
  const u = def >>> 0; // 负数 → 无符号 32 位（-1 = 0xFFFFFFFF）
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(((u >>> (i * 8)) & 0xff) / 255);
  return out;
}

/** 校验单个字段值是否合法（不消费；parser 层用）。
 *  返回 null = 合法；否则返回「应为 X」/「超出范围」形式的中文片段。 */
export function checkField(kind: FieldKind, val: NbtVal): string | null {
  if (kind === 'rgb' || kind === 'argb') {
    return parseColorField(val, kind) === null ? `应为${KIND_CN[kind]}` : null;
  }
  if (kind === 'scale' || kind === 'float') {
    if (typeof val !== 'number' || !Number.isFinite(val)) return '应为浮点数';
    if (kind === 'scale' && (val < SCALE_MIN || val > SCALE_MAX)) {
      return `超出范围 [${SCALE_MIN}, ${SCALE_MAX}]`;
    }
    return null;
  }
  if (kind === 'posint') return checkPosInt(val);
  // int
  if (typeof val !== 'number' || !Number.isInteger(val)) return '应为整数';
  return null;
}

/** posint（ExtraCodecs.POSITIVE_INT = intRangeWithMessage(1, intMax)）：
 *  与 int 同判 + 下界 ≥1（lambda 字节码：v.compareTo(1)<0 || v.compareTo(intMax)>0 → 拒绝）。 */
export function checkPosInt(val: NbtVal): string | null {
  const r = checkField('int', val);
  if (r !== null) return r;
  if ((val as number) < 1) return '应为正整数（≥1）';
  return null;
}

export function fieldKindCn(kind: FieldKind): string {
  return KIND_CN[kind];
}
