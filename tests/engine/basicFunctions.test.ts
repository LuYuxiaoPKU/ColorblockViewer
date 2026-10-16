// 基础函数专题(2026-10-15):JDK Math 浮点边界对拍 + 负零修复回归。
// Java 侧边界值用 JDK 21 直接实测(EdgeProbe),本文件逐条锁定引擎与 JDK 一致。
// 修复记录:numLit 曾用 String(v) 序列化字面量,String(-0)==='0' 把负零吞成
// +0(Java dneg 保留 -0)——已改为 -0 走常量池 cNum。

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/engine';
import { ParticleStruct } from '../../src/engine/struct';

/** 探针:字段承载读数(绕开表达式顶层 int 收口——裸表达式的 double 结果
 *  会被 (int) 收成整数,读数必须走 struct 字段) */
function probe(src: string, field = 'cy'): number {
  const s = new ParticleStruct();
  parse(src).run(s);
  return (s as unknown as Record<string, number>)[field];
}

describe('基础函数专题:sin/cos/exp/log/sqrt 边界(JDK 21 实测对拍)', () => {
  it('NaN/±Inf 传播:与 Math.sin/cos/exp/log/sqrt 逐点一致', () => {
    expect(probe('cy=sin(0/0.0)')).toBeNaN();
    expect(probe('cy=cos(0/0.0)')).toBeNaN();
    expect(probe('cy=sin(1/0.0)')).toBeNaN(); // sin(Inf)=NaN
    expect(probe('cy=cos(0-1/0.0)')).toBeNaN();
    expect(probe('cy=exp(0/0.0)')).toBeNaN();
    expect(probe('cy=exp(1/0.0)')).toBe(Infinity);
    expect(probe('cy=exp(0-1/0.0)')).toBe(0);
    expect(probe('cy=log(0)')).toBe(-Infinity);
    expect(probe('cy=log(0-0.0)')).toBe(-Infinity); // log(-0)=-Inf
    expect(probe('cy=log(0-1.0)')).toBeNaN();
    expect(probe('cy=sqrt(0-1.0)')).toBeNaN();
    expect(probe('cy=tan(1/0.0)')).toBeNaN();
  });
});

describe('基础函数专题:pow 边界(ANSI/IEEE 特例,JDK 对拍)', () => {
  it('特例逐条', () => {
    expect(probe('cy=pow(0,0)')).toBe(1);          // Java pow(0,0)=1
    expect(probe('cy=pow(0/0.0,0)')).toBe(1);      // pow(NaN,0)=1(IEEE 特例)
    expect(probe('cy=pow(1,0/0.0)')).toBeNaN();    // pow(1,NaN)=NaN
    expect(probe('cy=pow(0,0-1)')).toBe(Infinity);
    expect(probe('cy=pow(1/0.0,0-1)')).toBe(0);
    expect(probe('cy=pow(0-2,3)')).toBe(-8);       // 负底整指数
    expect(probe('cy=pow(0-2,0.5)')).toBeNaN();    // 负底非整指数
  });

  it('负底整指数经 ^ 运算符(域 (II)D)', () => {
    expect(probe('cy=(0-2)^3')).toBe(-8);
    expect(probe('cy=(0-2)^2')).toBe(4);
  });
});

describe('基础函数专题:floor/ceil/abs/signum 边界(JDK 对拍)', () => {
  it('逐条', () => {
    expect(probe('cy=floor(0/0.0)')).toBeNaN();
    expect(probe('cy=floor(1/0.0)')).toBe(Infinity);
    expect(probe('cy=floor(0-0.5)')).toBe(-1);
    expect(probe('cy=ceil(0/0.0)')).toBeNaN();
    expect(probe('cy=abs(0-0.0)')).toBe(0);
    expect(probe('cy=signum(0/0.0)')).toBeNaN();
    expect(probe('cy=signum(1.5)')).toBe(1);
    expect(probe('cy=signum(0-1.5)')).toBe(-1);
  });

  it('signum(-0)=-0、ceil(-0.5)=-0(JDK 保留负零)', () => {
    // 注意:-0 只能经一元负号字面量 -0.0 产生;'0-0.0' 二元减是 +0(Java 同)
    expect(Object.is(probe('cy=signum(-0.0)'), -0)).toBe(true);
    expect(Object.is(probe('cy=ceil(0-0.5)'), -0)).toBe(true);
    expect(Object.is(probe('cy=signum(0-0.0)'), -0)).toBe(false); // 0-0.0=+0 → signum=+0
  });
});

describe('基础函数专题:负零字面量可达性(numLit 修复回归)', () => {
  it('源码 -0.0 经一元 NEG 折叠后保留 -0', () => {
    expect(Object.is(probe('cy=-0.0'), -0)).toBe(true);
    expect(Object.is(probe('cy=sin(-0.0)'), -0)).toBe(true); // JDK sin(-0)=-0
  });

  it('常量折叠产出的 -0 不被字符串化吞掉', () => {
    expect(Object.is(probe('cy=0.0*(0-1)'), -0)).toBe(true);
    expect(Object.is(probe('cy=pow(-0.0,3)'), -0)).toBe(true); // JDK pow(-0,3)=-0
  });

  it('+0 不受影响', () => {
    expect(probe('cy=0.0')).toBe(0);
    expect(Object.is(probe('cy=0.0'), -0)).toBe(false);
    expect(Object.is(probe('cy=0.0+0.0'), -0)).toBe(false);
  });
});

describe('基础函数专题:域提升(int 实参进 double 形参)', () => {
  it('int 字面量/表达式进单参 D 函数(i2d 精确提升)', () => {
    expect(probe('cy=sqrt(4)')).toBe(2);
    expect(probe('cy=sin(0)')).toBe(0);
    expect(probe('cy=log(100)')).toBeCloseTo(Math.log(100), 12);
    expect(probe('cy=sqrt(2+2)')).toBe(2);
  });

  it('int 除法先于 double 函数(Java 类型规则,非 bug)', () => {
    // log(100/10):100/10 是 int 除法 = 3?不,=10 → log(10)
    expect(probe('cy=log(100/10)')).toBeCloseTo(Math.log(10), 12);
  });
});
