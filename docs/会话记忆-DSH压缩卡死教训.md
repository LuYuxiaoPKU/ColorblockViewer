# 会话记忆：DSH 会话「卡到无法 compact」的教训（2026-07-19 整理）

> 来源：对 `C:\00_Data\RGM\` 下四个 DSH 会话日志（zstd 多帧流，`.tmp/` 下
> `multiframe.mjs` / `flatten.mjs` / `bigframes.mjs` 可复现）的逐帧量化分析 +
> DSH 压缩器源码取证（`@deepseek-ai/dsh-compaction-basic`）。
>
> 状态：Hindsight 记忆库当前不可写（`apiToken` 未配置，
> `C:\Users\Yuxiao Lu\.hindsight\coding-agent.json` 不存在，所有 hindsight 工具 401）。
> 配好 token 后应把本文 ingest 进 hindsight（标题建议「Correction/新增：DSH compact 失败根因」）。

## 一、四种结局的实测判定（signature）

| 会话 | 日志 | 压缩事件 | 判定 |
|---|---|---|---|
| ColorBlockViewer 接管前 | 8 MB zstd / 31353 帧 / 15.7 MB raw | **54 次 `compaction/end` 失败**，全部 `error:"summarization truncated at the token cap (incomplete checkpoint)"`（另 1 次 `Request aborted`） | **卡在 compact**：反复压缩、反复失败，上下文从未真正缩小 |
| RepeatG-KI | 7 MB / 25637 帧 | 3 次成功，最后一次在 25635–25637（会话最末尾） | 正常但工作量大：25k 帧只 compact 3 次，结束于工作中 |
| Ballad2MIDI | 1.7 MB / 4961 帧 | **0 次**；末尾是 5638 B 不可解析的截断帧，**无 session/end-seed** | **死会话**（进程被杀/中断），不是 compact 失败 |
| NBS2schematic | 618 KB | 无异常 | 干净结束；首 turn 5 个 ~100–114 KB tool/result |

**判定口诀**：死会话 = 尾部截断帧 + 无 end-seed + 0 压缩事件；卡 compact =
大量 `compaction/end` 且 error 全是 token-cap。

## 二、根因（三层，缺一不可地共同作用）

1. **近景巨型 tool result 不可 prune。** 压缩器（`selectCompactableRange`）是
   head-anchored、只保留末尾 16% 原文；它能裁掉的是**旧**历史。但上下文大头是
   **最近**的巨块——整文件读（`技术路线.md`、`kinematics.ts`）、javap 转储
   （50–300 KB/条）、全量测试输出、大 diff。这些全落在 retain 区里，prune
   够不着。实测 CBV：139 帧 >20 KB = **42% 的 raw 字节数**；RepeatG-KI 39%。
2. **摘要本身撞上输出上限 → 整次压缩零产出。** 摘要器 `maxTokens` 默认
   **8192**。当待摘要区巨大时，摘要写到一半被截断，`finishError` 把它映射成
   硬错误 `summarization truncated at the token cap (incomplete checkpoint)`
   （code `MAX_TOKENS`）→ **本次压缩不产 checkpoint**。上下文仍在阈值（0.8
   比例）之上 → 下一轮又触发 → CBV 里循环了 54 次（晚期 4 次重试间隔 2–19
   分钟全部失败）。注意：context-overflow 触发路径会先跑一次
   `toolResultPruner.pruneSession`（retainTokens=0），但只要近景巨块还在，
   prune 也救不了。
3. **日志本体只增不减。** 会话日志是 append-only 的多帧 zstd 流，prune/摘要
   事件本身还会追加最大 563 KB 的帧。磁盘上的「体积感」与上下文压力是两个
   维度，但前者常被误读为「压缩没用」。

## 三、对策（按优先级，已全部在本会话执行或采纳）

1. **分片读**：大文件一律 `read offset/limit` 分片（≤~500 行/片），禁止无脑
   整文件读；javap 转储先落 `.tmp/kin/*.txt` 再分片读，不把 100 KB 原文留在
   上下文里。
2. **grep-first**：先 grep 定位行号区间再 read 该区间；`include` 过滤扩展名。
3. **转储落盘**：一切外部大输出（javap、解压、脚本跑批）先写 `.tmp/`，
   上下文里只留结论 + 文件路径。
4. **测试只看尾部**：全量测试跑完只汇报 tail（失败清单/统计行），不贴全量输出；
   需要细节时用 `include` 过滤或重跑单文件。
5. **子代理卸载**：可并行的取证/分析交给 background subagent，父上下文只收
   结构化结论。
6. **从小权威源重推**：需要旧上下文细节时，从 `git log` / 文档 / 测试重推，
   而不是指望被压缩掉的原始对话。
7. **大块工作时换轨**：感知到接近 0.8 阈值且近期巨块多时，主动开新会话
   （带 checkpoint 摘要交接），别在旧会话里硬磨到反复 compact。
8. **会话体检**：怀疑某会话「死了」时，用 `.tmp/multiframe.mjs` 看尾帧是否
   截断 + 有无 end-seed，再决定是否值得续。

## 四、复现工具

- 分析脚本（可复用）：`.tmp/multiframe.mjs`（zstd 多帧切分，魔数
  `28 B5 2F FD`，Node 24 `node:zlib` 内置 zstd）、`.tmp/flatten.mjs`、
  `.tmp/bigframes.mjs`、`.tmp/show-top.mjs`、`.tmp/tails.mjs`。
- 会话日志位置：`%APPDATA%\dsh-desktop\harness\sessions\--<workspacename>--`
  （桌面端当前会话）、`%USERPROFILE%\.dsh\sessions\`（导入/旧会话）。
- 压缩器源码：`C:\Program Files\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-compaction-basic\lib\index.js`
  （defaults 14–17 行、`finishError` 338–353、`compactIfNeeded` 857–904）。

## 五、给接手者的操作备忘

- Hindsight 要能写：先在 `C:\Users\Yuxiao Lu\.hindsight\coding-agent.json` 配
  `apiToken`（api_url `https://api.hindsight.vectorize.io`），否则所有
  hindsight_* 工具 401。
- 提交身份：`LuYuxiaoPKU <LuYuxiaoPKU@users.noreply.github.com>`，无
  Co-Authored-By；本仓库 `.tmp/` 未 gitignore，大体积证据目录记得按需
  ignore 或在收尾时清理。
- 本仓库运动学证据链：`.tmp/kin/*.txt`（226 个 javap 转储）+
  `.tmp/client-26.2.jar`（sha1 `2dc72797acbc1b63fc16a11c4ac393605f453754`）
  + `docs/技术路线.md` §7/§10 证据清单 + 每类型一个 commit。
