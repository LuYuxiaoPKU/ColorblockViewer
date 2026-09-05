// 组索引（1:1 复刻 GroupUtil）。Map<组名, Set<粒子id>>。
//  - add：组名按 `|` 拆分（Java group.split("\\|")），逐组加入；null/"null" 不加。
//  - get：`|` 拆分后合并各组粒子（**含已死粒子**，Java 侧 isAlive 过滤在调用方）。
//  - clear：清空全部（clearparticle）。
//  - 死 id 的清理是**惰性**的（remove 的 removeIf / 遍历时 isAlive 过滤），
//    与 Java「removeIf 只在 group remove 时跑、平时死粒子滞留列表」一致。

export class GroupIndex {
  private map = new Map<string, Set<number>>();

  /** 组名按 | 拆分加入（null/"null"/空 = 不加） */
  add(group: string | null, id: number): void {
    if (group == null || group === 'null' || group === '') return;
    for (const str of group.split('|')) {
      let set = this.map.get(str);
      if (!set) {
        set = new Set();
        this.map.set(str, set);
      }
      set.add(id);
    }
  }

  /** `|` 拆分后合并各组粒子 id（含已死，调用方按 alive 过滤） */
  get(group: string | null): number[] {
    const out: number[] = [];
    if (group == null || group === 'null' || group === '') return out;
    for (const str of group.split('|')) {
      const set = this.map.get(str);
      if (set) out.push(...set);
    }
    return out;
  }

  /** 单组名（拆分后的一段）的成员 id，无该组 → 空数组 */
  membersOf(name: string): number[] {
    const set = this.map.get(name);
    return set ? [...set] : [];
  }

  /** 从所有组摘除一个粒子（clearparticle 时按组 clear 处理，此接口备用） */
  remove(id: number): void {
    for (const set of this.map.values()) set.delete(id);
  }

  /** group remove 的 removeIf(!isAlive)：按谓词清组内死 id */
  prune(name: string, isAlive: (id: number) => boolean): void {
    const set = this.map.get(name);
    if (!set) return;
    for (const id of [...set]) if (!isAlive(id)) set.delete(id);
  }

  /** clearparticle：清掉全部组 */
  clear(): void {
    this.map.clear();
  }

  /** 当前组数（调试/测试用） */
  groupCount(): number {
    return this.map.size;
  }
}
