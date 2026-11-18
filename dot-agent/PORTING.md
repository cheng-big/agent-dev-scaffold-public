# PORTING — 把 Harness 移植到新项目

这套 Harness 包含两个安装单元：`.agent/` 提供任务记忆、流程编排与证据门，`harness_evolver/` 提供交付反馈的归因、规则进化和阶段注入。两者都只使用标准库（Node + Python），与业务技术栈解耦。

## 一、三步落地（机器上有 node 与 python3）

```bash
# 1) 从模板仓库拷两个安装单元
cp -r /path/to/agent-dev-scaffold/dot-agent <新项目>/.agent
cp -r /path/to/agent-dev-scaffold/harness_evolver <新项目>/harness_evolver

# 2) 一键安装（幂等，可反复跑）：建运行时目录+.gitkeep、生成 PROJECT.md、追加 .gitignore
cd <新项目> && node .agent/scripts/agent.mjs install

# 3) 自测（Node 57/57；Python 7/7）
node --test .agent/scripts/*.test.mjs
python3 -m unittest discover -s harness_evolver/tests -v
```

`.agent` 需带：`scripts/`、`schemas/`、`process/`、文档与 `PROJECT.md.template`；同时完整携带 `harness_evolver/`，其中的 bundled history、state 和 knowledge base 是新项目继承历史防御能力的依据。
`FEEDBACK-PROTOCOL.md` 会被 `context/resume` 始终注入，保证身份文件精简后自动记录规则仍然生效。
`install` 也会将会话入口注册到项目根 `AGENTS.md`。Codex 读取此入口后，无需用户提示即可登记 Bug。以下协议供查阅，不用再手工复制到 Codex 的 `AGENTS.md`。
运行时目录（tasks/journal/decisions/evidence/checkpoints）由 `install` 现建，无需拷。

## 二、针对新项目适配（收敛成 2 必改 + 3 可选）

### 必改 1 —— 填 `.agent/PROJECT.md`（身份来源）
`install` 会从 `PROJECT.md.template` 生成 `.agent/PROJECT.md`。**编辑它**，写清本项目的身份、不可违反规则、真源、DoD 通则。
`context/resume` 的「你是谁」直接读这里——**这是适配的核心，通常不用改任何代码**。
（若不填 PROJECT.md，机制会自动回退探测 `AGENTS.md/CLAUDE.md/CONTRIBUTING.md/README.md`，但填了更准。）

### 必改 2 —— 确认 `.gitignore` 边界
`install` 已幂等追加运行时忽略规则。确认新项目里：**提交** `scripts/ schemas/ README.md PORTING.md PROJECT.md(.template) + .gitkeep`；**忽略** `ACTIVE_TASK.json / tasks / journal / decisions / evidence / checkpoints`（每机每会话状态，提交必冲突）。

### 可选 3 —— 把工作协议接进新项目的 Agent 规范
把下面这段贴进新项目的 `AGENTS.md` / `CLAUDE.md` / `README`（有哪个用哪个）：

```markdown
## 任务记忆协议（外部状态，详见 .agent/README.md）
- 每个新会话/恢复先跑：`node .agent/scripts/agent.mjs resume`
- 重要步骤：start-step → 操作 → 核对真实结果 → evidence → verify → commit-step；失败 fail-step。无 step_committed 不算完成。
- 仅 DoD 全 met+有证据、经 verifying 才 complete；不凭聊天摘要宣布完成。
- 压缩/会话结束/阶段结束前 checkpoint；TASK 快照 ≤16KB，历史进 journal/checkpoint。
- 边界：无跨系统 ACID（幂等+补偿+reconciliation）；平台压缩不可强制拦截，钩子仅增强。
- 第三方写入步骤用 `--effect external-write --target <稳定目标>`；无独立上下文 `external-readback: PASS` 禁止 commit/reconcile。
```

### 可选 4 —— 压缩前/开机钩子（仅 Claude Code）
若新项目也用 Claude Code，在其 `.claude/settings.json` 挂 `PreCompact`→`checkpoint --auto`、`SessionStart`→`context`（参考本仓库 `.claude/settings.json`）。**核心机制不依赖钩子**，失效时手动跑同名命令兜底。

### 可选 5 —— DoD/约束措辞本地化
`init` 时用新项目自己的完成标准，别照抄别的项目字样。

## 三、新项目脚本层不是 Node（且不想引入 node）

设计与语言无关：**保持目录契约 + JSON/JSONL 格式 + `schemas/` 三个 schema 不变**（它们是接口），用主语言重写 `scripts/`——把 `store/journal/statemachine/context` 的逻辑一一对应翻译即可，不用重新设计。

## 四、反馈进化层

`next/context/resume/phase start` 会自动按当前 phase、worklist 和目标路径注入对应阶段规则。项目产生新的 Bug 沟通或交付复盘后运行：

```bash
node .agent/scripts/agent.mjs feedback evolve  # 自动只读取 docs/retrospective/已归档反馈.md
python3 -m harness_evolver.context_injector --stage CODING --tech-stack "项目技术栈"
```

把下面协议一并贴进项目 `AGENTS.md` / `CLAUDE.md`：

```markdown
## Harness 反馈进化协议（详见 harness_evolver/README.md）
- 每条用户消息先判断是否明确描述当前项目的具体问题；命中 `问题/bug/报错/异常/失败/不对/不应该/打不开/不能/缺失/遗漏/不好用/需要修复` 时，在处理前运行 `node .agent/scripts/agent.mjs feedback add --source user --title ".." --symptom ".."`。
- “没有问题”、假设性讨论、引用文本和泛化 Bug 管理问题不得自动登记；工程失败只有复现或有证据后才能以 `--source engineering` 登记。
- 用户说 `记入复盘` 时立即登记当前具体问题；说 `生成规则差异`、`执行evolve`、`复盘归档` 或 `项目复盘` 时运行 `node .agent/scripts/agent.mjs feedback evolve`。
- 确认根因和处置后运行 `feedback close <id> --root-cause ".." --resolution ".."`；它自动运行离线 Evolver。delivery/report 阶段 complete 会阻断未闭环反馈，并在复盘变化时自动生成差异报告。
- 自动触发依赖当前 Agent 会话遵守本协议；CLI 不宣称能后台监听会话外的聊天。
- `next/context/resume/phase start` 注入的历史规则是附加硬约束；若与本项目真源冲突，以项目真源为准并记录冲突。
- `harness_evolver/state/`、`knowledge_base/`、`history/`、`reports/` 是项目累积知识，升级时不得覆盖或删除。
- LLM 为显式可选增强；默认 `never`，只有命令明确传 `--use-llm auto|always` 才允许外发已脱敏反馈。
```

## 五、验证与卸载

- 验证落地：`node .agent/scripts/agent.mjs install && node --test .agent/scripts/*.test.mjs && python3 -m unittest discover -s harness_evolver/tests -v`
- 首个任务：`node .agent/scripts/agent.mjs init --objective "..." --dod "..." && node .agent/scripts/agent.mjs resume`
- 卸载：先备份需保留的 `harness_evolver/history|state|knowledge_base|reports`，确认后再删除 `.agent/` 与 `harness_evolver/`，并移除 `.gitignore` 里 `# .agent 任务记忆运行时` 段。Evolver 知识可能已提交到 Git，也可能仅存在本机，不能把删除 `.agent/` 误报为完整卸载。

## 六、目录一览

```
.agent/
├── PORTING.md            本文（移植指南，committed）
├── README.md             用法/命令/纪律（committed）
├── PROJECT.md.template   身份模板（committed）
├── PROJECT.md            ← install 生成，按新项目填（committed）
├── FEEDBACK-PROTOCOL.md  自动问题登记与关键词触发协议（committed，始终注入）
├── process/              方法论脚手架层：process.template.json + README + SKILLS.md（committed）
├── process.json          ← install 从模板生成，按新方法论编辑（committed）
├── schemas/              JSON Schema（语言无关，committed）
├── scripts/              零依赖 Node CLI + lib + 测试（committed）
├── process-state.json    ← 运行时：当前阶段/阶段↔task 映射/产物登记（忽略）
├── board.html            ← 运行时：生成的看板（忽略）
└── tasks|journal|decisions|evidence|checkpoints/  运行时（.gitkeep 提交，内容忽略）
harness_evolver/
├── bug_analyzer.py | pipeline_evolver.py | context_injector.py
├── knowledge_base/      四阶段规则库（Baseline + 托管规则）
├── history/             随脚手架传播的真实反馈快照
├── state/               结构化 Bug 事实与聚类规则
└── reports/             每轮能力进化报告
docs/retrospective/
├── feedback.jsonl       自动反馈结构化真源（提交）
├── evolution.json      最近成功演进指纹/报告（提交）
├── 已归档反馈.md         只含已闭环记录的 Evolver 输入（提交）
└── 项目复盘待办.md       自动渲染的人读文档（提交）
```

### 可选 6 —— 用方法论脚手架层（阶段编排 + 强引导 + 看板）
`install` 已顺带从 `process/process.template.json` 生成 `.agent/process.json`（内置默认 7 阶段方法论）。
想换方法论**只改 `process.json`**（改 `skills` 指向你用的 skill、`artifacts.path` 指向你项目产物位置），不用改代码。
日常：`process init`（若没跑过 install）→ `next`（看下一步）→ `phase start <id>` → 产出后 `artifact add` → `board` 出看板。
字段说明见 `process/README.md`；本方法论引用的 skill 清单（**不随模板打包**，是引导指针）见 `process/SKILLS.md`。

**把下面这段「方法论脚手架协议」贴进新项目的 `AGENTS.md` / `CLAUDE.md`**（让后续 AI 会话遵守引导闭环）：

```markdown
## 方法论脚手架协议（启用 process 层时，详见 .agent/process/README.md）
- 开工/接手先跑 `node .agent/scripts/agent.mjs next`，照它给的**唯一下一步**做，不要自己跳阶段。
- 进入阶段：`phase start <id>`；该阶段该调哪个 skill 见提示（skill 是引导指针，需你显式调用，不自动执行；缺哪个见 process/SKILLS.md）。
- 每产出一个产物，必须 `artifact add --phase <id> --key <k> --path <真实路径>` 登记 —— **产物真源是磁盘**，登记≠存在，缺失如实标 ✗，不假绿。
- 每步做完看命令末尾的「下一步 →」；阶段收尾走记忆层硬门（verify + 每条 DoD met+证据 + complete），不凭摘要宣布完成。
- 要对齐/汇报进度：`board` 生成看板（当前站高亮 + 产出物总账），别手写进度。
- **新会话首次回复**：先跑 `resume`（会自动刷新看板），并把它输出的「📊 进度看板：<地址>」原样告诉用户——让人知道去哪查看，不用来问。
```

### 可选 7 —— 启用 Bug 修复全流程

```bash
node .agent/scripts/agent.mjs install --workflow bugfix
node .agent/scripts/agent.mjs bug import --file .agent/inbox/bugs.csv
node .agent/scripts/agent.mjs report
node .agent/scripts/agent.mjs report check   # 必须输出 REPORT_FRESH
```

已有开发流程时，安装命令另建 `.agent/process-bugfix.json`；用 `next --workflow bugfix`、`phase start <id> --workflow bugfix`、`resume --workflow bugfix` 推进，原开发配置和进度保留。已有旧 Bugfix 配置时同样不覆盖；需要完整流程时，核对旧进度后再手工加入 `reconcile` 阶段并更新 `verify` 的依赖。

把以下规则加入项目 Agent 协议：具体 Bug 在修复前运行 `bug add` 或引用已导入的 Bug ID，不再重复运行 `feedback add`。修复后运行 `impact-check`，复测通过后运行 `bug close`，然后生成报告。归档结果更新项目 Harness；可跨项目复用的改进用 `--scaffold-candidate` 另行提出，不自动修改源模板。

先确定能阻止 Bug 复发的检查方式：优先用静态规则，静态无法判断时用运行时回归；修复后提供截图或视频。项目 Lint 与 CI 的接入方式见 `process/BUGFIX-LINT.md`。迁移前保留 `docs/knowledge/index.json` 及引用文件，接入方法见 `process/PROJECT-KNOWLEDGE.md`。
