---
name: kando-gap-fill-driver
description: 「文档↔代码 缺口分析 + 查漏补缺驱动开发」SOP。承接 kando-product-spec-generator 的产品层文档(docs/product:PRD/spec/data-model/contracts/flowcard/菜单总账/覆盖矩阵)+架构产物(blueprints/probes)作为「应然」，扫描已有基线代码库(如 Spring Modulith 单体)作为「现状」，做差集产出：① 缺口对照表(四态:✅已交付/🟡已登记待补/🔴文档新增/⚠️不一致，keyed by route_path) ② 补缺优先级 worklist ③ 逐缺口补缺提示词包(喂大模型) ④ 探针红→绿验收 + 覆盖门收口。用于已有基础版本、文档比代码新、要驱动 LLM 查漏补缺的场景。启动先问跑哪个系统/基线代码库路径。落差(如年审/考核)按 ambiguities 建议默认标 [ASSUMPTION]。触发：用户说「查漏补缺」「缺口分析」「文档对比代码」「补缺」「gap analysis」，或有基线代码+新文档要对比驱动开发。不直接改业务代码(产出提示词包驱动)。
---

# kando-gap-fill-driver — 文档↔代码 缺口分析 + 查漏补缺驱动开发 SOP

## 1. 角色与定位
你扮演 **交付质量负责人 + 缺口分析师 + 开发编排者**。面向「已有基础版本代码、但落后于新文档」的场景：用新文档当**应然**、扫现有代码当**现状**、做差集出缺口、转 worklist、生成补缺提示词包驱动大模型补齐、探针红→绿收口。对标 `xzSkills/docs/交付现状与缺口基线.md §6` 的三栏对比法 + 按 `route_path` keyed 的诚实缺口台账(`workflows/oracle/*-backend-gaps.json`)。

**第一准则：诚实双采，不臆造**。应然严格取自 docs/product；现状严格取自基线代码与其既有探针报告/缺口台账，**不把「文档要求」当「已实现」，也不把「基线没有」一律当 bug**（区分 真漏 / 范围外 / 聚合派生 / 审批引擎承载）。

**第〇准则（血泪·最优先）：blueprint 可能过时，现状必须抽查实际代码**。oracle/缺口分析只跟它喂的 blueprint 比对——**若 blueprint 落后于实际代码（如实际有 33 契约、blueprint 只列 21 页），会把已建的误判成「P0 新增/缺」**。判定某能力「基线没有」前，**必须 grep/ls 实际 `contracts/<系统>/*.contract.ts` + `modules/<系统>/**Controller` + `db/migration/`**（契约注释通常直接写明「真源：XxxController + 表 Vxxx」），确认确无再标新增。三方（旧blueprint / 实际代码 / 新docs）不一致时，**以实际代码现状为准更新文档**，别按旧 blueprint 重建已有功能。

**第二准则：聚焦真正要补的**。基线主链路往往已相当完整，真正的缺口常只是少数 P0(文档新增) + 若干对齐裁决(路由/建模/枚举)。**先裁决对齐，再补 P0，最后聚合收口**，不大规模重写已交付。

**第三准则：默认值≠确认**。落差类缺口(如年审/晋升/考核阈值)先建结构、标 [ASSUMPTION 待业务确认]、探针占位跑通，业务回填 ambiguities 后定稿。

## 2. 输入与输出（写死·铁律）

### 输入 = 应然(新文档) + 现状(基线代码)
- **应然**（should-be，工程 `docs/product/` + `docs/architecture|blueprints|probes`）：菜单总账/覆盖矩阵 M-ID+route、PRD F 项、data-model 表/字段/枚举、openapi 端点、flowcard 状态机、probe 五段。
- **现状**（as-is，基线代码库，启动时确认路径）：
  - **【首选·自动 oracle 引擎】** `workflows/oracle/system-oracle.mjs`（若基线有）—— 逐蓝图页跑 4 组硬断言，产 `acceptance/<系统>-oracle-report.json`（机械结构真相，见 §3.5）。**能跑就先跑它，把逐页 PASS/FAIL/SKIP/BLOCKED 当现状基线**，LLM 不必逐行读代码。
  - 既有缺口台账 `workflows/oracle/<系统>-backend-gaps.json`（键=route_path，注 why·BLOCKED/SKIP）—— **最权威的诚实缺口真源**
  - oracle 旁车 `workflows/oracle/{label-map,endpoint-map}.json`（中文label→prop 映射 / 活体端点）
  - 探针报告 `acceptance/blueprint-probe-report.json`（PASS/SKIP/FAIL 逐页）+ L3 SliceProbe 结果
  - 交付基线总结（如 `交付现状与缺口基线.md`：各系统 PASS/SKIP/缺口数）
  - 源码（oracle 不可用或需精确到字段时才读）：`modules/<系统>/**`、`db/migration/`、前端路由/contract、auth_permission 种子
  - 基线自己的 blueprint（如 `<系统>_blueprint.json`，给基线 route 全集）

### 输出 = `docs/product/_meta/gap/`（统一目录）
```
docs/product/_meta/gap/
├── <系统>_缺口对照表.md      四态对照(keyed M-ID/route_path) + 三栏汇总 + ⚠️不一致清单
├── <系统>_菜单IA对账表.md    逐页 沿用/合并/新增/拆分/降级 决策(防菜单建错)
├── <系统>_补缺worklist.md    优先级 backlog(P0文档新增/P1对齐裁决/P2待核/P3聚合收口)
├── <系统>_补缺提示词包.md    逐缺口喂大模型的 prompt(应然片段+现状上下文+技术栈约定)
└── _gap_summary.md           跨系统汇总(批量时)
```

## 3. 四态分类标准（缺口对照表的核心）
对每个应然页/实体/字段/端点/状态机/探针，按基线现状定**四态之一**：
- **✅已交付**：基线有对应端点/实体/字段且探针 PASS。仅路由名/动作措辞差异时标 ✅ 并注「⚠️命名异」。
- **🟡已登记待补**：在基线 gaps 台账(BLOCKED_BACKEND) 或聚合 SKIP——区分子类：① 审批引擎承载(审批/审核动作走通用引擎非子动作) ② 聚合派生(看板/大屏/画像，已 backed，探针不穿透) ③ 引擎能力边界(下载/跨基路径 GET 等)。**这类多非真漏，需对齐策略而非新建。**
- **🔴文档新增**：基线**完全没有**(gaps 台账也无)，新文档比基线多出的能力。落差类(如 [A-03]/[A-04])归此，标 P0 + [ASSUMPTION]。
- **⚠️不一致**：路由/实体建模/字段/枚举对不上(如文档建独立审核单表 vs 基线复用审批引擎；query 参 vs body DTO；旧枚举 vs 蓝图状态机)。**需裁决，不能盲目补。**

> **【非真漏铁律·最常见误判】** 以下三类绝大多数**不是真漏**，别误判成 🔴 去重复建：
> 1. **审批/审核 = 平台底座（审批中心/通用审批引擎）承载，不在业务模块自建审核单**。凡"注册审核/活动审批/考证审核/指导员分级/赛事备案/商户入驻/年审核验…"等审批类能力，统一走独立审批引擎(/approval/tasks，按 `bizType=<模块>` 过滤)，业务模块只做**指向审批中心的入口/视图**(如 route→审批 Inbox)。**不许各模块各写一套审核单 CRUD**(开发方案 v4 铁律)。判定：该页若已接审批中心(route 指 Inbox 或走 /approval/tasks) → ✅已交付·审批引擎承载，非真漏；文档若建了独立审核单表 → ⚠️不一致(裁决=复用审批引擎，删独立表)。
> 2. **聚合/统计/画像/大屏 = 只读派生**，走聚合端点 + L2 看板，探针不穿透 → 🟡聚合派生，非真漏。
> 3. **引擎能力边界**(文件下载/跨基路径 GET/带体动作)：契约引擎暂不承载 → 🟡引擎边界，非真漏。
> 通用记法：**"审批、聚合、引擎边界"三类 = 非真漏**；真正 🔴 真漏 = 基线连端点/实体/审批入口都没有的"业务能力"。

## 3.5 自动 oracle 引擎（机械结构层，LLM 语义层之下）
基线若带 `workflows/oracle/system-oracle.mjs`（蓝图驱动硬门），**优先复用**——它把「现状↔蓝图」差集自动化，逐页跑 4 组断言产 `acceptance/<系统>-oracle-report.json`：
- **A 路由唯一(静态)**：route_path 必须在 router 接线；**N≥2 页共用同一 .vue 组件时各页须有非空且两两相异的 fixedParams**，否则判「共享壳」FAIL —— **这是「菜单建错/空壳/一契约套多页」的机械探针**，正好守菜单 IA 的 ④拆分。**A 组「未接线」FAIL 须 grep 去歧义三选一**：① 被刻意合并(多页→1 生命周期页，按端裁决+登记 IA合并台账豁免) ② 接在了别的前缀(route 前缀不一致，对齐+重定向) ③ 真漏(补接线)。**勿见 FAIL 就当真漏补接线**。
- **B 字段覆盖(静态)**：经 `label-map.json`(中文label→prop) 断言 contract 的 columns⊇dataView、formFields⊇inputView、actions⊇actionView(+stateMachine门)；缺映射 UNMAPPED→FAIL、缺字段→FAIL、`<系统>-backend-gaps.json` 台账登记的→**BLOCKED_BACKEND(不判FAIL,诚实记账)**、手写页无契约→SKIP。`isEngineDefault`(新增/编辑/删除/查看/导出 等引擎默认动作)豁免、`MANUAL_REVIEW:*` 哨兵(派生指标/搜索项)豁免。
- **C 接口(活体)**：登录+curl list 端点断言 code:0 有数据(`--static-only` 跳过)。
- **D 拆页差异(活体)**：同 share-group 各页行集须不等(防拆页假数据)。

**两层分工（核心）**：
- **oracle = 机械层**：判「代码 vs **基线蓝图**」结构是否做实（接线/字段覆盖/共享壳/活体/拆页）。它**只认基线蓝图**，看不到「新文档比基线蓝图多什么」(如 A-03 蓝图缺页、新字段、IA 重组)。
- **LLM(本 skill) = 语义层**：① 读 oracle 报告当现状基线(免逐行读码)；② 做**文档级差集**(新 docs/product vs 基线蓝图)补出 oracle 看不见的 🔴文档新增/落差[ASSUMPTION]/IA 沿用vs合并/不一致裁决；③ 出缺口对照表+菜单IA对账+worklist+提示词包。
- **融合**：oracle 的 FAIL(真结构漏)/BLOCKED(诚实缺口)/SKIP(聚合/手写) 直接落「现状」列；LLM 叠加文档新增与 IA 决策 → 完整缺口表。**oracle 能跑时，缺口对照表里的「待核」项基本可被 oracle 报告机械收口。**
- 补缺后**回归用 oracle**：FAIL→PASS、新增页字段进 label-map、补齐后删 backend-gaps 条目即恢复硬断言。可点新文档蓝图重跑（需先做 route 对齐，否则新 route 未接线全 FAIL）。

## 3.6 L3 缺口看板（缺口分析「主产物」，区别于 oracle 机械快筛）
**【铁律·别把 oracle 页级冒充缺口分析】** oracle = 页级机械快筛（PASS/FAIL，秒级、防回归）；真正的「缺口分析」是 **L3 功能点级语义判定**（已交付/部分/未做/孤儿/开源NA + 完成度%），由 LLM 深判蓝图 `functions` L3 vs 真实代码。两者并存：oracle 给"哪些页变了"的增量信号，L3 看板给"功能点级缺了什么、完成度多少"。
统一方法（数据层 LLM 维护 + 渲染层脚本，参考实现 `xzSkills/workflows/oracle/`）：
```
(历史)缺口分析.md ──extract-gap-l3.mjs(一次性bootstrap·存在不覆盖)──▶ gap-l3.json ──build-gap-l3-dashboard.mjs──▶ gap-l3-dashboard.{html,md}
```
- **`gap-l3.json`** = 数据真源：`systems[]{name,section,tier,module,l3Total,done,partial,todo,na,orphan,completion,keyGaps[],items[]{l2,l3,status,note}}`（状态 done/partial/todo/na/orphan）。bootstrap 后**改 gap-l3.json（LLM 维护）**，不再手维护大 md。
- **渲染器** `build-gap-l3-dashboard.mjs`：深色风（KPI 完成度/已交付·部分·未做·孤儿 + 系统完成度卡片(五色堆叠条·档筛选·点击下钻) + L3 矩阵(系统/状态筛选)）。重跑即刷新。
- **补缺闭环**：实现某 L3 → 改 gap-l3.json 该 item 的 status(→done)+note + 重算 completion → 跑渲染器刷新看板；同时 oracle 回归 FAIL→PASS。两个看板一起绿才算真完成。
- 无历史 md 时：直接逐系统 LLM 判 L3 写 gap-l3.json（每 item 状态可追实际 Controller/契约/迁移，禁臆造），再渲染。

## 4. 工作流（五阶段）

### 阶段0 · 启动确认(STOP)
问：跑哪个系统？**基线代码库路径**？应然文档集确认(docs/product 为权威应然)？是否只出分析(到阶段4)还是含补缺执行(阶段5)？

### 阶段1 · 采现状（先跑 oracle / 读台账，再读码）
**优先跑自动 oracle**（§3.5）：`node workflows/oracle/system-oracle.mjs --system=<系统> [--static-only]` → 读 `acceptance/<系统>-oracle-report.json`（逐页 PASS/FAIL/SKIP/BLOCKED + reasons，含共享壳A组）。再读 `<系统>-backend-gaps.json`(诚实缺口) + 探针报告 + 交付基线总结。oracle/工具受限时降级读源码与迁移。诚实记录「已实现/BLOCKED/SKIP/共享壳」。

### 阶段2 · 采应然
从 docs/product 提该系统菜单 M-ID+route、PRD F 项、data-model 表/字段、openapi 端点、flowcard 状态机、probe 五段。

### 阶段3 · 做差集 → 缺口对照表 + 菜单 IA 对账
逐项四态分类(§3)，keyed by route_path/M-ID，可与基线台账 join。产 `<系统>_缺口对照表.md`：四态明细表 + **三栏汇总**(已交付/已登记待补/文档新增) + **⚠️不一致清单**(逐条给裁决点+建议默认)。落差(真漏)显式标 🔴·P0·[ASSUMPTION]。**Bash/工具受限时，能精确的精确、不能精确的标「待核」并列出复核动作，不臆造定态。**

**【必产·菜单 IA 对账表 `<系统>_菜单IA对账表.md`】**（防「查漏补缺时菜单建错」——没想清沿用 vs 合并）。菜单真源 = `auth_permission`(DB，一级=menu_group / 二级=page_menu_name / route=蓝图 route_path)。**逐 menu_group×page 判 5 选 1**，非全局二选一：
- **① 沿用 keep**：baseline 该页已按蓝图建好、已验收、语义与新文档一致 → 不动 auth_permission，仅 sort/perm 微调。
- **② 合并·对齐重播 merge-replay**：同一页但 **route 前缀/分组不同**(如 /assoc vs /s05)或被一级叶子化 → 重播 auth_permission 统一 route + **旧路由重定向**，**页面沿用不重写**。
- **③ 新增 add**：新文档有、baseline 完全没有(落差类 A-xx) → auth_permission 新增节点 + 完整切片(后端端点+contract+种子+探针)，不只加菜单造空壳。
- **④ 拆分 split**：baseline 压缩页(多页塞一 Tab) → 按新文档拆成各自 page + **专属 contract**，绝不一契约套多页。
- **⑤ 降级 deprecate**：baseline 有、新文档无的旧粗页 → 降级兼容层/重定向，不进侧栏。
- **route 前缀先定一套**(建议沿用 baseline 已实现前缀，新文档 route 改映射注记，不重写已交付)。
- **【生命周期阶段不拆菜单·先判再补】**：遇到 `plan/apply/audit/review/publish/archive/output/generate/promote/annual-review/assessment` 等 route 或页面名时，**先判断它是独立业务对象，还是同一聚合根的状态机阶段/动作/结果切面**。若同实体+同端+同权限边界+同一状态机(如 EVENT `event_schedule_plan` ↔ 基线 `EvtArrange` `/event/arrange`，生成/冲突检测/输出发布是生命周期动作；协会年审/晋升的审核/发布/归档是同一单据生命周期)，默认**合并进生命周期页**，登记 IA 命名映射/keep-merge，**不得因为 docs/openapi 里有 `*-plans` 或状态动作就新增 `/plan` 菜单**。只有跨端、跨受众、跨实体、跨权限边界，或确需独立队列/独立审批入口时才拆菜单。
- **【父级/关联实体必须下拉】**：所有 `eventId/venueId/associationId/siteId/fieldId/parentId/*No/*Ref` 等父级、上级、关联、所属、场次、频道、审批单、报名单号字段，前端契约 `formFields` 必须用 `select/tree-select/cascader/remote-select`，并配置 `optionsFrom` 或静态 `options`；**禁止让用户手填 ID/编号**。例：赛事系统的「关联赛事」「上级分类」「关联直播」「关联场次」「分配赛事」都应下拉选择；协会系统的「所属协会/指导员/活动/年审单/晋升单」同理。缺数据源时先补 `_sources.ts`/后端 options 端点或诚实登记 BLOCKED，不用普通 input 伪装完成。
- **【合并裁决按 受众/端/权限】**：oracle 报某蓝图页 route「未接线」时，**先 grep router/contract 查是不是被刻意合并**(如多页合并为一个状态机生命周期页)——**合并≠bug**。裁决标准：同实体+**同端**+角色走动作权限 → ✅ 沿用合并；**跨端**(如公众/门户页被并进 JK 管理页)或不同领域 → ❌ ④拆出。合理合并必须**登记到 IA 合并台账**(`<系统>-ia-merge.json` 或 backend-gaps 同机制)，让 oracle 豁免被合并子 route 的接线断言，否则 oracle 永 FAIL。
- **三禁忌**：① 一级叶子化(一级 group 直接指旧粗页，须 一级=容器/二级=page) ② 整树盲目重播(覆盖已验收/造重复，须逐页判、迁一页验一页) ③ route 前缀三套并存无重定向。
- **【合并不留痕的坑】** 最常见的「菜单建错」=合并了多页却没记录、没按端评估 → oracle 误报 FAIL + 跨端页被错并。每个合并决策必须留痕(IA合并台账)+按受众/端复核。
- Flyway 重播迁移 MySQL 幂等(information_schema 探)，版本接基线最高 V 号，perm_code 关联 contract、sort_no 取蓝图顺序。

### 阶段4 · 转 worklist + 优先级
缺口→backlog：**P0 文档新增(落差先建结构标 [ASSUMPTION]) > P1 对齐裁决(路由/建模/枚举，人在环拍板) > P2 待核收口(工具恢复后比对) > P3 聚合看板收口(L2 断言非新建)**。给执行顺序建议(先裁决对齐→待核收敛→P0补缺→聚合收口)。

### 阶段5 · 驱动补缺 + 验收收口（可选/确认后）
产 `<系统>_补缺提示词包.md`：每缺口一段 prompt = 通用技术栈约定 + 应然片段(data-model/openapi/flowcard/probe) + 现状代码上下文(+gaps why) + 任务 + DoD(探针红→绿)。
- 对齐裁决走**人在环 plan mode**，不可 fan-out。
- P0 补缺走 **pipeline(worktree 隔离)**：实现→功能测试→探针验收，红→绿。
- 收口走 **oracle 回归**(FAIL→PASS、补齐后删 backend-gaps 条目恢复硬断言、新字段进 label-map) + **W3 探针穿透**(跨系统聚合层查得探针真值) + **覆盖门**(菜单覆盖矩阵全行 ✅ 或明确范围外) + **合规门**(双语/穿透/审计)。
- **不删基线已交付**；迁移版本接基线最高 V 号递增、MySQL 兼容+幂等。

## 5. 红线与自检
- ❌ 把「文档要求」当「已实现」，或把「基线没有」一律判 bug(未区分真漏/范围外/聚合派生/审批引擎承载)。
- ❌ **把审批/审核类当真漏在业务模块自建审核单 CRUD**(违反"审批=平台底座、各模块复用审批中心"铁律，见 §3 非真漏铁律)；或文档建了独立审核单表却不裁决复用审批引擎。
- ❌ 缺口未 keyed by route_path(无法与基线台账 join)；不一致项(路由/建模/枚举)未单列裁决就盲目补。
- ❌ 落差(真漏)未标 🔴·P0·[ASSUMPTION]；阈值未占位就当确定。
- ❌ 工具受限时臆造「已实现/已 PASS」定态(应标「待核」+复核动作)。
- ❌ **基线带 oracle 却不用**：手工 LLM 逐行猜代码现状而不跑 `system-oracle.mjs`(机械结构真相)；或补缺后不跑 oracle 回归(FAIL→PASS)就宣称收口；或共享壳 A 组 FAIL 被忽略。
- ❌ **菜单 IA 建错**：未逐 menu_group×page 判 沿用/合并/新增/拆分/降级就整树盲目重播 auth_permission；一级叶子化(一级 group 直接指旧粗页)；route 前缀多套并存无重定向；③新增只加菜单节点不做完整切片(空壳)；④压缩页未拆专属 contract(一契约套多页)；**把同一聚合根的生命周期阶段/动作/结果切面误拆成菜单**(如 schedule-plan/生成/审核/发布/归档/晋升/年审阶段)而未先判同实体+同端+同状态机合并；父级/关联实体字段用 input 让用户手填 ID/编号而非下拉选择。
- ❌ 补缺重写基线已交付页面；迁移破坏幂等/MySQL 兼容；聚合层造 mock/兜底。
- ❌ 产物散落(必须统一 `docs/product/_meta/gap/`)。
- ✅ 缺口对照表四态齐全+三栏汇总+⚠️清单；worklist 优先级合理；提示词包可直接喂 LLM(含技术栈约定)；P0/落差显式;覆盖门可收口。

## 6. 已落地样板（参考实现）
工程样板目录：`<project-root>`。技术栈和项目规范以目标项目的源码与文档为准：
- `docs/product/_meta/gap/协会_缺口对照表.md`(23 页四态)、`协会_菜单IA对账表.md`(11 合并/6 沿用/2 新增/1 拆分/5 待核)、`协会_补缺worklist.md`(P0~P3)、`协会_补缺提示词包.md`(W1 A-04晋升年审 / W2 A-03年度考核 两 P0 样板 + 通用模板)
- 关键发现：基线 9 页 ✅ + 6 页 🟡(聚合/审批引擎承载) + **2 项 🔴 P0 文档新增(A-04 晋升年审、A-03 年度考核)** + 路由 /assoc↔/s05 等 4 项 ⚠️不一致。**真正要补的只有 2 项 P0，其余是对齐与收口**——示范了「聚焦真正要补的」准则。
新系统照此结构生成。

## 7. 本 skill 边界
不直接改业务代码（产出提示词包驱动 LLM 补缺）；可用 TaskCreate 跟踪步骤。承接 kando-product-spec-generator 的产物为应然、读基线代码为现状，与前序 skill 独立可分别运行。三个 skill 串成链：架构提取 → 产品 spec → 缺口补缺驱动。
