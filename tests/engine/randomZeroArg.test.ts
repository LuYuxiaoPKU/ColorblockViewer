// random() 0 参特判回归：CBV selectMathSig 曾漏 CodeGen.java:495 的
// args.length==0 → 首候选特判，random() 在 parse 期误报 function not found
// （游戏内可用、预览器不可用的引擎 bug，2026-10-15 nebula 模板落地时发现）。
//
// 语义注记：random() 值域 [0,1)，表达式**顶层**返回值走 int 收口（Java ireturn
// 同语义）→ 裸 random() 作为整条表达式恒 0；模板中一律用局部变量/struct 字段
// 承载（nebula 的 s1=6.2832*random() 形态）。
import { describe, it, expect } from 'vitest';
import { parse } from '../../src/engine';
import { ParticleStruct } from '../../src/engine/struct';

describe('0 参函数：random()（0 参特判回归）', () => {
  it('parse 期不再误报 function not found', () => {
    expect(() => parse('random()')).not.toThrow();
  });

  it('字段承载：cy=6.2832*random() 连续 run 取新值、值域正确', () => {
    const s = new ParticleStruct();
    const b = parse('cy=6.2832*random()');
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      b.run(s);
      expect(s.cy).toBeGreaterThanOrEqual(0);
      expect(s.cy).toBeLessThan(6.2832);
      seen.add(s.cy);
    }
    expect(seen.size).toBeGreaterThan(40); // 连续取新值（非缓存/非定值）
  });

  it('nebula 形态：dis=4*pow(random(),2) 落 [0,4)', () => {
    const s = new ParticleStruct();
    const b = parse('dis=4*pow(random(),2)');
    for (let i = 0; i < 20; i++) {
      b.run(s);
      expect(s.dis).toBeGreaterThanOrEqual(0);
      expect(s.dis).toBeLessThan(4);
    }
  });
});
