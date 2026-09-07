// 仿真引擎（计划 §七）。headless 可单测：手动 tickOnce() 驱动，无 Three 依赖。
//
// 每 tick 顺序（对齐 MC 客户端时序 + 计划 §七）：
//   ① 排队的 tick 生成器（Java：TickEndTask 在上一 tick 末排 TICKEND 队列，
//      下一 tick 初 onStartClientTick 把它搬回 TICKSTART 队列并立即执行 ——
//      效果 = 每 tick 初跑一批 cpt 个）；
//   ② 新粒子入池 + 每活粒子跑 §3.4 动画（customTick 语义）；
//   ③ swap-remove 压实死亡，tick++。
// 命令在 tick 之间执行（M5 时序：粘贴→runCommand→下一 tick 动画），与 Java
// 「execute 队列在 tick 事件之后清空」一致。

import { parse } from '../engine';
import { ParticleStruct } from '../engine/struct';
import type { ParticleCommand } from '../command/types';
import { GroupIndex } from './groups';
import { SimRandom } from './rng';
import {
  wireParse,
  execNormal,
  execConditional,
  execParameter,
  execVanilla,
  execGroupRemove,
  execGroupChange,
  runGeneratorStep,
  type SpawnRequest,
  type SpawnSink,
} from './spawn';
import { fillFirstMove, fillPerTick } from './structFill';
import { nativeSpecFor, nativeLifetimeFor } from './kinematics';
import type { SimConfig, SimParticle, SimResult, TickGenerator } from './types';

const INT_MAX = 2147483647;

export class SimEngine {
  readonly config: SimConfig;
  readonly groups = new GroupIndex();
  /** normal 高斯偏移的共享 PRNG（Java 侧静态共享 RANDOM；跨命令持续消费；
   *  reset() 时重建同种子实例） */
  rand: SimRandom;
  /** 原版粒子随机寿命专用 PRNG（Java：Particle 每个实例自带 new Random()，
   *  与 mod 的静态 RANDOM 是不同序列）：「原版运动学」开启时 end_rod 的
   *  maxAge = 60 + nextInt(12) 从这里消费。种子 = seed+1（与共享序列分离，
   *  可复现）；reset/updateConfig(seed) 时同步重建。 */
  vanillaRand: SimRandom;

  /** 粒子池：活粒子恒占 [0, count)；死亡 swap-remove 压实（对象移出数组，
   *  组索引里的死 id 滞留 —— 与 Java「组列表只在 group remove/clear 时清理」一致） */
  private pool: SimParticle[] = [];
  private count = 0;
  private nextId = 1;

  /** 排队的 tick 生成器（下一 tick 初执行一批） */
  private generators: TickGenerator[] = [];
  /** 命令期/生成器期新生成、尚未入池的粒子 */
  private pending: SimParticle[] = [];

  tick = 0;
  dropped = 0;

  /** tick 期错误收集（无命令上下文；UI 轮询 toast） */
  readonly tickErrors: string[] = [];

  constructor(config: SimConfig) {
    this.config = { ...config };
    this.rand = new SimRandom(config.seed);
    this.vanillaRand = new SimRandom(config.seed + 1);
    wireParse(parse); // spawn.ts 的表达式入口 → 引擎（带缓存）
  }

  /** 活粒子数（含 pending；**过滤 alive** —— 同批次里 group remove 杀掉的
   *  pending 粒子不应计入） */
  get aliveCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.pool[i].alive) n++;
    for (const p of this.pending) if (p.alive) n++;
    return n;
  }

  /** 排队的 tick 生成器数（播放自动停止判据用：生成器未完成时场景仍会演进） */
  get queuedGenerators(): number {
    return this.generators.length;
  }

  /** 是否还有会演进的活工作：活粒子（age/lifetime 推进）或排队生成器
   *  （继续吐粒子）。age=-1 粒子 lifetime=INT_MAX，实际永不到期。 */
  hasLiveWork(): boolean {
    return this.aliveCount > 0 || this.generators.length > 0;
  }

  /** 按 id 查粒子（组操作用；含 pending，不含已压实的死粒子） */
  get(id: number): SimParticle | undefined {
    for (let i = 0; i < this.count; i++) {
      if (this.pool[i].id === id) return this.pool[i];
    }
    return this.pending.find((p) => p.id === id);
  }

  /** 活粒子快照（渲染层用；池序 + pending 序，**过滤 alive** ——
   *  死亡粒子在下次 tickOnce 压实前仍留在池内，渲染不可见） */
  snapshot(): SimParticle[] {
    const out = this.pool.slice(0, this.count).filter((p) => p.alive);
    if (this.pending.length > 0) {
      out.push(...this.pending.filter((p) => p.alive));
    }
    return out;
  }

  // ---------- 命令入口 ----------

  /** 执行一条命令（M2 解析产物）。
   *  命令级错误（表达式解析/运行期）向上抛（M5 逐行捕获 toast，后续行继续）；
   *  生成期错误（单粒子速度表达式解析失败）记入 result.errors，不中断。 */
  runCommand(cmd: ParticleCommand): SimResult {
    const result: SimResult = { spawned: 0, dropped: 0, errors: [] };
    const before = this.dropped;
    const sink = this.makeSink(result, (g) => {
      // Java spawnTickParticle：命令执行期立即 .run() 一批；未完成 → 排队下一 tick 初
      this.runGeneratorNow(g, result);
    });
    switch (cmd.kind) {
      case 'normal':
        execNormal(cmd, sink);
        break;
      case 'conditional':
        execConditional(cmd, sink);
        break;
      case 'parameter':
        execParameter(cmd, sink);
        break;
      case 'vanilla':
        execVanilla(cmd, sink);
        break;
      case 'group':
        if (cmd.sub === 'remove') {
          execGroupRemove(cmd, sink, this);
        } else {
          execGroupChange(cmd, sink, this);
        }
        break;
      case 'clearparticle':
        this.clearAll();
        break;
    }
    result.dropped = this.dropped - before;
    return result;
  }

  private makeSink(result: SimResult, onQueue?: (g: TickGenerator) => void): SpawnSink {
    return {
      result,
      playerPos: this.config.playerPos,
      groups: this.groups,
      rand: this.rand,
      spawn: (req) => {
        this.trySpawnParticle(req, result);
      },
      addGenerator: (g) => {
        if (onQueue) onQueue(g);
      },
    };
  }

  // ---------- 生成 ----------

  /** 寿命解析（模组调用顺序：构造器默认 → setLifetime(age>0?age:-1?INT_MAX)；
   *  age=0 时不覆写 → 保持「构造器默认」。构造器默认 = 原版常量（「原版运动学」
   *  开启且类型有 nativeLifetimeFor 表项时，如 end_rod 60+nextInt(12)；关闭 = 预览
   *  近似 defaultLifetime），否则走预览默认寿命。 */
  private resolveLifetime(cmdAge: number, name: string): number {
    if (cmdAge > 0) return cmdAge;
    if (cmdAge === -1) return INT_MAX;
    // cmdAge == 0
    if (this.config.nativeKinematics) {
      const spec = nativeLifetimeFor(name, this.config.mcVersion);
      if (spec) return spec.min + this.vanillaRand.nextInt(spec.extra);
    }
    return this.config.defaultLifetime;
  }

  /** ParticleUtil.spawnParticle 主体（速度表达式解析失败 → errors + 不生成；
   *  null/空/"null" → 无 exe 不报错（ExpressionUtil.parse 返回 null）；
   *  池满 → dropped++。均不抛 —— Java try/catch 语义）。 */
  private trySpawnParticle(req: SpawnRequest, result: SimResult): void {
    let exe = req.exe ?? null;
    let exeStruct = req.exeStruct ?? null;
    const se = req.speedExpression;
    if (exe === null && se != null && se !== '' && se !== 'null') {
      try {
        exe = parse(se);
        exeStruct = new ParticleStruct(); // 每粒子全新实例（Java 每 ClassExpression 一个 struct）
      } catch (e) {
        result.errors.push((e as Error).message);
        return;
      }
    }
    if (this.count + this.pending.length >= this.config.maxParticles) {
      this.dropped++;
      return;
    }
    const p: SimParticle = {
      id: this.nextId++,
      name: req.name,
      x: req.x, y: req.y, z: req.z,
      vx: req.vx, vy: req.vy, vz: req.vz,
      stop: req.vx === 0 && req.vy === 0 && req.vz === 0,
      r: req.r, g: req.g, b: req.b, a: req.a,
      age: 0,
      lifetime: this.resolveLifetime(req.age, req.name),
      cx: req.cx, cy: req.cy, cz: req.cz,
      exe, speedStep: req.speedStep, moveT: 0,
      exeStruct,
      alive: true,
      vanilla: req.vanilla === true,
    };
    this.groups.add(req.group, p.id); // null/"null"/空 在 GroupIndex.add 内跳过
    this.pending.push(p);
    result.spawned++;
  }

  // ---------- 每 tick ----------

  /** 手动单步（headless 测试 / UI 单步）。 */
  tickOnce(): void {
    // ① tick 初：排队生成器各跑一批（TickEndTask 语义）
    if (this.generators.length > 0) {
      const queued = this.generators;
      this.generators = [];
      const sink = this.makeSink(this.tickResultSink());
      for (const g of queued) {
        let needMore: boolean;
        try {
          needMore = runGeneratorStep(g, sink);
        } catch (e) {
          // Java：运行期错误出栈 → onStartClientTick 剩余任务全丢（游戏内 = 崩溃）。
          // 预览不崩溃：记录错误、该生成器死亡（Java 抛错时也不满足尾部 re-queue）、
          // 本 tick 剩余排队生成器跳过（忠实「传播出队列」的可观察效果）。
          this.tickErrors.push((e as Error).message);
          return;
        }
        if (needMore) this.generators.push(g);
      }
    }
    // ② 新粒子入池（命令期/生成器期生成，本 tick 起参与动画）
    if (this.pending.length > 0) {
      for (const p of this.pending) this.pool.push(p);
      this.count = this.pool.length;
      this.pending = [];
    }
    for (let i = 0; i < this.count; i++) {
      this.animate(this.pool[i]);
    }
    // ③ 压实死亡 + 组内死 id 惰性保留（仅 group remove/clear 清理，见 GroupIndex）
    this.compact();
    this.tick++;
  }

  /** 立即执行生成器一批（命令执行期用）：未完成 → 排队下一 tick 初 */
  private runGeneratorNow(g: TickGenerator, result: SimResult): void {
    const sink = this.makeSink(result);
    let needMore: boolean;
    try {
      needMore = runGeneratorStep(g, sink);
    } catch (e) {
      // 命令执行期：错误传播给调用方（runCommand 不捕获生成器 run —— Java 里
      // 立即 run 在 context.client().execute 的 lambda 内，异常同样传播出 execute 队列）
      throw e;
    }
    if (needMore) this.generators.push(g);
  }

  private tickResultSink(): SimResult {
    return { spawned: 0, dropped: 0, errors: this.tickErrors };
  }

  /** §3.4：customTick（pre 记录 → 原生 tick → stop 回滚 → customMove）。
   *  原生 tick 内：age++/死亡判定 → 原版运动学（若开启且类型有表：
   *  重力先于位移、摩擦后于位移 —— Particle.tick 的 velocityY 更新与
   *  velocityMultiplier 顺序，见 sim/kinematics.ts）→ 位移。 */
  private animate(p: SimParticle): void {
    const preX = p.x;
    const preY = p.y;
    const preZ = p.z;
    // 原生 tick()：age++，达寿命死亡（后续全跳过 —— Java 里 ParticleEngine
    // 对已死粒子不再 tickParticle；customMove 在死粒子上的执行不可观察）
    p.age++;
    if (p.age >= p.lifetime) {
      this.kill(p.id);
      return;
    }
    if (!p.stop) {
      // 原版运动学（可选；关闭时 = 模组原生匀速直线，1:1 复刻）
      const spec = this.config.nativeKinematics
        ? nativeSpecFor(p.name, this.config.mcVersion)
        : null;
      if (spec) {
        p.vy += spec.gravityY; // 重力：位移**之前**（Particle.tick 顺序）
      }
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;
      if (spec) {
        p.vx *= spec.friction; // 摩擦：位移**之后**
        p.vy *= spec.friction;
        p.vz *= spec.friction;
      }
    }
    if (p.stop) {
      p.x = preX;
      p.y = preY;
      p.z = preZ;
    }
    this.customMove(p, preX, preY, preZ);
  }

  /** customMove（customMove && exe != null；预览里 customMove ≡ exe != null，
   *  两者始终同设）。逐行复刻 ParticleMixin.customMove。 */
  private customMove(p: SimParticle, preX: number, preY: number, preZ: number): void {
    const exe = p.exe;
    const struct = p.exeStruct;
    if (!exe || !struct) return;
    if (p.moveT === 0) {
      fillFirstMove(struct, p); // 首帧：中心/初始偏移（此时 pos 已含本 tick 原生位移）
    }
    fillPerTick(struct, p); // 哨兵 NaN + 当前值 + t = moveT（age 恒 0，复刻缺陷）
    p.moveT += p.speedStep; // Java：moveT += step 在 invoke 之前
    try {
      exe.run(struct);
    } catch (e) {
      // Java：catch → addChatMessage → remove()（粒子死亡，错误上浮给 UI）
      this.kill(p.id);
      this.tickErrors.push((e as Error).message);
      return;
    }
    if (struct.destroy !== 0) {
      this.kill(p.id);
      return;
    }
    // 任一速度分量被表达式设置（非 NaN）→ 回滚本 tick 原生位移，只走表达式速度
    if (struct.vx === struct.vx || struct.vy === struct.vy || struct.vz === struct.vz) {
      p.x = preX;
      p.y = preY;
      p.z = preZ;
      p.x += nanToZero(struct.vx);
      p.y += nanToZero(struct.vy);
      p.z += nanToZero(struct.vz);
    }
    // 颜色回写（表达式未改则 = 预填的当前色）
    p.r = struct.cr;
    p.g = struct.cg;
    p.b = struct.cb;
    p.a = struct.alpha;
  }

  // ---------- 死亡与清理 ----------

  /** remove()：仅 alive=false。**不**从组索引摘除（Java：组列表不随粒子自然
   *  死亡清理，只在 group remove/clearparticle 时清 —— 死 id 滞留是忠实的，
   *  且 group change 的 do-while 对死 id 的行为依赖它，见 execGroupChange）。 */
  kill(id: number): void {
    const p = this.get(id);
    if (p && p.alive) p.alive = false;
  }

  /** group remove 的 removeIf(!isAlive)：清组名下的死 id（= GroupEngineView.prune） */
  prune(name: string): void {
    this.groups.prune(name, (id) => {
      const p = this.get(id);
      return p !== undefined && p.alive;
    });
  }

  /** swap-remove 压实：死粒子移出前缀，count = 存活数 */
  private compact(): void {
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;
      if (w !== i) this.pool[w] = p;
      w++;
    }
    this.count = w;
  }

  /** clearparticle：全部粒子死亡 + 清组索引。
   *  **不清**排队生成器（Java：clearParticle 只动 GroupUtil + 引擎队列，
   *  TickParticleTask 的排队任务不受影响，会继续生成 —— 忠实复刻）。 */
  clearAll(): void {
    for (let i = 0; i < this.count; i++) this.pool[i].alive = false;
    for (const p of this.pending) p.alive = false;
    this.pending = [];
    this.groups.clear();
  }

  /** 运行期更新设置（M5 SettingsDrawer）：playerPos/默认寿命/粒子上限即时生效；
   *  seed 变化 → 重建 PRNG（等价于从同种子重新开始消费） */
  updateConfig(patch: Partial<SimConfig>): void {
    if (patch.playerPos) this.config.playerPos = { ...patch.playerPos };
    if (patch.defaultLifetime !== undefined) this.config.defaultLifetime = patch.defaultLifetime;
    if (patch.maxParticles !== undefined) this.config.maxParticles = patch.maxParticles;
    if (patch.seed !== undefined) {
      this.config.seed = patch.seed;
      this.rand = new SimRandom(patch.seed);
      this.vanillaRand = new SimRandom(patch.seed + 1);
    }
    // mcVersion 不参与引擎语义（贴图/类型表在渲染层与表单按它分区），只保持 config 一致
    if (patch.mcVersion !== undefined) this.config.mcVersion = patch.mcVersion;
    // nativeKinematics 开关：有证据的类型（end_rod）套用原版摩擦/重力/随机寿命
    if (patch.nativeKinematics !== undefined) this.config.nativeKinematics = patch.nativeKinematics;
  }

  /** reset：回放用（粒子/组/生成器/tick 计数/PRNG 全重置） */
  reset(): void {
    this.pool = [];
    this.count = 0;
    this.nextId = 1;
    this.pending = [];
    this.generators = [];
    this.groups.clear();
    this.tick = 0;
    this.dropped = 0;
    this.rand = new SimRandom(this.config.seed);
    this.vanillaRand = new SimRandom(this.config.seed + 1);
    this.tickErrors.length = 0;
  }
}

function nanToZero(n: number): number {
  return n === n ? n : 0;
}
