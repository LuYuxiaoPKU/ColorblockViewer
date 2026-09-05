// 引号感知分词（MC/brigadier 命令语义，对照 StringReader.readString /
// readUnquotedString 复刻）：
//  - 词在**未加引号的空白**处分裂；
//  - 以 `"` **开头**的词：引号剥除、内部 `""` → 字面 `"`（readString 语义），
//    词在闭引号处**结束**——闭引号后紧跟的非空白字符成为下一个词；
//  - 不以引号开头的词：读到空白为止，内部 `"` 是普通字符（readUnquotedString
//    语义，引号不特殊）；
//  - 未闭合引号 → 报错（含已读内容，供 UI 中文提示）。
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
    if (ch === '"') {
      // readString：引号内容，"" 转义，闭引号处结束
      i++;
      let closed = false;
      while (i < n) {
        if (line[i] === '"') {
          if (i + 1 < n && line[i + 1] === '"') {
            buf += '"';
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
        throw new CommandParseError(`unterminated quoted argument (missing closing "): ...${buf}`);
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
