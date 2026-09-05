// ExprField 辅助逻辑测试（DOM 组件行为需浏览器环境，这里测纯函数：
// 中文提示映射 + token 高亮切分；防抖校验逻辑依赖 parse，用引擎直测等价覆盖）。

import { describe, it, expect } from 'vitest';
import { exprCnHint, highlightExpr } from '../../src/ui/ExprField';

describe('exprCnHint 中文映射', () => {
  it.each([
    ['java.lang.RuntimeException: undefine var: a', '未定义变量'],
    ['java.lang.RuntimeException: function not found: foo', '未知函数'],
    ['java.lang.RuntimeException: bad matrix', '矩阵格式错误'],
    ['java.lang.RuntimeException: / by zero', '整数除以 0'],
    ['java.lang.RuntimeException: bad type: 0', '类型不匹配'],
    [
      'java.lang.VerifyError: Bad type on operand stack in daload',
      '矩阵解构到局部变量',
    ],
    ['java.lang.IllegalAccessError: Update to non-static final field com.noone.particleex.util.ParticleStruct.PI', '不能给常量 PI/E 赋值'],
    [
      'java.lang.RuntimeException: need matrix, function call, assign expression, var, number',
      '表达式语法错误',
    ],
  ])('%s', (msg, expected) => {
    expect(exprCnHint(msg)).toContain(expected);
  });

  it('未命中 → 空串', () => {
    expect(exprCnHint('some unknown message')).toBe('');
  });
});

describe('highlightExpr token 切分', () => {
  it('字段/函数/数字/运算符分类', () => {
    const out = highlightExpr('x=4*cos(t*0.2)+1');
    const byCls = (cls: string) => out.filter((t) => t.cls === cls).map((t) => t.text);
    expect(byCls('tok-field')).toEqual(['x', 't']);
    expect(byCls('tok-func')).toEqual(['cos']);
    expect(byCls('tok-num')).toEqual(['4', '0.2', '1']);
    expect(byCls('tok-op')).toEqual(['=', '*', '*', '+']);
    // 还原全文
    expect(out.map((t) => t.text).join('')).toBe('x=4*cos(t*0.2)+1');
  });

  it('负数与小数（负号属数字 token）', () => {
    const out = highlightExpr('-1.5e-3');
    expect(out).toContainEqual({ text: '-1.5e-3', cls: 'tok-num' });
  });

  it('PI/E 常量按普通文本（非字段，struct 里是常量但高亮不特别处理）', () => {
    const out = highlightExpr('PI*2');
    expect(out.map((t) => t.text).join('')).toBe('PI*2');
  });

  it('空串', () => {
    expect(highlightExpr('')).toEqual([]);
  });
});
