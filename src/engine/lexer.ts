// 词法分析：1:1 复刻 Java Lexer（token 种类、错误消息、snapshot/recovery、行号）。
// 注意：NUMBER 扫描只吃 数字 与 '.'（至多一个）；其余字符进入标识符分支。
import { ExprError } from './types';

export interface Token {
  line: number;
  type: string; // EnumToken 名字
  text: string; // 原始文本（NUMBER/IDENTIFIER 用）
}

export class Lexer {
  private src: string;
  private ptr = 0;
  private line = 1;
  private nextTok: Token | null = null;
  private snaps: { ptr: number; line: number; next: Token | null }[] = [];

  constructor(source: string) {
    this.src = source;
  }

  /** 下一个 token；与 Java 一致，行号回放到 token 起点行 */
  nextToken(expected?: string): Token {
    let t: Token;
    if (this.nextTok !== null) {
      t = this.nextTok;
      this.line = this.nextTok.line;
      this.nextTok = null;
    } else {
      this.skipWS();
      if (this.ptr >= this.src.length) {
        t = this.mk('EOF', 'EOF');
      } else {
        t = this.scanOne();
      }
    }
    if (expected !== undefined && t.type !== expected) {
      throw new ExprError('unmatch token: ' + (t.type === 'EOF' ? 'null' : t.text));
    }
    return t;
  }

  peekToken(): Token {
    if (this.nextTok === null) {
      const curLine = this.line;
      this.nextTok = this.nextRaw();
      this.line = curLine;
    }
    return this.nextTok;
  }

  snapshot(): void {
    this.snaps.push({ ptr: this.ptr, line: this.line, next: this.nextTok });
  }

  recovery(): void {
    const s = this.snaps.pop()!;
    this.ptr = s.ptr;
    this.line = s.line;
    this.nextTok = s.next;
  }

  popSnapshot(): void {
    this.snaps.pop();
  }

  // ---- 内部 ----

  private mk(type: string, text: string): Token {
    return { line: this.line, type, text };
  }

  /** 不带 expected 校验的取 token（供 peek 用） */
  private nextRaw(): Token {
    if (this.nextTok !== null) {
      const t = this.nextTok;
      this.line = this.nextTok.line;
      this.nextTok = null;
      return t;
    }
    this.skipWS();
    if (this.ptr >= this.src.length) return this.mk('EOF', 'EOF');
    return this.scanOne();
  }

  private scanOne(): Token {
    const ch = this.peek();
    switch (ch) {
      case '!':
        if (this.test('!=')) { this.skip(2); return this.mk('NEQ', '!='); }
        this.skip(1); return this.mk('NOT', '!');
      case '%': this.skip(1); return this.mk('MOD', '%');
      case '&': this.skip(1); return this.mk('AND', '&');
      case '(': this.skip(1); return this.mk('LPAREN', '(');
      case ')': this.skip(1); return this.mk('RPAREN', ')');
      case '*': this.skip(1); return this.mk('MUL', '*');
      case '+': this.skip(1); return this.mk('ADD', '+');
      case ',':
        if (this.test(',,')) { this.skip(2); return this.mk('DCOMMA', ',,'); }
        this.skip(1); return this.mk('COMMA', ',');
      case '-': this.skip(1); return this.mk('MINUS', '-');
      case '/': this.skip(1); return this.mk('DIV', '/');
      case ';': this.skip(1); return this.mk('SEMI', ';');
      case '<':
        if (this.test('<=')) { this.skip(2); return this.mk('LE', '<='); }
        this.skip(1); return this.mk('LT', '<');
      case '=':
        if (this.test('==')) { this.skip(2); return this.mk('EQ', '=='); }
        this.skip(1); return this.mk('ASSIGN', '=');
      case '>':
        if (this.test('>=')) { this.skip(2); return this.mk('GE', '>='); }
        this.skip(1); return this.mk('GT', '>');
      case '^': this.skip(1); return this.mk('POW', '^');
      case '|': this.skip(1); return this.mk('OR', '|');
      default:
        if (ch === '.' || isDigit(ch)) return this.numberToken();
        if (ch === '_' || isLetter(ch)) return this.identifierToken();
        throw new ExprError('unknow char: ' + ch);
    }
  }

  /** 数字扫描：数字与至多一个 '.'；空则 not a number */
  private numberToken(): Token {
    let text = '';
    let hasDot = false;
    for (let i = this.ptr; i < this.src.length; i++) {
      const c = this.src[i];
      if (c === '.') {
        if (hasDot) break;
        hasDot = true;
        text += c;
      } else if (isDigit(c)) {
        text += c;
      } else {
        break;
      }
    }
    if (text === '') throw new ExprError('not a number');
    this.skip(text.length);
    return this.mk('NUMBER', text);
  }

  private identifierToken(): Token {
    let text = '';
    for (let i = this.ptr; i < this.src.length; i++) {
      const c = this.src[i];
      if (c === '_' || isLetter(c) || isDigit(c)) text += c;
      else break;
    }
    if (text === '') throw new ExprError('not a identifier');
    this.skip(text.length);
    return this.mk('IDENTIFIER', text);
  }

  private peek(): string {
    return this.src[this.ptr];
  }

  private skip(n: number): void {
    this.ptr += n;
  }

  private test(s: string): boolean {
    if (this.ptr + s.length > this.src.length) return false;
    for (let i = 0; i < s.length; i++) {
      if (this.src[this.ptr + i] !== s[i]) return false;
    }
    return true;
  }

  private skipWS(): void {
    for (;;) {
      if (this.ptr >= this.src.length) return;
      if (this.test('\r\n') || this.test('\n\r')) {
        this.skip(2);
        this.line++;
        continue;
      }
      const c = this.src[this.ptr];
      if (c === '\n' || c === '\r') {
        this.skip(1);
        this.line++;
        continue;
      }
      if (c === '\t' || c === '\n' || c === '\f' || c === '\r' || c === ' ') {
        this.skip(1);
        continue;
      }
      return;
    }
  }
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isLetter(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}
