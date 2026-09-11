// 命令执行 → 粒子生成（1:1 复刻 ClientNetworkHandler.normal/conditional/parameter
// + ParticleUtil.spawnParticle + TickParticleTask）。
//
// 错误语义（spawnParticle 的 try/catch）：单个粒子的生成期 RuntimeException
// （如速度表达式解析失败）→ 该粒子不生成、错误记入 result.errors，继续下一个
// （Java：catch → addChatMessage → return null）。命令级错误（表达式解析）由
// 调用方捕获，见 engine.runCommand。
//
// struct 生命周期（决定跨调用残留，忠实复刻）：
//  - normal/parameter 每个粒子的速度表达式：spawnParticle 内**每粒子** ExpressionUtil.parse
//    → 每个粒子一个全新 exe 实例（struct 初始默认值，无上一粒子残留）；
//  - conditional/parameter 主表达式：一次命令一个实例，循环内不清零；
//  - tick*parameter：TickParticleTask 持有一个实例，跨 tick 的多次 run 不清零。

import type { CompiledBlock } from '../engine';
import { ParticleStruct } from '../engine/struct';
import type { ParticleCommand } from '../command/types';
import { parseCompound, type NbtVal } from '../nbt/parse';
import { OPTION_FIELDS, NESTED_OPTION_FIELDS, parseColorField } from '../nbt/particleOptions';
import {
  computeSpawnStep,
  fillConditionalPoint,
  fillGroupChangeParam,
  fillGroupRelative,
  fillParameterPoint,
} from './structFill';
import type { SimRandom } from './rng';
import type { GroupIndex } from './groups';
import type { SimResult, SimParticle, TickGenerator } from './types';

/** 坐标求值：rel（~/^）→ 玩家位置 + v */
export function resolveVec3(
  v: { x: { v: number; rel: boolean }; y: { v: number; rel: boolean }; z: { v: number; rel: boolean } },
  playerPos: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const add = (c: { v: number; rel: boolean }, base: number) => (c.rel ? base + c.v : c.v);
  return { x: add(v.x, playerPos.x), y: add(v.y, playerPos.y), z: add(v.z, playerPos.z) };
}

/** spawnParticle 的入参（对应 Java 18 参签名；exe/exeStruct 可选 =
 *  预解析好的速度表达式实例，缺省由 spawnOne 在 try 内解析） */
export interface SpawnRequest {
  name: string;
  x: number; y: number; z: number;
  cx: number; cy: number; cz: number;
  r: number; g: number; b: number; a: number;
  vx: number; vy: number; vz: number;
  age: number;
  speedExpression: string | null;
  speedStep: number;
  group: string | null;
  exe?: CompiledBlock | null;
  exeStruct?: ParticleStruct | null;
  /** 原版 /particle 生成标记（渲染层出生色恒白；模组命令路径恒 false） */
  vanilla?: boolean;
  /** type{NBT} 解析出的渲染色（dust 的 color）：true 时渲染层不强制出生色为白 */
  nbtTint?: boolean;
  /** 点大小倍数（dust 的 scale，缺省 1） */
  sizeMul?: number;
  /** trail{NBT} 的 target（绝对坐标终点；引擎每 tick lerp 归位，TrailParticle.tick 字节码） */
  trailTarget?: { x: number; y: number; z: number };
  /** trail{NBT} 的 duration（寿命覆写；仅 age=0 路径生效，命令显式 age 优先） */
  trailDuration?: number;
  /** vibration{NBT} 的 arrival_in_ticks（构造器内 setLifetime 值；同
   *  trailDuration 规则——仅 age=0 路径生效，命令显式 age 优先） */
  vibrationArrival?: number;
  /** vibration{NBT} 的 destination block 中心（绝对坐标；引擎每 tick lerp 推进
   *  至波源中心，VibrationSignalParticle.tick 字节码） */
  vibrationTarget?: { x: number; y: number; z: number };
}

/** 命令执行上下文：engine 注入的生成回调与结果收集 */
export interface SpawnSink {
  /** 创建粒子（= ParticleUtil.spawnParticle 主体）；池满 → dropped++，不抛 */
  spawn(req: SpawnRequest): void;
  /** 注册 tick 生成器（本 tick 立即执行一次由 engine 负责） */
  addGenerator(g: TickGenerator): void;
  result: SimResult;
  playerPos: { x: number; y: number; z: number };
  /** 组索引（spawnParticle 内 GroupUtil.add） */
  groups: GroupIndex;
  /** normal 高斯偏移的共享 PRNG（Java 侧静态共享 RANDOM） */
  rand: SimRandom;
}

/** 单个粒子的生成（= ParticleUtil.spawnParticle 的 try/catch 包裹）。
 *  速度表达式解析在 try 内：失败 → 记 errors、不生成（Java：return null），
 *  不中断同命令后续粒子。 */
function spawnOne(sink: SpawnSink, req: SpawnRequest): boolean {
  let exe = req.exe ?? null;
  let exeStruct = req.exeStruct ?? null;
  if (exe === null && req.speedExpression != null) {
    try {
      exe = parseOptionalExpr(req.speedExpression);
      if (exe !== null) {
        exeStruct = new ParticleStruct(); // 每粒子全新实例（Java 每 ClassExpression 一个 struct）
      }
    } catch (err) {
      sink.result.errors.push((err as Error).message);
      return false;
    }
  }
  sink.spawn({ ...req, exe, exeStruct });
  return true;
}

// 避免循环 import：engine 提供 parse 注入（spawn 不直接依赖 engine/index，
// 测试里可换 stub）
let parseExprImpl: (src: string) => CompiledBlock = () => {
  throw new Error('parse not wired');
};
export function wireParse(fn: (src: string) => CompiledBlock): void {
  parseExprImpl = fn;
}
function parseExpr(src: string): CompiledBlock {
  return parseExprImpl(src);
}

/** ExpressionUtil.parse 语义：null/''/'null' → null（不解析不抛），
 *  其余走 parseExpr（真错误抛出 —— 调用方决定是否捕获）。 */
function parseOptionalExpr(src: string | null): CompiledBlock | null {
  if (src == null || src === '' || src === 'null') return null;
  return parseExpr(src);
}

// ---------- 浮点步长循环防护（运行时防护，非 1:1 后果）----------
// Java 的 for(t=begin; t<=end; t+=step) 在极端取值下是死循环：
// t+step===t（浮点粒度）时 t 不再前进；begin/end ~1e16、step=1 时约 2e16
// 次迭代才耗尽（期间无限生成 + 池上限丢弃）——Java 游戏内同为命令队列
// 冻结。预览不复制冻结后果：显式中止 + 提示，语义层 1:1 不变。
// 正常命令（range/begin/end 常规量级）远低于上限，不触发。
const MAX_FIXPOINT_ITERS = 1_000_000;

/** 步长守卫：prev → next 不前进 = 定点不收敛；总迭代超限 = 冻结态。 */
function stepGuard(prev: number, next: number, iters: number): void {
  if (prev === next) {
    throw new Error('浮点步长不收敛（t+step===t）：Java 版在此是死循环（命令队列冻结），预览已中止该命令。');
  }
  if (iters > MAX_FIXPOINT_ITERS) {
    throw new Error('迭代次数超限（>1,000,000）：Java 版在此同样是死循环/超长生成（冻结），预览已中止该命令（可缩小 range 或增大 step）。');
  }
}

// ---------- type{NBT} 载荷 → 渲染色/大小倍数（schema 见 nbt/particleOptions.ts）----------

/** trail 的 NBT 附加消费：target（Vec3 终点，**绝对坐标**——TrailParticle.tick
 *  每 tick `Mth.lerp(age/lifetime, 当前位置, target)`，与出生点同坐标系）与
 *  duration（寿命覆写 = setLifetime，仅 age=0 路径；命令显式 age 与模组
 *  语义一致地优先）。解析层已校验形状，此处防御性 try。 */
function nbtTrailExtra(nbt: string): {
  target?: { x: number; y: number; z: number };
  duration?: number;
} {
  const out: { target?: { x: number; y: number; z: number }; duration?: number } = {};
  let fields;
  try {
    fields = parseCompound(nbt);
  } catch {
    return out;
  }
  const t = fields.find(f => f.key === 'target');
  if (t && Array.isArray(t.val) && t.val.length === 3 && t.val.every(v => typeof v === 'number')) {
    out.target = { x: t.val[0] as number, y: t.val[1] as number, z: t.val[2] as number };
  }
  const d = fields.find(f => f.key === 'duration');
  if (d && typeof d.val === 'number' && Number.isInteger(d.val) && d.val >= 1) out.duration = d.val;
  return out;
}

/** vibration 的 NBT 附加消费：destination 的 block 中心（**绝对坐标**——
 *  VibrationSignalParticle.tick 每 tick `Mth.lerp(1/(lifetime−age), 当前位置,
 *  目标)`，与出生点同坐标系）。解析层已把 SAFE_POSITION_SOURCE 限定为
 *  {block:{pos:[x,y,z]}}（entity 源拒绝）→ pos 是 BlockPos，中心 = +0.5 各轴。
 *  arrival_in_ticks 消费为寿命覆写（与 trail duration 同规则：仅 age=0 路径
 *  生效，命令显式 age 优先——构造器内 setLifetime 的 Java 语义与预览
 *  「age 优先」约定在此对齐；负值/0 原样传入 → 首 tick 即死，与 Java
 *  age>=lifetime 判定一致）。 */
function nbtVibrationExtra(nbt: string): {
  target?: { x: number; y: number; z: number };
  arrival?: number;
} {
  const out: { target?: { x: number; y: number; z: number }; arrival?: number } = {};
  let fields;
  try {
    fields = parseCompound(nbt);
  } catch {
    return out;
  }
  const arr = fields.find(f => f.key === 'arrival_in_ticks');
  if (arr && typeof arr.val === 'number' && Number.isInteger(arr.val)) out.arrival = arr.val;
  const dest = fields.find(f => f.key === 'destination');
  if (!dest || typeof dest.val !== 'object' || dest.val === null || Array.isArray(dest.val)) return out;
  const inner = (dest.val as { [k: string]: NbtVal })['block'];
  if (!inner || typeof inner !== 'object' || inner === null || Array.isArray(inner)) return out;
  const pos = (inner as { [k: string]: NbtVal })['pos'];
  if (Array.isArray(pos) && pos.length === 3 && pos.every(v => typeof v === 'number' && Number.isInteger(v))) {
    out.target = { x: pos[0] as number + 0.5, y: pos[1] as number + 0.5, z: pos[2] as number + 0.5 };
  }
  return out;
}

/** type{NBT} 载荷 → 渲染色/大小倍数（schema 见 nbt/particleOptions.ts，
 *  逐类型字节码取证）。消费规则：
 *  - 渲染色：dust 的 color（DustParticle 构造器把 getColor() 写入 rCol/gCol/bCol；
 *    **逐粒子 ±20% 抖动** randomizeColor —— 预览不抖动，用基准色，已知近似）
 *    与 ARGB 类型（entity_effect/tinted_leaves/flash）的 color；
 *    dust_color_transition 取 from_color 作为出生色（age 插值不模拟，取动画起点）；
 *    trail 的 color（TrailParticle 构造器 scaleRGB(color, 0.875+0.25·jitter) 三轴各自
 *    抖动——预览不抖动且亮度取 1.0，已知近似）。
 *  - 点大小倍数：scale（仅 dust/dust_color_transition 有该字段，
 *    ScalableParticleOptionsBase 构造器 Mth.clamp 0.01-4）。
 *  - power/roll/delay 不影响可见外观（power 只影响亮度/衰减距离、roll 是旋转、
 *    delay 是延迟）→ 不消费。
 *  - 嵌套 8 类其余字段：block_state/item 选贴图、destination 定波源（预览无注册表
 *    → 不消费，近似清单见 kinematics）；trail 的 target/duration 由 execVanilla
 *    经 nbtTrailExtra 消费。
 *  非收录类型或空载荷 → 全缺省（白 + 1）。 */
function nbtVisuals(name: string, nbt: string | null): { nbtTint: boolean; sizeMul: number; r: number; g: number; b: number } {
  const def = { nbtTint: false, sizeMul: 1, r: 1, g: 1, b: 1 };
  if (nbt === null) return def;
  const base = name.replace(/^minecraft:/i, '').toLowerCase();
  const schema = OPTION_FIELDS[base] ?? NESTED_OPTION_FIELDS[base];
  if (!schema) return def;
  let fields;
  try {
    fields = parseCompound(nbt);
  } catch {
    return def; // 解析层已校验，此处防御（如 UI 手工构造的坏载荷）
  }
  let r = 1, g = 1, b = 1;
  let tint = false;
  let sizeMul = 1;
  for (const sf of schema) {
    const f = fields.find(x => x.key === sf.key);
    if (!f) continue; // 可选字段缺省：不消费（渲染色/大小保持缺省）
    if (sf.kind === 'rgb' || sf.kind === 'argb') {
      const isTintKey = sf.key === 'color' || (base === 'dust_color_transition' && sf.key === 'from_color');
      if (isTintKey) {
        const comp = parseColorField(f.val, sf.kind);
        if (comp) {
          // argb 首分量 = alpha（VECTOR4F 编码序）→ 渲染色取 RGB 三分量
          const rgb = sf.kind === 'argb' ? comp.slice(1) : comp;
          r = rgb[0]; g = rgb[1]; b = rgb[2]; tint = true;
        }
      }
    } else if (sf.key === 'scale' && typeof f.val === 'number' && f.val >= 0.01 && f.val <= 4) {
      sizeMul = f.val;
    }
  }
  return { nbtTint: tint, sizeMul, r, g, b };
}

// ---------- 各命令入口（与 ClientNetworkHandler 各 handler 一一对应）----------

/** normal：count 次高斯偏移（RANDOM 为共享静态，按 i 顺序逐次消费） */
export function execNormal(cmd: ParticleCommand & { kind: 'normal' }, sink: SpawnSink): void {
  const pos = resolveVec3(cmd.pos, sink.playerPos);
  for (let i = 0; i < cmd.count; i++) {
    const rx = sink.rand.nextGaussian() * cmd.range.x;
    const ry = sink.rand.nextGaussian() * cmd.range.y;
    const rz = sink.rand.nextGaussian() * cmd.range.z;
    spawnOne(sink, {
      name: cmd.name,
      x: pos.x + rx, y: pos.y + ry, z: pos.z + rz,
      cx: pos.x, cy: pos.y, cz: pos.z,
      r: cmd.color.r, g: cmd.color.g, b: cmd.color.b, a: cmd.color.a,
      vx: cmd.speed.x, vy: cmd.speed.y, vz: cmd.speed.z,
      age: cmd.age, speedExpression: cmd.speedExpression, speedStep: cmd.speedStep,
      group: cmd.group, exe: null, exeStruct: null,
    });
  }
}

/** conditional：三重扫描（浮点递增，含两端；exe!=null 时 invoke!=0 才生成）。
 *  主表达式 struct 一次命令一个，跨扫描点不清零。 */
export function execConditional(cmd: ParticleCommand & { kind: 'conditional' }, sink: SpawnSink): void {
  const pos = resolveVec3(cmd.pos, sink.playerPos);
  const exe = parseOptionalExpr(cmd.expression); // "null"/空 → null（无条件生成）；真错误抛给调用方
  const struct = new ParticleStruct();
  let iters = 0;
  let cx = -cmd.range.x;
  while (cx <= cmd.range.x) {
    let cy = -cmd.range.y;
    while (cy <= cmd.range.y) {
      let cz = -cmd.range.z;
      while (cz <= cmd.range.z) {
        stepGuard(cz, cz + cmd.step, iters++);
        if (exe != null) {
          fillConditionalPoint(struct, cx, cy, cz);
          if (exe.run(struct) === 0) {
            cz += cmd.step;
            continue;
          }
        }
        spawnOne(sink, {
          name: cmd.name,
          x: pos.x + cx, y: pos.y + cy, z: pos.z + cz,
          cx: pos.x, cy: pos.y, cz: pos.z,
          r: cmd.color.r, g: cmd.color.g, b: cmd.color.b, a: cmd.color.a,
          vx: cmd.speed.x, vy: cmd.speed.y, vz: cmd.speed.z,
          age: cmd.age, speedExpression: cmd.speedExpression, speedStep: cmd.speedStep,
          group: cmd.group,
        });
        cz += cmd.step;
      }
      stepGuard(cy, cy + cmd.step, iters);
      cy += cmd.step;
    }
    stepGuard(cx, cx + cmd.step, iters);
    cx += cmd.step;
  }
}

/** parameter 家族（8 变体）。
 *  - 非 tick：命令内同步 for 循环（struct 一次命令一个，不清零）；
 *  - tick：建 TickGenerator 立即 run 一次，之后每 tick 末排队（engine 负责）。
 *  - rgba 变体：cmd.color 为 null → 颜色/速度取 data；非 rgba → 命令值。 */
export function execParameter(cmd: ParticleCommand & { kind: 'parameter' }, sink: SpawnSink): void {
  const pos = resolveVec3(cmd.pos, sink.playerPos);
  // ClientNetworkHandler.parameter：parse 在 tick 判断**之前**，null 直接 return
  const exe = parseOptionalExpr(cmd.expression);
  if (exe == null) return;
  if (cmd.tick) {
    const g: TickGenerator = {
      name: cmd.name,
      x: pos.x, y: pos.y, z: pos.z,
      color: cmd.color,
      cmdVel: cmd.color === null ? null : { vx: cmd.speed.x, vy: cmd.speed.y, vz: cmd.speed.z },
      begin: cmd.begin, end: cmd.end, step: cmd.step, cpt: cmd.cpt,
      age: cmd.age, speedExpression: cmd.speedExpression, speedStep: cmd.speedStep,
      group: cmd.group, polar: cmd.polar,
      exe, struct: new ParticleStruct(), t: cmd.begin,
    };
    sink.addGenerator(g); // engine：立即 run 一次 + 注册
  } else {
    const struct = new ParticleStruct();
    let iters = 0;
    let t = cmd.begin;
    while (t <= cmd.end) {
      stepGuard(t, t + cmd.step, iters++);
      fillParameterPoint(struct, t);
      exe.run(struct);
      const step = computeSpawnStepLike(struct, cmd.polar, cmd.color, cmd.speed);
      spawnOne(sink, {
        name: cmd.name,
        x: pos.x + step.dx, y: pos.y + step.dy, z: pos.z + step.dz,
        cx: pos.x, cy: pos.y, cz: pos.z,
        r: step.color.r, g: step.color.g, b: step.color.b, a: step.color.a,
        vx: step.vel.vx, vy: step.vel.vy, vz: step.vel.vz,
        age: cmd.age, speedExpression: cmd.speedExpression, speedStep: cmd.speedStep,
        group: cmd.group,
      });
      t += cmd.step;
    }
  }
}

/** 非 tick parameter 的单步（与 TickGenerator 共用同一套 polar/rgba 语义） */
function computeSpawnStepLike(
  s: ParticleStruct,
  polar: boolean,
  color: { r: number; g: number; b: number; a: number } | null,
  speed: { x: number; y: number; z: number },
): {
  dx: number; dy: number; dz: number;
  color: { r: number; g: number; b: number; a: number };
  vel: { vx: number; vy: number; vz: number };
} {
  let dx: number;
  let dy: number;
  let dz: number;
  if (polar) {
    dx = s.dis * Math.cos(s.s2) * Math.cos(s.s1);
    dy = s.dis * Math.sin(s.s2);
    dz = s.dis * Math.cos(s.s2) * Math.sin(s.s1);
  } else {
    dx = s.x;
    dy = s.y;
    dz = s.z;
  }
  if (color === null) {
    // rgba 变体：颜色取 data；速度一律命令速度（非 tick 分支 Java 原文如此）
    return {
      dx, dy, dz,
      color: { r: s.cr, g: s.cg, b: s.cb, a: s.alpha },
      vel: { vx: speed.x, vy: speed.y, vz: speed.z },
    };
  }
  return {
    dx, dy, dz,
    color,
    vel: { vx: speed.x, vy: speed.y, vz: speed.z },
  };
}

/** TickGenerator 单步（= TickParticleTask.run 的一轮循环体；由 engine 驱动）。
 *  返回本 tick 是否还有 t <= end（→ 需要排队到下一 tick 初）。 */
export function runGeneratorStep(g: TickGenerator, sink: SpawnSink): boolean {
  const data = g.struct;
  let iters = 0;
  let i = 0;
  while (i < g.cpt && g.t <= g.end) {
    stepGuard(g.t, g.t + g.step, iters++);
    fillParameterPoint(data, g.t);
    g.exe.run(data);
    const step = computeSpawnStep(g);
    const color = step.color as { r: number; g: number; b: number; a: number };
    const vel = step.vel as { vx: number; vy: number; vz: number };
    spawnOne(sink, {
      name: g.name,
      x: g.x + step.dx, y: g.y + step.dy, z: g.z + step.dz,
      cx: g.x, cy: g.y, cz: g.z,
      r: color.r, g: color.g, b: color.b, a: color.a,
      vx: vel.vx, vy: vel.vy, vz: vel.vz,
      age: g.age, speedExpression: g.speedExpression, speedStep: g.speedStep,
      group: g.group,
    });
    g.t += g.step;
    i++;
  }
  return g.t <= g.end;
}

// ---------- 原版 /particle（MC 26.2 客户端语义，非 mod 语义）----------

/** 原版 /particle：复刻 ClientPacketListener.handleParticleEvent 的客户端
 *  生成语义（服务端命令 → 粒子包 → 客户端渲染，预览直接执行客户端侧）：
 *  - count == 0：单粒子，**精确**生成在 pos（无偏移），速度 = speed × delta
 *    各轴（确定值，非随机）；
 *  - count > 0：循环 count 次，每粒子先取 3 个 nextGaussian()×delta（位置偏移，
 *    delta = 各轴高斯**标准差**，非方向/半径），再取 3 个 nextGaussian()×speed
 *    （速度，同为各轴高斯标准差）——逐字对应字节码调用顺序；
 *  - 高斯消费走 sink.rand（与 normal 共享同一 PRNG，序列可复现）；
 *  - 颜色白（原版 SimpleParticleType 粒子按帧表贴图自带颜色，命令无颜色槽）；
 *  - 寿命：原版按类型 SpriteSet/自定义 duration，预览无逐类型数据 → 统一
 *    age=0 走 defaultLifetime（已知近似，README 已注明）；
 *  - normal 字面量只改游戏内 alwaysShow（是否无视粒子数量设置强制显示），
 *    预览无数量限制语义 → 无额外效果（仅影响回显文本）。 */
export function execVanilla(cmd: ParticleCommand & { kind: 'vanilla' }, sink: SpawnSink): void {
  const base = cmd.pos === null ? sink.playerPos : resolveVec3(cmd.pos, sink.playerPos);
  const delta = cmd.delta ?? { x: 0, y: 0, z: 0 };
  const speed = cmd.speed ?? 0;
  const count = cmd.count ?? 0;
  // 收录类型的 NBT 颜色/尺寸消费（其余类型 NBT 不消费 → 白 + 1）
  const vis = nbtVisuals(cmd.name, cmd.nbt);
  const baseName = cmd.name.replace(/^minecraft:/i, '').toLowerCase();
  const trailExtra = baseName === 'trail' && cmd.nbt !== null ? nbtTrailExtra(cmd.nbt) : {};
  const vibrationExtra = baseName === 'vibration' && cmd.nbt !== null ? nbtVibrationExtra(cmd.nbt) : {};
  if (count === 0) {
    // 单粒子：精确位置 + 确定速度 speed×delta
    spawnOne(sink, {
      name: cmd.name,
      x: base.x, y: base.y, z: base.z,
      cx: base.x, cy: base.y, cz: base.z,
      r: vis.r, g: vis.g, b: vis.b, a: 1,
      vx: speed * delta.x, vy: speed * delta.y, vz: speed * delta.z,
      age: 0, speedExpression: null, speedStep: 1.0,
      group: null, exe: null, exeStruct: null,
      vanilla: true,
      nbtTint: vis.nbtTint,
      sizeMul: vis.sizeMul,
      trailTarget: trailExtra.target,
      trailDuration: trailExtra.duration,
      vibrationTarget: vibrationExtra.target,
      vibrationArrival: vibrationExtra.arrival,
    });
    return;
  }
  for (let i = 0; i < count; i++) {
    // 每粒子 6 次 nextGaussian：位置偏移 x/y/z、速度 x/y/z（字节码顺序）
    const ox = sink.rand.nextGaussian() * delta.x;
    const oy = sink.rand.nextGaussian() * delta.y;
    const oz = sink.rand.nextGaussian() * delta.z;
    const vx = sink.rand.nextGaussian() * speed;
    const vy = sink.rand.nextGaussian() * speed;
    const vz = sink.rand.nextGaussian() * speed;
    spawnOne(sink, {
      name: cmd.name,
      x: base.x + ox, y: base.y + oy, z: base.z + oz,
      cx: base.x, cy: base.y, cz: base.z,
      r: vis.r, g: vis.g, b: vis.b, a: 1,
      vx, vy, vz,
      age: 0, speedExpression: null, speedStep: 1.0,
      group: null, exe: null, exeStruct: null,
      vanilla: true,
      nbtTint: vis.nbtTint,
      sizeMul: vis.sizeMul,
      trailTarget: trailExtra.target,
      trailDuration: trailExtra.duration,
      vibrationTarget: vibrationExtra.target,
      vibrationArrival: vibrationExtra.arrival,
    });
  }
}

// ---------- group 操作 ----------

/** group remove：对每个 `|` 组每个活粒子填相对坐标(+age)，invoke!=0 才移除。
 *  注意 Java：exe 解析在每个组名内进行（组数>1 时多次 parse，预览用同一 struct 近似）。
 *  返回实际移除数（测试用）。 */
export function execGroupRemove(
  cmd: Extract<ParticleCommand, { kind: 'group'; sub: 'remove' }>,
  sink: SpawnSink,
  engine: GroupEngineView,
): number {
  const ref = cmd.pos === null ? sink.playerPos : resolveVec3(cmd.pos, sink.playerPos);
  let removed = 0;
  for (const name of cmd.group.split('|')) {
    // Java：exe 解析在**每个组名**内（组数>1 时重复 parse；预览缓存下等价）
    const exe = cmd.expression != null ? parseOptionalExpr(cmd.expression) : null;
    const struct = exe !== null ? new ParticleStruct() : null;
    for (const id of sink.groups.membersOf(name)) {
      const p = engine.get(id);
      if (!p || !p.alive) continue;
      if (exe != null && struct != null) {
        fillGroupRelative(struct, p.x, p.y, p.z, ref.x, ref.y, ref.z, p.age);
        if (exe.run(struct) !== 0) {
          engine.kill(id); // remove()：alive=false（组内死 id 下方 prune 清理）
          removed++;
        }
      } else {
        engine.kill(id);
        removed++;
      }
    }
    // Java：particles.removeIf(!isAlive)（每组各清一次）
    engine.prune(name);
  }
  return removed;
}

/** group change：条件过滤（cexe do-while）后按 type 修改。
 *  case 0 parameter：主表达式改位置/颜色/速度/中心；
 *  case 1 speedexpression：换 exe（**不重置 moveT**，逐字复刻）。
 *
 *  ⚠️ Java 原文的 do-while 结构（逐字复刻，含其边角行为）：
 *    do {
 *      if (!hasNext) return;              // 迭代器耗尽 → 整条命令终止
 *      particle = next();
 *      if (!particle.isAlive()) continue; // continue → 直接跳到 while 条件！
 *      if (cexe == null) break;
 *      填充 data;
 *    } while (cexe.invoke() == 0);        // 0 → 取下一个粒子；1 → 选中
 *    switch(type) { …对 particle 应用… }  // 选中的可能是**死粒子**（见下）
 *  由此产生的忠实行为：
 *  - 死粒子 + cexe==null → continue 跳到 `cexe.invoke()` → **NPE**（游戏内崩溃，
 *    预览记录错误并终止本命令）；
 *  - 死粒子 + cexe!=null → 用**上一次填充的残留 data** 调 invoke：0 → 继续取
 *    下一个；1 → 选中死粒子并应用修改（对死粒子无可见效果，但不报错）。 */
export function execGroupChange(
  cmd: Extract<ParticleCommand, { kind: 'group'; sub: 'change' }>,
  sink: SpawnSink,
  engine: GroupEngineView,
): void {
  const ref = cmd.pos === null ? sink.playerPos : resolveVec3(cmd.pos, sink.playerPos);
  // Java：两表达式都在循环前 parse（"null"/空 → null，不抛）；真错误抛给调用方
  const exe = parseOptionalExpr(cmd.expression);
  const cexe = parseOptionalExpr(cmd.conditionalExpression);
  const cStruct = cexe !== null ? new ParticleStruct() : null;
  const pStruct = new ParticleStruct();

  const ids = sink.groups.get(cmd.group); // Java：GroupUtil.get(group).iterator()
  let i = 0;

  while (true) {
    // ---- do-while：取下一个「选中」粒子 ----
    // selected=null 且 deadSelected=true → 死粒子被残留 data 选中（switch 无可见效果，跳过）
    let selected: SimParticle | null = null;
    let deadSelected = false;
    let exhausted = false;
    let npe = false;
    for (;;) {
      // do 体
      if (i >= ids.length) {
        exhausted = true;
        break;
      }
      const pid = ids[i++];
      const p = engine.get(pid);
      if (!p || !p.alive) {
        // Java continue → 跳到 while 条件 cexe.invoke()
        if (cexe === null) {
          npe = true;
          break;
        }
        if (cexe.run(cStruct as ParticleStruct) !== 0) {
          deadSelected = true; // 残留 data 判定为真 → 选中死粒子
          break;
        }
        continue; // 条件为 0 → 下一轮 do
      }
      if (cexe === null) {
        selected = p;
        break;
      }
      fillGroupRelative(cStruct as ParticleStruct, p.x, p.y, p.z, ref.x, ref.y, ref.z, -1);
      if (cexe.run(cStruct as ParticleStruct) !== 0) {
        selected = p;
        break;
      }
      // 条件为 0 → 继续 do（取下一个粒子）
    }
    if (exhausted) return; // Java：!hasNext → return
    if (npe) {
      throw new Error(
        'java.lang.NullPointerException: Cannot invoke "com.noone.particleex.util.IExecutable.invoke()" because "cexe" is null',
      );
    }
    if (deadSelected) {
      // Java：switch 对死粒子对象应用（move/setCenter/setRenderColor/setExe…）——
      // 对活粒子集合无任何可见效果，直接回到外层取下一个
      continue;
    }
    const p = selected as SimParticle;

    // ---- switch(type) ----
    if (cmd.type === 'parameter') {
      if (exe === null) continue; // Java：break（仅本粒子跳过，外层继续）
      fillGroupChangeParam(pStruct, p, ref.x, ref.y, ref.z);
      const prevx = pStruct.vx;
      const prevy = pStruct.vy;
      const prevz = pStruct.vz;
      exe.run(pStruct);
      // move(data.x - (x - ref)) ≡ 摆到 ref + data.x
      p.x = ref.x + pStruct.x;
      p.y = ref.y + pStruct.y;
      p.z = ref.z + pStruct.z;
      p.cx = pStruct.cx;
      p.cy = pStruct.cy;
      p.cz = pStruct.cz;
      p.r = pStruct.cr;
      p.g = pStruct.cg;
      p.b = pStruct.cb;
      p.a = pStruct.alpha;
      if (pStruct.vx !== prevx || pStruct.vy !== prevy || pStruct.vz !== prevz) {
        p.stop = pStruct.vx === 0 && pStruct.vy === 0 && pStruct.vz === 0;
      }
      p.vx = pStruct.vx;
      p.vy = pStruct.vy;
      p.vz = pStruct.vz;
    } else {
      // case 1：换速度表达式；新 exe 实例 = 全新 struct（无残留），moveT 保持不动
      p.exe = exe;
      p.exeStruct = exe !== null ? new ParticleStruct() : null;
    }
  }
}

/** spawn.ts 需要的 engine 窄接口（避免循环依赖） */
export interface GroupEngineView {
  get(id: number): SimParticle | undefined;
  /** remove()：alive=false（组内死 id 由 prune 惰性清理，与 Java removeIf 一致） */
  kill(id: number): void;
  /** group remove 的 removeIf(!isAlive) */
  prune(name: string): void;
}
