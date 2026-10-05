// 全 2^24 域 float 除模对拍：JDK 21 生成 fdiv_golden.txt（i + 7 列十六浮点字面量），
// 这里用 TS 复刻同一管道逐值比对。口径（kinematics.ts 寿命公式 + campfire 初速）：
//   c1 campfire 500.0f/F
//   c2 base  4.0f/fadd(fmul(0.9f,F),0.1f)
//   c3 squid 6.0f/fadd(fmul(0.8f,F),0.2f)
//   c4 falling_dust 32.0d/(F*0.8d+0.2d)（double 域）
//   c5 falling_dust 外层 f32(f32((int)c4)*0.9f)
//   c6 geyser 64.0f/fadd(fmul(0.8f,F),0.1f)
//   c7 8.0f/fadd(fmul(0.5f,F),0.5f) ×1.5f
// Java float 算术不提升到 double（JVM 规范），0.9f*F 即 float 乘法 → TS 用
// Math.fround(Math.fround(0.9) * F)。
// JDK %a 字面量（0x1.f4p32）：JS Number() 不认（StringToNumber 只接受 hex 整数）。
// 手动解析：0x1.{frac}p{e} → h = 0x1{frac}（≤53 bit 精确整数），值 = h·2^(e-4·len)。
// h·2^k 是纯指数移位，无舍入 → 与 JDK 输出值逐位一致。
// 文件约 920MB（16.7M 行）→ 流式 readline 逐行处理。
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const f = Math.fround;
const LIT = /^0x1\.([0-9a-f]+)p([+-]?\d+)$/;
function hexFloat(s) {
  const m = LIT.exec(s);
  if (!m) return NaN;
  const h = parseInt('1' + m[1], 16); // ≤ 53 bit
  return h * Math.pow(2, parseInt(m[2], 10) - 4 * m[1].length);
}

// 自检：解析必须等于独立算出的精确值
const expectParse = (lit, expected) => {
  const v = hexFloat(lit);
  if (!Object.is(v, expected)) {
    console.error('SELFTFAIL', lit, v, expected);
    process.exit(2);
  }
};
expectParse('0x1.f4p32', 500 * 2 ** 24); // 500.0f/(1/2^24) 精确可表示
expectParse('0x1.ccccccp4', 30198988 * 2 ** -20); // 0x1cccccc₂₀，精确
expectParse('0x1.8p4', 24); // 1.5·16
expectParse('0x1.000002p2', 16777218 * 2 ** -22); // 精确
console.log('self-test ok');

const file = process.argv[2];
const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }) });
let bad = 0;
let first = null;
let count = 0;
for await (const line of rl) {
  if (!line) continue;
  const parts = line.trim().split(' ');
  const i = parseInt(parts[0], 10);
  const F = i / 16777216;
  const ts = [
    f(500 / F),
    f(4 / f(f(f(0.9) * F) + f(0.1))),
    f(6 / f(f(f(0.8) * F) + f(0.2))),
    32 / (F * 0.8 + 0.2),
    f(f(Math.trunc(32 / (F * 0.8 + 0.2)) * f(0.9))),
    f(64 / f(f(f(0.8) * F) + f(0.1))),
    f(f(f(8 / f(f(f(0.5) * F) + f(0.5)))) * f(1.5)),
  ];
  for (let k = 0; k < 7; k++) {
    const jv = hexFloat(parts[1 + k]);
    const tv = ts[k];
    if (Object.is(jv, tv)) continue;
    bad++;
    if (!first) first = { i, k, jv, tv, lit: parts[1 + k] };
  }
  count++;
}
console.log('lines:', count, 'mismatches:', bad);
if (first) console.log('first:', first);
