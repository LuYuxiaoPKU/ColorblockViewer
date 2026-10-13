# ColorBlock 模组 Wiki 全面重写规划（草稿）

> 状态：**草稿 v0.1**（2026-10-14）——ColorblockViewer 会话①起草，已向 Bilibili
> 视频摘要学习会话②发出协作请求（重写建议 + 来源标注规范 + 内容边界），待其回复后合并。
> 本文是规划底稿，定稿后 Wiki 按此重写、本文归档或转为 CHANGELOG。

## 一、为什么要重写

现有 Wiki（10 页 672 行）的强项与短板：

| 维度 | 现状 | 问题 |
|---|---|---|
| 命令/表达式/NBT 语义 | 与预览引擎逐字对齐，1161 测试锁定 | **强项，保留**；但缺少版本差异维度（三代指令树） |
| 历史与命名 | overview 一张 4 行表 | **最薄弱**：ColorBlock→ExParticle 沿革、MCBBS 原帖、作者、协议、版本史全部缺失 |
| 生态引用 | faq 提到 viewer.dbi.top / 生成器站一句话 | 无出处、无链接、无贡献者致谢；「引用他人成果需注明来源」未落实 |
| 粒子类型 | 26.2 表为主，1.21.11 一行带过 | 基岩版/网易版完全没提（社区生态的一半） |
| 示例 | 5 个引擎实测 + 2 模板 | 社区 17 个现成案例（OCEAN 站）一个都没收录 |
| 表达式 | 语法速查 + 变量表 | 缓动函数库、分段表达式、浮点陷阱、颜色管线只有零星提及 |

结论：语义层（引擎对齐部分）**不要推倒**，重写重心是 **补历史、补生态、
补来源、补版本维度**。

## 二、重写原则（协作对齐用）

1. **严谨分层**：每个事实标注置信级——
   - **[源码级]** 模组/游戏字节码或源码直接核对（预览引擎测试锁定）
   - **[官方级]** 模组作者发布帖/文档（MCBBS 原帖、mcmod post/4889、ExParticle README）
   - **[社区级]** B 站视频/专栏/论坛（OCR 或存档），标注「待验证」如未经引擎实测
2. **引用格式**（待会话②对齐，初步方案）：
   - 视频引用：`（B 站 @UP主《标题》 BV号，OCR 存档见 Bili-Video-Learn 知识库）`
   - 文档引用：`（翊尘呀《ColorBlock 教程——更好的粒子》cv21908911，1.16.5 口径）`
   - 站点引用：`（OCEAN 生成器站 mc.ecyft.top，镜像 tools.pj568.top）`
   - 每页文末统一「来源与致谢」节
3. **内容边界**：Wiki = 权威语义 + 沿革 + 入口链接；社区笔记细节（逐视频拆解、
   网易版差异全集、UP 群像）**留在 Bili-Video-Learn**，Wiki 只做「入口 + 一句话」
   并链接过去（或链接到 mcmod 原帖等公开来源，知识库本身是私库则不直链）。
4. **不改 1:1 语义结论**：命令树、报错文案、NBT 校验等源码级结论原样保留，
   重写不引入未经验证的新语义。

## 三、目标页面结构（提案）

```
index            首页：快速上手 + 目录 + 术语口径（保留，微调）
00-overview      总览 + 【重写】历史沿革（MCBBS 2019 原帖 → ExParticle 延续）
                 + 贡献者图谱精简版 + 生态工具一览（生成器站/预览器/本工具）
01-commands      命令大全【保留语义 + 新增】版本差异标注（1.12.2/1.16.5/1.21.1+
                 三代指令树对照表；funlist→functions、clearcache→clear-cache、
                 rgb 系列改名、image 字段序演变）
02-expressions   表达式【保留 + 补】变量四类表（自变量/因变量/无效/常量）、
                 分段表达式、缓动函数库（来源 post/4889）、浮点精度陷阱、
                 颜色管线（2.0→0.996 环绕）、NaN/Infinity 行为
03-nbt           NBT 选项【保留】
04-particles     粒子类型【保留 + 补】Java 版三代差异；基岩版/网易版一句话
                 + 外链（不展开，边界原则）
05-examples      实战示例【扩充】+ 收录社区经典案例（OCEAN 站 17 例中挑选
                 引擎可验证的：正方体/菊型球/桃心/旋转球体…，逐条注明出处作者）
06-faq           FAQ【保留 + 补】JRE8 环境坑、光影改色（BSL 纯白→金黄）、
                 /tick rate 上限 20、mcfunction 大写路径坑
07-templates     模板库【保留，代码对齐机制不变】
08-history       【新增】模组历史与生态页：MCBBS 原帖版本史（0.0.1→1.0.0）、
                 ExParticle 沿革（1.4.0/1.5.0 亮点）、OCEAN 三件套、贡献者致谢、
                 来源清单（本 Wiki 引用规范的总表）
```

页面从 10 → 11（新增 08-history）；gallery/index 随导航同步。

## 四、执行步骤（待协作对齐后）

1. 会话②回复建议 → 合并进本规划（冲突点逐条裁决并留痕）
2. 定稿页面结构 + 来源标注规范
3. 逐页重写（语义页最稳妥先做：03-nbt → 07-templates；历史页信息量最大：
   00-overview → 08-history；扩充页：02-expressions → 05-examples → 06-faq）
4. 每页完成即跑 wiki 构建（vitepress build）验证链接与渲染
5. 全部完成 → 一次性 commit（或按页 commit），部署验收

## 五、待会话②裁决的问题清单

- [ ] 引用格式：BV 号/专栏 cv 号/URL/作者/访问日期的最小必需字段？
- [ ] Bili-Video-Learn 知识库本身是否可作为公开引用目标（私库则 Wiki 只链公开来源）
- [ ] 网易版/基岩版内容：进 Wiki 正文（一句话+外链）还是完全不提？
- [ ] OCEAN 站 17 个案例哪些优先收录（需引擎可验证 + 有明确作者归属）
- [ ] 三代指令树对照表放 01-commands 正文还是 08-history？
- [ ] 「贡献者图谱」的 Wiki 化程度（全表收录 vs 致谢一句话+外链）

## 六、会话②成品与新增量（2026-10-14 读毕，v0.2 合并源）

会话②（Bili-learn）已备好两份高价值文档（原协作消息投递失败，重发后它回了
文档指针，全文已读）：

1. **[Wiki汇编-ColorBlock与ExParticle生态.md]**（02-生态情报/情报汇总/，93 行）
   ——「直接供会话① Wiki 收录」的成品：三代模组表 / 根命令别名链（含
   **1.21.1 根命令 `/particlex` vs 1.12/1.16 `/particleex` 的元信息差异**——
   待与预览引擎/模组会话③核对口径）/ 完整字段序 / 表达式语法与技巧 /
   17 案例清单 / 环境排错速查。来源均已标注，权威顺序：源码(③) > 教程帖 > OCEAN 站 > 视频笔记。
2. **[ExParticle源码研读-2026-10-13.md]**（01-学习笔记/，313 行，源码直读
   commit 62ccdd4 / 1.5.2）——**重大增量，改写 01-commands 的范围**：
   - **教程未记载的命令面**：custom-normal/conditional/parameter/image/
     image-matrix/video/video-matrix（attr 表达式逐点算属性）、**text**
     （字体渲染到离屏 FBO → 逐像素粒子，dpb=每方块像素数）、
     **global-variable**（int/double/quat，define/undefine/peek，引用失效
     重编译链）、**user-function**（define/undefine/list，ASM 编译自定义函数）、
     rgba 系列实为 4 变体（rgba-polar/rgba-tick/rgba-tick-polar 教程没讲）。
     → Wiki 收录口径：**[社区级·源码直读]** 置信级，标注 ExParticle 1.5.2
     实测源码、与 26.2/1.21.11 预览引擎覆盖范围的差异需单列
   - **表达式引擎真相**：Lexer→Parser→Optimize→ASM 隐藏类（非解释器）；
     返回 int 语义；矩阵字面量四类编译期分支；表达式按原文缓存 + 全局变量/
     用户函数失效链——02-expressions 页「底层实现」节素材
   - **ParticleStruct 全字段表**（= 表达式全部变量）：size（×0.125=1/8 格
     语义）、light 0~1、gravity/friction、destroy、dx/dy/dz 初始副本等
     ——比 post/4889 变量表多 size/light/gravity/friction 四组，02 页变量表
     以此为准补全
   - **maxParticleCount 实现真相**：@ModifyArg 直接替换原版 EvictingQueue
     (16384) 容量，**超出淘汰最旧而非拒绝生成**；ParallelParticleUpdate =
     parallelStream；**maxParticleTickMillis 源码无读取点（疑似废弃）**——
     修正既有「配置生效」的记载口径
   - bind（粒子绑定实体 Supplier）、ExParticleApi/CustomEvaluator 外部
     mod 接口（08-history 或单独「生态/API」小节）

## 七、v0.2 合并待办（会话②回复裁决后）

- [ ] 以「Wiki汇编」为骨架对照本规划 §三页面结构，逐节归位（哪些进 commands
  正文 / 哪些进 expressions / 哪些进 history / 排错进 faq）
- [ ] 01-commands 范围决策：仅 26.2/1.21.11 预览已实现的 17 子命令 vs
  加 [社区级·源码直读] 的 ExParticle 独有命令面（text/custom/global-variable/
  user-function）——倾向：正文标「预览支持」徽标 + 附表收录全部命令面，
  兼顾工具一致性与模组完整性
- [ ] 变量表以 ParticleStruct 全表为准重排，标注「预览引擎已实现/未实现」
- [ ] 修正粒子上限口径（原版 16384 淘汰制 vs ColorBlock 2^20 vs ExParticle
  65536 默认可调——三代三口径，faq 与 overview 各自说清）
