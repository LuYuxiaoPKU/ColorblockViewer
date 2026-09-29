// 双后端对拍：codegen 后端（codegenBlock）vs 闭包后端（compileBlock）。
// 同一 AST 两端各自执行：每例连续 5 tick 的返回 int 序列逐位相等、
// 每 tick struct 25 字段终值序列深度相等、错误消息逐字一致（多 tick 轨迹
// 防槽位布局/局部残留类 bug——单 tick 对拍可能掩盖）。
// 随机语料（lcg 种子、深度≤2、排除 random——全局随机序列
// 无法跨后端对齐）+ 手工边角（int 回绕/除零/NaN 比较/矩阵/解构/短路/undefine
// var/嵌套赋值/重载/溢出）。
// 语义锁：codegen 上线后 1029 golden 不变 + 本对拍全过 = 数值/错误序列不变。

import { describe, it, expect } from 'vitest';
import { Lexer } from '../../src/engine/lexer';
import { Parser } from '../../src/engine/parser';
import { compileBlock } from '../../src/engine/compiler';
import { codegenBlock } from '../../src/engine/codegen';
import { verifyBlock } from '../../src/engine/index';
import { Node } from '../../src/engine/ast';
import { ParticleStruct, FIELD_NAMES } from '../../src/engine/struct';

type R = { ok: boolean; vals: number[]; snaps: string[]; msg: string };

// 非平凡初值（避免 0 掩盖转换 bug）
function makeStruct(): ParticleStruct {
  const s = new ParticleStruct();
  const vals: [string, number][] = [
    ['x', 1.5], ['y', -2.25], ['z', 3.75], ['s1', 0.125], ['s2', 2.0],
    ['dis', 4.5], ['t', 10.0], ['cr', 0.1], ['cg', 0.2], ['cb', 0.3],
    ['alpha', 0.9], ['vx', 1.1], ['vy', -2.2], ['vz', 3.3],
    ['cx', 0.5], ['cy', -0.5], ['cz', 1.5], ['dx', 2.5], ['dy', 3.5],
    ['dz', -4.5], ['ds1', 0.25], ['ds2', 0.75], ['ddis', 5.5],
    ['age', 7.0], ['destroy', 0.0],
  ];
  for (const [k, v] of vals) (s as unknown as Record<string, number>)[k] = v;
  return s;
}

function fmt(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'Inf';
  if (v === -Infinity) return '-Inf';
  if (Object.is(v, -0)) return '-0';
  return String(v);
}

function snap(s: ParticleStruct): string {
  const out: string[] = [];
  for (const f of FIELD_NAMES) out.push(f + '=' + fmt((s as unknown as Record<string, number>)[f]));
  return out.join('|');
}

// 同一 struct 上连续 5 tick 轨迹（t/age 每 tick 推进，模拟 M3 动画调用模式；
// 抛错即止，序列长度 = 已跑 tick 数，两端可比）
const TICKS = 5;

function one(run: ((s: ParticleStruct) => number) | null): R {
  const r: R = { ok: false, vals: [], snaps: [], msg: '' };
  if (!run) { r.msg = '__CODEGEN_NULL__'; return r; }
  const s = makeStruct();
  for (let k = 0; k < TICKS; k++) {
    try {
      s.t += 0.25;
      s.age += 1;
      r.vals.push(run(s));
      r.snaps.push(snap(s));
    } catch (e) {
      r.msg = (e as Error).message;
      return r;
    }
  }
  r.ok = true;
  return r;
}

// 后端构造 + 执行（镜像 parse 层语义：编译期同步错误 → run 时抛出）
function oneFromMake(make: () => ((s: ParticleStruct) => number) | null): R {
  let run: ((s: ParticleStruct) => number) | null;
  try {
    run = make();
  } catch (e) {
    return { ok: false, vals: [], snaps: [], msg: (e as Error).message };
  }
  return one(run);
}

// 两端执行（verifyBlock 先于后端，parse 层错误两端天然一致，单独记录）
function evalBoth(src: string): { parseErr?: string; a: R; b: R } {
  let block: Node[];
  try {
    block = new Parser(new Lexer(src)).parseBlock();
    verifyBlock(block);
  } catch (e) {
    const empty: R = { ok: false, vals: [], snaps: [], msg: '' };
    return { parseErr: (e as Error).message, a: empty, b: empty };
  }
  return {
    a: oneFromMake(() => codegenBlock(block)),
    b: oneFromMake(() => compileBlock(block)),
  };
}

function expectParity(src: string): void {
  const { parseErr, a, b } = evalBoth(src);
  if (parseErr !== undefined) return; // parse 层错误与后端无关
  if (a.ok !== b.ok) {
    throw new Error(`后端不一致（src=${src}）：codegen=${JSON.stringify(a)} closure=${JSON.stringify(b)}`);
  }
  if (a.ok && b.ok) {
    if (a.vals.join(',') !== b.vals.join(',')) {
      throw new Error(`返回序列不一致（src=${src}）：codegen=${a.vals} closure=${b.vals}`);
    }
    if (a.snaps.join(';') !== b.snaps.join(';')) {
      throw new Error(`struct 终值序列不一致（src=${src}）：\ncodegen=${a.snaps}\nclosure=${b.snaps}`);
    }
  } else if (!a.ok && !b.ok && a.msg !== b.msg) {
    throw new Error(`错误消息不一致（src=${src}）：codegen=${a.msg} closure=${b.msg}`);
  }
}

// ---- 随机语料 ----

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const OPS = ['+', '-', '*', '/', '%', '^', '<', '<=', '>', '>=', '==', '!=', '&', '|'];
const FIELDS = ['x', 'y', 'z', 't', 'age', 'dis', 's1', 'cr', 'vx'];
const FNS1 = ['abs', 'sin', 'cos', 'floor', 'round', 'sqrt', 'exp', 'log'];
const FNS2 = ['max', 'min', 'pow'];

function genLeaf(rng: () => number): string {
  const r = rng();
  if (r < 0.5) {
    return rng() < 0.5
      ? String(1 + Math.floor(rng() * 10)) // int 1..10
      : (0.1 + rng() * 9.9).toFixed(3); // double 0.1..10
  }
  if (r < 0.85) return FIELDS[Math.floor(rng() * FIELDS.length)];
  return 'PI';
}

function genExpr(rng: () => number, depth: number): string {
  if (depth <= 0) return genLeaf(rng);
  if (rng() < 0.7) {
    const op = OPS[Math.floor(rng() * OPS.length)];
    return '(' + genExpr(rng, depth - 1) + ' ' + op + ' ' + genExpr(rng, depth - 1) + ')';
  }
  if (rng() < 0.75) {
    const f = FNS1[Math.floor(rng() * FNS1.length)];
    return f + '(' + genExpr(rng, depth - 1) + ')';
  }
  const f = FNS2[Math.floor(rng() * FNS2.length)];
  return f + '(' + genExpr(rng, depth - 1) + ',' + genExpr(rng, depth - 1) + ')';
}

const RANDOM_CASES: string[] = (() => {
  const rng = lcg(42);
  const out: string[] = [];
  for (let i = 0; i < 200; i++) {
    if (rng() < 0.3) {
      // 单变量赋值 + 引用（a 首次 store 定型，之后可读写）
      out.push('a=' + genExpr(rng, 2) + ';a+' + genExpr(rng, 1));
    } else {
      out.push(genExpr(rng, 2));
    }
  }
  return out;
})();

// ---- 手工边角 ----

const EDGE_CASES: string[] = [
  '2147483647+1', // int 回绕
  '1/0', // int 除零
  '1.0/0.0', // double 除零 → Inf → d2i
  '0.0/0.0==0.0/0.0', // NaN==NaN → 0
  '0.0/0.0<1', // NaN 有序比较 → 0
  '2^31', // int^int → double → d2i 回绕
  '(1,2;3,4)*(5,6;7,8)', // 矩阵乘
  '(1,2)+3', // 矩阵+标量
  '(1,2;3,4)^2', // 矩阵幂
  '(1,2;3,4)*(1,2)', // 矩阵乘形状不符 → AIOOBE
  '(x,y)=(1,2);x+y', // namemat 字段解构
  '0&(1/0)', // AND 短路（r 不求值 → 0）
  '1&(1/0)', // AND 非短路 → int 除零
  'x+q', // undefine var: q
  'a=1;a==2', // 定型 int
  'a=7.0;a+1', // 定型 double
  'a=(b=3);a+b', // 嵌套赋值
  'PI+1',
  'E+1',
  'abs(-5)', // int 重载
  'abs(-5.0)', // double 重载
  'max(1,2)+min(3.5,1.5)',
  'floor(1.5)+round(2.5)',
  '!(x==x)', // NOT int
  '!0', // NOT int 字面量
  '-(1,2;3,4)', // 矩阵取负
  'a=1;a;5', // 多语句末条
  'a=2.5;a|0', // OR，asInt(2.5)=2 → 1
  '(1;2)*(3,4,5)', // 矩阵乘 AIOOBE
  'sqrt(-1)', // NaN 传播
  'a=1;b=a+1.5;a+b', // 混合定型
  '10&1',
  '0|1',
  'x==y',
  '1%0', // int mod 零
  '2.5%0.0', // double mod 零 → NaN
  'a=1;a^0.5', // int^double → double 域
  'getExponent(0.0)', // int 返回
  'incrementExact(2147483647)', // overflow
  'a=1;a=2;a', // 重赋值
  'a=3.5;a/2', // double 域除法
  '(1,2)-(3,4)', // 矩阵减
  '(1,2)*2', // 矩阵×标量
  '(1,2)/2', // 矩阵÷标量
  '(1,2)%2', // 矩阵 mod 标量
  '(1,2;3,4)+(5,6;7,8)', // 矩阵加
  '(1,2;3,4)-(5,6;7,8)',
  'a=1;a<2', // 定型 int 比较
  'a=1.5;a>=1.0', // 定型 double 比较
  'a=-1;abs(a)', // 变量取反后函数
  'x&0', // 字段 AND
  'destroy|destroy', // OR 同字段
  'a=1;a+(b=2)+c', // 嵌套 + 未定型（c undefine）
];

describe('codegen 双后端对拍', () => {
  it('随机语料 200 例两端一致', () => {
    let checked = 0;
    for (const src of RANDOM_CASES) {
      expectParity(src);
      checked++;
    }
    expect(checked).toBe(200);
  });

  it('手工边角全部两端一致', () => {
    for (const src of EDGE_CASES) expectParity(src);
  });

  it('codegen 主路径可用（Node 环境非 null）', () => {
    const block = new Parser(new Lexer('a=1;a*2')).parseBlock();
    const run = codegenBlock(block);
    expect(run).not.toBeNull();
  });
});
