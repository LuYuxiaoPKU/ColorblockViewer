import { ExprError } from './types';

// ParticleStruct 的 1:1 复刻：25 个 double 字段 + 2 个常量（PI/E）。
// 字段名永远是「全局」作用域，查找时优先于局部变量，不能被局部变量覆盖。
export const PI = 3.141592653589793;
export const E = 2.718281828459045;

export const FIELD_NAMES: readonly string[] = [
  'x', 'y', 'z', 's1', 's2', 'dis', 't',
  'cr', 'cg', 'cb', 'alpha',
  'vx', 'vy', 'vz',
  'cx', 'cy', 'cz',
  'dx', 'dy', 'dz',
  'ds1', 'ds2', 'ddis',
  'age', 'destroy',
] as const;

export type FieldName = (typeof FIELD_NAMES)[number];

const FIELD_SET = new Set<string>(FIELD_NAMES);
export function isField(name: string): boolean {
  return FIELD_SET.has(name);
}

export class ParticleStruct {
  PI = PI;
  E = E;
  x = 0; y = 0; z = 0;
  s1 = 0; s2 = 0; dis = 0;
  t = 0;
  cr = 1.0; cg = 1.0; cb = 1.0; alpha = 1.0;
  vx = 0; vy = 0; vz = 0;
  cx = 0; cy = 0; cz = 0;
  dx = 0; dy = 0; dz = 0;
  ds1 = 0; ds2 = 0; ddis = 0;
  age = 0;
  destroy = 0;

  /** 字段读（double） */
  get(name: string): number {
    if (name === 'PI') return PI;
    if (name === 'E') return E;
    return (this as unknown as Record<string, number>)[name];
  }

  /** 字段写（永远 double；int 值由调用方截断后写入） */
  set(name: string, v: number): void {
    if (name === 'PI' || name === 'E') throw new ExprError('bad type: 0');
    (this as unknown as Record<string, number>)[name] = v;
  }
}
