---
name: kando-product-spec-generator
description: 「架构产物 → 产品层六类交付物」生成器 SOP。承接 kando-macro-architecture-extractor 的三层架构产物(arch.json/blueprints/probes/ambiguities)，按系统生成面向产品+研发的六类交付物：① 单系统产品 PRD(11章+附录) ② 子系统薄 spec(7小节) ③ 功能菜单总账 ④ 菜单覆盖矩阵 ⑤ 全量数据模型 data-model-spec(org_式模块切片) ⑥ contracts 契约骨架(OpenAPI yaml + flowcard JSON)。统一产出到 docs/product/ 子目录。启动先问跑哪个系统/域码/端范围；可先跑样板系统再批量。落差按 ambiguities 建议默认织入并标 [ASSUMPTION 待业务确认](默认值≠确认)。触发：用户说「产品spec」「产品PRD」「菜单栏」「功能菜单总账」「契约骨架」「product spec」，或在已有架构产物的工程里要求生成产品/开发交付物。不改业务代码。
---

# kando-product-spec-generator — 架构产物→产品层六类交付物 SOP

## 1. 角色与定位
你扮演 **产品经理 + 解决方案架构师 + 契约设计师 三位一体**。把上游「架构提取」得到的三层产物（L0 架构 / L2 页面契约 / L4 探针）转译成**可直接给产品评审、给研发开工**的六类交付物。方法论对标 `xzSkills/docs` 的「契约驱动通用引擎 + 开发方案-v4」：blueprint 作单一真源 → 契约驱动；菜单真源走 DB `auth_permission`（种子来自 blueprint 的 menu_group/page_menu_name/route_path）。

**第一准则：以架构产物为绝对基准，不脑补**。每个字段/菜单/表/端点必须能追溯到 blueprint/arch/probe 的具体来源 + § 章节号。原文细节不足时回查 `sections/` 切片，仍不明确则进 [ASSUMPTION]，绝不捏造。

**第二准则：默认值≠确认**。落差（ambiguities 的 🟠/🔴/🔵）按「建议默认」织入产物，但每处标 `[ASSUMPTION 待业务确认]`，集中登记到 PRD 附录A / spec §6 Ask-first / data-model §C 三处，挂 ambiguities 编号，等业务回填触发增量重跑。

## 2. 输入与输出（写死·铁律）

### 输入 = 工程文件夹本身（不读外部 PDF）
以**当前工程文件夹为唯一真源**，按系统读取：
- `docs/architecture/_rerun/<sysid>.json` —— 该系统 functions/lineage/rbac/swimlanes/api/state_machines（PRD §2/§4/§10、data-model 表映射、契约状态机的真源）
- `docs/blueprints/<系统中文名>_blueprint.json` —— 扁平 page 数组(menu_group/page_menu_name/route_path/reference_section/atomic_contract{data_view,action_view,input_view}/state_machine)（菜单/PRD §5/契约字段的真源）
- `docs/probes/<系统中文名>_probe.json` —— tab1_overview(business_target/testing_strategy/golden_path/entities) + tab2_execution(五段断言)（DoD、flowcard ⑥、探针 join 的真源）
- `docs/architecture/xz_fitness_platform_ambiguities.md` —— 该系统相关落差(建议默认值)
- `docs/architecture/xz_fitness_platform_arch.json` —— 全局 systems/coupling/topology(平台定位、跨系统穿透)
- `sections/*.txt` —— PDF 原文切片，**仅在架构产物细节不足时回查**（如某规则阈值、章节依据）。不依赖工程外 PDF。
> xzSkills/docs 仅作**格式基准参考**（章节骨架/列结构/命名），**不作数据源**。

### 输出 = 统一目录 `docs/product/`（内部分子文件夹）
```
docs/product/
├── prd/PRD-<域码>-<系统中文名>_<YYYYMMDD>_v<ver>.md   单系统完整 PRD(11章+附录)
├── specs/<系统编号如5.5.5>.md                          薄 spec 7 小节
├── data-model/data-model-spec.md                       数据模型(<域前缀>_模块切片,全量累加单文件)
├── contracts/<域码>.openapi.yaml                       OpenAPI 3.0.3
├── contracts/flowcard-<域码>-<流程>.json               关键流程 flowcard(6段)
├── ledger/功能菜单总账.md                              全量累加(各系统切片)
├── ledger/菜单覆盖矩阵.md                              全量累加
└── _meta/_coverage_check.md                            覆盖门自检报告
```
生成脚本放工程 `scripts/`（如 `build_menu_ledger.py`）。**产物绝不散落到 docs 根或他处。**

**命名规范**：域码取**与 data-model 表前缀一致**的英文短码（如 ORG↔org_、VENUE↔venue_）；PRD `PRD-<域码>-<中文名>_<日期>_v<ver>.md`；spec 用系统编号 `5.5.x.md`；契约 `<域码>.openapi.yaml` + `flowcard-<域码>-<流程>.json`；blueprint/probe 已是中文系统名。

## 3. 六类产物的骨架 + 来源映射

### ① 单系统 PRD（11 章 + 附录，对齐 xzSkills `PRD-AUTH-*.md`）
| 章 | 内容 | 来源 |
|---|---|---|
| 1 系统定位与核心价值 | 定位/价值 | arch.systems.duty/positioning + probe.business_target |
| 2 用户对象、入口与角色 | 角色×菜单×操作×数据范围×隔离 | **_rerun.rbac** + blueprint permission 归端 |
| 3 功能模块总览 | 模块码 M-<域>-NN + 端×模块矩阵 | blueprint menu_group + functions |
| 4 业务流程全景 | 流程清单(嵌 mermaid) | **_rerun.swimlanes** + probe.golden_path |
| 5 功能需求 F-<域>-NN-MM | 每末级菜单逐页三视图 | **blueprint atomic_contract 逐页** |
| 6 State Machine | 每实体 当前态\|动作\|目标态\|触发方\|guard | blueprint.state_machine + _rerun.state_machines |
| 7 业务规则 | 双语/时限/防伪/金额禁兜底 | field remark + lineage.process + 平台硬约束 |
| 8 非功能需求 | 性能/安全/时效/双语/审计 | 平台约束 |
| 9 验收标准 DoD | 探针五段 | **probe tab2 断言 + testing_strategy** |
| 10 依赖与约束 | 对外接口/跨系统 | **_rerun.api** + ambiguities 归属类(如裁判库) |
| 11 Out of Scope | 端范围/落差暂缓 | 阶段0 端范围确认 |
| 附录A | 切片排期 + **[ASSUMPTION] 清单** | spec §7 + ambiguities |

### ② 薄 spec（7 小节，对齐 `specs/venue.md`）
目标与用户 / 核心实体与引用键(lineage+probe.entities) / 核心流程与状态机 / 接口操作面(按端) / 验收 DoD(引探针) / 边界(Always·Ask-first·Never，落差入 Ask-first) / 切片清单(按 lineage produce→consume 依赖排序)。

### ③ 功能菜单总账（对齐 `功能菜单总账.md`）
列 `§号 | 功能模块(menu_group) | 二级要点(page) | 主端 | 状态`；主端由 action_view.permission 推(管理/主管→JK、公众/门户→门户/C、系统→🔧)；状态 ✅三源齐/🟠探针盲区或落差/🔴真漏(需求有依据但 blueprint 缺页)/🔧系统类。**脚本批量** `scripts/build_menu_ledger.py`。

### ④ 菜单覆盖矩阵（对齐 `ledger/菜单覆盖矩阵.md`）
列 `菜单ID(M-<sec>-NN) | 菜单 | 端 | 探针(join probe) | 切片(spec§7) | 端导航 | 落地状态(初始⬜)`。**脚本批量**。

### ⑤ data-model-spec（对齐 `data-model-spec.md`）
- §0 跨模块引用键字典（跨模块存业务键副本+索引不建物理 FK；同模块父子可 FK）
- §5 `<域前缀>_` 模块表 DDL（表格式 `列|类型|说明`，标记 🌐双语 ⚓父级FK 🔗跨模块键 🔎探针穿透 🔴PDF补登 [ASSUMPTION]）—— 表清单来自 blueprint data_view 字段 + lineage 实体；缺口实体(blueprint 有页无独立实体表或反之)显式新建/标注
- §A 状态机枚举总表（每 state_machine.to 集合）
- §C [ASSUMPTION] 清单（挂 ambiguities 编号，阈值占位，不自行拍板）
- 双语/审计/独立 *_status_log 策略；与基准旧枚举冲突时**采用 blueprint(状态机真源)**，差异标待清理不静默融合

### ⑥ contracts（对齐 `venue.openapi.yaml` + `flowcard-*.json`）
- **OpenAPI 3.0.3**：tags=menu_group；paths=每实体 CRUD(GET列表分页/GET详情/POST/PUT/DELETE) + **状态机每条 transition→动作端点**(submit/audit-pass/…，[ASSUMPTION] 项 description 双标注) + 对外接口(来自 api)；components/schemas=每实体 Entity+SaveDTO+R信封(REnvelope/RPage/AuditFields，allOf 模式)；camelCase、enum 全列、状态 enum 与 data-model §A 一致。
- **flowcard(每条关键 golden_path 一个，6 段)**：①源闭合(L1_PDF实锤/L3_待拍板) ②状态机(initial+transitions 带 role/guard/source) ③字段契约 ④端点契约(对齐 OpenAPI) ⑤跨系统穿透(probe 5_crossref) ⑥验收脚本(probe stages)。

## 4. 工作流（五阶段）

### 阶段0 · 启动确认（STOP 等回复）
问用户：**跑哪个系统？**（给 arch.systems 清单）+ **域码**（建议=data-model 表前缀）+ **端范围**（确认 JKBoss/门户/C 端，C 端是否暂缓）+ 命名收敛（若工程已有两套码先拍板）。可先跑样板系统再批量。

### 阶段1 · 读架构三层 + 落差盘点（STOP 等确认）
读该系统 _rerun + blueprint + probe + ambiguities 本系统条目（细节不足回查 sections/）。产「素材清单」中间表：menu_group×page / 状态机实体 / lineage→表映射 / 跨系统穿透 / 该系统落差(哪些 [ASSUMPTION] 默认采用)。STOP 让用户确认落差处理。

### 阶段2 · 生成六类产物（按依赖序，read→compose→write，不刷屏）
顺序：**data-model(根·定表/键) → OpenAPI(依赖表字段) → flowcard(依赖状态机) → 菜单总账+覆盖矩阵(脚本批量) → 薄 spec → PRD(集大成,§5 按模块分批)**。
- 脚本批量项（总账/矩阵）走 `build_menu_ledger.py`，产物不回显、只读 head 校验。
- 半精写：data-model（新表 DDL 精写）、OpenAPI（先脚本出 paths 骨架→精填 schemas）、flowcard（②③可自动、①⑥精写）。
- 精写：薄 spec（短）、PRD（最大件，§5 按 menu_group 分批写）。
- **禁止把 blueprint/probe 全文贴进对话**；data-model 用锚点累加不重写整文件。
- **【分类器降级】** 若 Agent/Bash 被安全分类器拦截（`temporarily unavailable`），改为**主进程亲自 Read 源 + Write 产物**（Read/Write 不过分类器）；脚本写出但由用户 `!` 执行或分类器恢复后跑。

### 阶段3 · 覆盖门自检（产 `_meta/_coverage_check.md`）
断言并列表：blueprint 每个 page → ①菜单总账有行 ②覆盖矩阵有 M-ID ③PRD §5 有 F 项；每个有状态机实体 → data-model §A 有枚举；每条 golden_path → flowcard(或显式并入说明)；**需求有依据但 blueprint 缺页的落差(如年度考核类)必须被捕获并标 🔴真漏**。任一缺失=红灯重做。YAML/JSON 合法、md 渲染正常。

### 阶段4 · ASSUMPTION 回填闭环（增量重跑）
业务回填 ambiguities.md 后：✅已确认项落地（去 [ASSUMPTION]、🔴真漏补建页面/表/探针/端点），不做项标关闭并在覆盖矩阵注「业务确认不做」；只动被答复项触及的系统×维度，重生成覆盖矩阵。对齐架构 skill 的「回灌重跑」机制。

## 5. 红线与自检
- ❌ 输入读外部 PDF（应以工程 `sections/` 为真源）；产物散落到 docs 根（必须统一 `docs/product/` 子目录）。
- ❌ 域码/表前缀/契约命名不一致；菜单总账用简称；状态 enum 在 data-model/OpenAPI/PRD 三处不一致。
- ❌ 落差未标 [ASSUMPTION] 或把建议默认当已确认；🔴真漏(需求有/blueprint 无)未被覆盖门捕获。
- ❌ PRD §5 漏页(blueprint 每页必有 F 项)；状态机实体漏 data-model §A 枚举；golden_path 漏 flowcard 未说明。
- ❌ OpenAPI 缺状态动作端点(只 CRUD)；flowcard 缺 ⑤跨系统穿透或 ⑥验收脚本；金额字段未标防兜底；双语字段未拆 zh/bo。
- ❌ 把 blueprint/probe 全文刷屏到对话；data-model 重写整文件而非锚点累加。
- ✅ 覆盖门 `_coverage_check.md` 四闭合通过；六类产物齐全；YAML/JSON 合法；[ASSUMPTION] 三处一致登记。

## 6. 已落地样板（参考实现）
工程中的「协会及人员管理系统（ORG）」样板：
- `docs/product/prd/PRD-ORG-…v1.0.md`、`specs/5.5.5.md`、`data-model/data-model-spec.md`(12 表)、`contracts/org.openapi.yaml`+3 flowcard、`ledger/功能菜单总账.md`+`菜单覆盖矩阵.md`、`_meta/_coverage_check.md`
- 脚本 `scripts/build_menu_ledger.py`
- 落差样板：A-04(指导员年审/晋升 已被 blueprint 预织入状态机)、A-03(协会年度考核 blueprint 缺页=🔴真漏 纯 [ASSUMPTION] 新建)、A-15(裁判库归属)
新系统照此结构与命名生成即可。

## 7. 本 skill 边界
不改业务代码、不建 TaskCreate（可用 TaskCreate 跟踪本 skill 步骤）。产物：阶段1 素材清单 + 阶段2 六类产物 + 阶段3 覆盖门报告。承接 kando-macro-architecture-extractor 的产物为输入，二者独立可分别运行。
