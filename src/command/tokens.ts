// 引号感知分词（MC/brigadier 命令语义，对照 StringReader.readString /
// readUnquotedString 复刻）。Mod 目标 Minecraft 26.2 使用新版 brigadier：
// `"` **与 `'` 都是字符串定界符（isQuotedStringStart 两者都认）：
//  - 词在**未加引号的空白**处分裂；
//  - 以 `"` 或 `'` **开头**的词：对应引号剥除，内部同种 `""`/`''` → 字面
//    引号（readString 语义），词在闭引号处**结束**——闭引号后紧跟的
//    非空白字符成为下一个词；
//  - 不以引号开头的词：读到空白为止，内部引号是普通字符（readUnquotedString
//    语义，引号不特殊）；
//  - 未闭合引号 → 报错（含已读内容，供 UI 中文提示）。
// 旧版 brigadier（≤1.20 时代）只认 `"`，单引号是普通字符——那类旧版游戏里
// 单引号包表达式会被表达式引擎当作未知字符拒绝，故本实现跟随新版行为
// （用户报告：26.2 游戏内单引号命令可运行）。
// 命令参数（表达式）内部无字符串字面量的合法性由表达式引擎另行校验。

export class CommandParseError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'CommandParseError';
  }
}

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    let buf = '';
    if (ch === '"' || ch === "'") {
      // readString：引号内容（' 定界词内 '' 转义、" 定界词内 "" 转义），闭引号处结束
      const q = ch;
      i++;
      let closed = false;
      while (i < n) {
        if (line[i] === q) {
          if (i + 1 < n && line[i + 1] === q) {
            buf += q;
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        buf += line[i];
        i++;
      }
      if (!closed) {
        throw new CommandParseError(`unterminated quoted argument (missing closing ${q}): ...${buf}`);
      }
    } else {
      // readUnquotedString：读到空白，引号是普通字符
      while (i < n && line[i] !== ' ' && line[i] !== '\t') {
        buf += line[i];
        i++;
      }
    }
    out.push(buf);
  }
  return out;
}
