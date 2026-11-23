# .agent — 外部任务记忆与可恢复执行机制

> **移植到新项目**：复制 `.agent/` 与同级 `harness_evolver/` → `node .agent/scripts/agent.mjs install` → 填 `.agent/PROJECT.md`。详见 [`PORTING.md`](./PORTING.md)。

让任何新的大模型会话开机即可靠回答：**我是谁 / 在做什么 / 到哪一步 / 有没有中断的步骤 / 下一步唯一动作 / 完成需要什么证据**。
最终事实来自**代码 / Git / 测试 / 真实外部系统状态**，不是聊天记录。

## 唯一启动命令（每个新会话/恢复时先跑）
```bash
node .agent/scripts/agent.mjs resume
```
它 = 恢复扫描（找中断步骤）+ 生成有界启动上下文。

## 目录职责（分离，不把历史塞进 TASK）
| 路径 | 职责 | 是否提交 |
|---|---|---|
| `scripts/` | 零依赖 Node CLI + lib + 测试 | ✅ 提交 |
| `schemas/` | JSON Schema + 示例模板 | ✅ 提交 |
| `README.md` | 本说明 | ✅ 提交 |
| `ACTIVE_TASK.json` | 仅指针 `{active_task_id}` | ❌ 忽略（运行时） |
| `tasks/<id>.json` | 当前任务快照（**≤16KB**，只当前态+下一步） | ❌ 忽略 |
| `journal/<id>.jsonl` | 只追加事件日志（全过程，不整体注入上下文） | ❌ 忽略 |
| `decisions/<id>/` | 关键决策（选择/原因/影响/是否仍有效） | ❌ 忽略 |
| `evidence/<id>/` | 证据（命令输出/commit/外部回读，快照只存引用） | ❌ 忽略 |
| `checkpoints/<id>/` | 阶段摘要（可由日志重生成，不替代原始事实） | ❌ 忽略 |

> 忽略规则见根 `.gitignore`；各运行时目录保留 `.gitkeep`。状态是每机器/每会话的运行时数据，提交会与他人冲突。

## 命令速查
```
init --objective ".." [--id ..] [--phase ..] [--next ..] [--dod ..]* [--constraint ..]* [--ref ..]* [--no-activate]
switch <id> | status | context | resume
start-step --intent ".." [--step ..] [--idem ..] [--focus ..] [--effect external-write --target ..]* [--force]
verify [--fail] [--evidence ev:..]* [--note ..]      # in_progress→verifying + 记录验证结果
commit-step [--step ..] [--idem ..] [--summary ..] [--evidence ev:..]*   # 幂等：同 idem 已提交则跳过
fail-step [--step ..] --reason ".."
evidence add --kind .. --ref .. [--target ..] [--data ..]   # 脱敏后落盘，返回 ev:id
decision add --title .. --why .. [--scope ..]         # 返回 dec:id
dod set --index N [--met|--unmet] [--evidence ev:..]*
checkpoint [--auto]
recover [--reconcile <step> --evidence ev:..] [--fail <step> --reason ..]
block --blocker ".." | complete | validate
repo-map [--root ..]
bug import|sync --file .. [--source ..] [--status ..] | bug list
report [--out ..] [--open] | report check [--out ..]
feedback detect --text ".."
feedback add --source user|engineering --title .. --symptom .. [--evidence ..]*
feedback import --file docs/retrospective/项目复盘待办.md
feedback update|close <U/E-id> [--root-cause ..] [--resolution ..] [--status ..]
feedback list [--status ..] | feedback evolve [--force]
```
所有命令支持 `--json`（机读输出）。改状态的命令：校验输入 → 校验状态转换 → 原子写 → 写日志 → 失败非零退出。

## 记忆到底有没有生效/被调用？怎么看
- **一屏自检**：`node .agent/scripts/agent.mjs doctor` —— 显示：装配是否完好、状态文件是否合法、任务数、
  **journal 共多少事件 / 最后写入时间 / 最近几条调用**，并判定「✅ 记忆在被调用 / ⚠️ 已装但 journal 为空还没被调用」。
- **看板区块**：`board.html` 里有「记忆活动」区块（事件总数/最后写入/中断数 + 最近调用），是「记得住」机制的心跳。
- **原理**：记忆是被动的——`journal/<id>.jsonl` 记多少取决于你/AI 调了多少。**盯 journal 增不增长 = 盯记忆有没有被真正调用**（干了活但 journal 不动 = 协议没被遵守，记忆形同摆设）。

## 一个重要步骤的标准时序（强制）
```
start-step  → 实际操作 → 核对真实结果 → evidence add → verify → commit-step
```
**没有 `step_committed` 的步骤不算完成。** 中断（只 start 未 commit）会被 `recover`/`resume` 检出。

### 外部写入硬门

第三方系统写入必须显式声明目标：

```bash
node .agent/scripts/agent.mjs start-step --step write-result --intent "回填结果" \
  --effect external-write --target "feishu:sheet:I27"
```

先记录 `external-write-attempt`（含 expected fingerprint），再从独立标签/API/会话回读并记录 `external-readback`。只有 `independent_context=true` 且 expected/observed fingerprint 一致，`commit-step` 与 `recover --reconcile` 才会放行。同页公式栏、DOM 文本、HTTP 200 和截图都不能替代持久化回读。

## 状态机
`planned → in_progress → {verifying → completed | blocked}`；`* → cancelled`。
硬规则（写进 `lib/statemachine.mjs` + 测试）：
- 禁止 `in_progress` 直达 `completed`（必须先 `verifying`）。
- `→ completed` 必须有通过的验证证据（`verification_finished:pass` + 每条 DoD `met`+evidence）。
- `→ blocked` 必须带 blocker。
- `completed` 是终态，重开须显式 `reopen`（不静默重开）。

## 一致性与恢复
- **原子写**：tmp → fsync → rename，避免半截文件。
- **锁**：每任务独占锁文件（`wx` 创建）+ stale 超时兜底。
- **乐观版本锁**：改快照校验 `version`，冲突则拒写并要求重读。
- **幂等**：`commit-step` 前扫 journal 同 `idempotency_key`，已提交则跳过。
- **恢复**：`recover` 找出 started 未 commit 的步骤；确认真实态后 `--reconcile`（必须带证据）或 `--fail`；**不凭摘要猜完成**。

### 事务边界（诚实声明）
本机制**不提供**跨 Git / 文件系统 / 数据库 / 第三方 API 的真 ACID 事务。
跨系统一致性靠**幂等键 + 补偿操作 + reconciliation（真实态回读）**，边界即此文档所述。

## 压缩 / Checkpoint 的诚实边界
- `checkpoint` 只总结事实/决策/未完成项/证据引用，标注依据 `event seq` 范围，可由原始日志重生成；**不删原始日志**、**不把 started 当 completed**。
- **平台压缩无法由本机制强制拦截**。`.claude/settings.json` 里挂了**可选** `PreCompact`（压缩前跑 `checkpoint --auto`）与 `SessionStart`（开机跑 `context`）钩子作增强；钩子由平台触发、非本机制保证，失效时手动跑同名命令即可。核心机制不依赖钩子。

## 方法论脚手架层（可选，阶段编排 + 强引导 + 看板）
在「任务记忆」底座上加一层：把开发方法论写成 `process.json`（数据），脚手架**一步步引导你产出对应内容**，
并用 HTML 看板实时展示「进行到哪一步 / 产物是什么、在哪 / 下一步干啥」。每个**阶段 = 一个记忆 task**（复用状态机/DoD/证据/恢复）。

```
process init            # 从模板生成 .agent/process.json（install 已顺带生成）
next                    # 打印唯一的下一步（如：phase start understand）
phase start <id>        # 惰性建阶段 task 并切为活动任务；末尾提示该调哪个 skill 产出什么
（用提示的 skill 生成内容）→ artifact add --phase <id> --key <k> --path <真实路径>
system add <key> --name <名>   # 登记业务系统：按 worklist 模板铺开该系统的标准开发任务（数据库/API/前后端/角色/权限/测试）
system list                    # 列出已登记系统 + 各自完成进度
worklist set --system <k> --task <t> --status <s>   # 推进某系统某开发任务状态（开发到哪标到哪）
board [--out ..] [--open]   # 生成看板：地铁线当前站高亮 + 逐系统开发任务清单 + 产出物总账(路径可点) + skillband
hook install                # 装 git post-commit：每次提交后自动刷新 board.html（install 已顺带装）
```

- **开发任务清单上看板（逐系统）**：`逐系统建造` 阶段在 `process.json` 里配一份 `worklist`（标准开发任务模板）；`system add` 为每个业务系统铺开一套，`worklist set` 推进状态，流程 tab 渲染成「系统 × 任务」矩阵——即「这个后台要做哪些开发任务、每个系统每步到哪了」，随提交刷新。
- **阶段验收 DoD**：记忆 tab 的任务卡片把该阶段 task 的 DoD 逐条展开成「✓/○」清单 + 进行中步骤 + 依据文档链接，反映该阶段的验收进度。
- **可点跳转**：产出物总账路径、任务卡片「依据」在磁盘上真实存在的文件渲染成相对链接，点开即原文件（如页面契约 `blueprint.json` / 渲染蓝图 `blueprint.html`）；缺失则纯文本 + ✗。
- **提交后自动刷新**：`install` / `hook install` 装的 `post-commit` hook 每次 `git commit` 后重跑 `board`，看板即最新态；对已有 hook 幂等、不覆盖。
- **强引导**：`phase start / artifact add / commit-step / verify / complete / dod set / resume` 成功后都在末尾追加一行 `下一步 → …`，共用纯函数 `computeNext()`。
- **产物真源=磁盘**：登记只是索引，`next/board/artifact list/process status` 一律 `existsSync` 回读——登记了但文件不在→如实 ✗，不假绿。
- **skill 只绑定不执行**：`process.json` 里 `skills` 是「该调哪个 skill」的引导指针；仓库内置 skill 位于 `.agent/skills/`，看板标 ✓项目内置/✓全局已装/✗未装/?未知。实际起动由 AI 显式读取和调用，清单见 `process/SKILLS.md`。
- 分层：`process.json`（配置，提交）；`process-state.json` / `board.html`（运行时，忽略）。字段与换方法论见 `process/README.md`。
- **给 AI 的工作协议**：把 `PORTING.md` 的「方法论脚手架协议」段贴进 `AGENTS.md` / `CLAUDE.md`，让后续会话遵守引导闭环。

## Harness Evolver（反馈外循环）

同级目录 `../harness_evolver/` 将历史 Bug/交付反馈归因到 `REQUIREMENT | DATABASE | CODING | TESTING`，增量更新四阶段规则库。`next`、`context`、`resume`、`phase start` 会依据当前阶段、worklist 任务和目标路径自动附加有界规则与 Few-shot；模块缺失或 Python 调用失败时会明确告警，但不破坏主 Harness 状态机。

```bash
node .agent/scripts/agent.mjs feedback evolve
python3 -m harness_evolver.context_injector --stage DATABASE --tech-stack "MySQL Flyway"
cat harness_evolver/reports/LATEST.md
```

LLM 为显式可选增强，默认 `--use-llm never`；只有命令传 `auto|always` 才允许外发已脱敏反馈。升级脚手架时，`harness_evolver/state`、`knowledge_base`、`history`、`reports` 和项目自定义 `config.json` 都属于项目累积知识，禁止覆盖。

### 自动反馈账本

新项目通过 `PORTING.md` 的 Agent 协议实现会话内自动触发：用户明确描述当前项目问题时，Agent 在处理前调用 `feedback add`；测试/运行失败只有在复现或有证据后登记。结构化真源为 `docs/retrospective/feedback.jsonl`，CLI 同步渲染 `项目复盘待办.md`。

`feedback close` 自动运行离线 Evolver。`complete` 进入 `delivery` 或 Bugfix `report` 阶段时，存在未闭环反馈会返回 `EOPEN_FEEDBACK`；复盘有变化则自动生成规则差异报告。关键词 `记入复盘`、`生成规则差异`、`执行evolve`、`复盘归档`、`项目复盘` 可显式触发对应动作。CLI 不能监听 Agent 会话之外的聊天。

## 可选 Bugfix Extension

Bug 修复项目可把 `process/bugfix.template.json` 复制为项目 `.agent/process.json`。扩展提供：

- `bug import|sync`：保留全部源状态，默认把待修复/待开发标为本轮范围；重复同步不清除验证历史。
- `repo-map`：生成确定性的代码库骨架图谱。
- `report`：同时展示 `source_status` 与 `verification_status`，并读取 Bug-local Markdown/JSON/图片和 harness `evidence_refs`。
- `report check`：按内容 SHA-256 检查台账、证据与输出；输入变化后旧报告返回 `ESTALE_REPORT`。

Bugfix 的 report 阶段只有在 `REPORT_FRESH` 时才能完成；缺失 evidence ref、部分验证和待真机验收都会如实显示。

## 后续 Agent 工作协议
见 `AGENTS.md` / `CLAUDE.md` 的「任务记忆协议」节。
