# agent-dev-scaffold — 开发全流程方法论脚手架（可移植模板）

> 在「外部任务记忆」底座之上，加一层**方法论脚手架**：把一套开发方法论写成可配置的
> `process.json`，让 AI/你**一步步产出对应内容**；再用 `harness_evolver/` 把真实交付 Bug
> 逆向沉淀为下一批项目的阶段规则——每执行完一步命令末尾**直接提示下一步**，
> `next` 随时给唯一的下一步，`board` 生成 HTML 进度看板（**流程 / 记忆** 双 tab），
> `doctor` 自检记忆是否真被调用。仅使用 Node/Python 标准库，agent- 与 model-agnostic。

本仓是**源模板**：`dot-agent/` 会落到目标项目的 `.agent/`，`harness_evolver/` 原名落到项目根。不要在这里跑 `install`。

## 两个项目的关系

| 项目 | 定位 | 何时用 |
|---|---|---|
| **agent-task-memory** | 纯「任务记忆」层（+ doctor 记忆自检） | 只想要"防遗忘/可恢复"的记忆机制 |
| **agent-dev-scaffold（本仓）** | 记忆层 **+ 方法论脚手架 + 进度看板 + skill 引导** | 想按一套方法论、被引导着一步步开发 |

脚手架项目是记忆项目的**超集**：它自包含了完整的记忆层代码，再叠加流程编排/看板/skill。

## 它提供什么

- **记忆层**（继承自 agent-task-memory）：状态机 + 只追加 journal + 证据/决策/checkpoint + 有界上下文 + 完整 CLI；`doctor` 自检记忆是否被调用。
- **方法论脚手架层**：
  - `process.json` 把方法论写成数据（内置默认=读懂需求→逆向设计→页面契约→夯实地基→逐系统建造→做实验证→交付复盘 7 阶段 + 2 纪律带）。
  - **强引导**：每个改状态命令末尾自动附「下一步 →」；`next` 随时给唯一下一步（含该调哪个 skill、该读哪个输入真源）。
  - **产物真源=磁盘**：`artifact add` 登记，`next/board/status` 一律 `existsSync` 回读，缺失如实标 ✗。
  - **进度看板** `board`：自包含 HTML，**流程 tab**（地铁线当前站高亮 + 产出物总账 + skillband）/ **记忆 tab**（记忆概览 + 事件分布 + 任务卡片 + 决策 + 时间线）双 tab。
  - **skill 引导指针**：每阶段绑该调的 skill（不自动执行），看板标 ✓已装/✗未装。
- **外部写入硬门**：步骤声明 `--effect external-write --target ...` 后，只有每个目标都有独立上下文持久化回读 PASS 才允许提交/恢复。
- **可选 Bugfix Extension**：10 阶段流程，支持 Bug 登记、无损同步、影响面复核、证据归档和报告新鲜度检查。
- **反馈进化层 Harness Evolver**：批量解析历史反馈，归因到需求/数据库/编码/测试阶段，增量去重更新规则库，并在 `next/context/resume/phase start` 自动注入当前阶段。
- **自动反馈闭环**：会话内具体问题自动登记为 U/E 事实账，归档自动生成规则差异，delivery/report 阶段阻断未闭环反馈。

## 落地（把这套装到目标项目）

最省事：把 `dot-agent/INSTALL-PROMPT.md` 里那段**复制给目标项目里的 AI**，它会照着装并从需求文档起步。
手动四步：
```bash
cp -r dot-agent <目标项目>/.agent
cp -r harness_evolver <目标项目>/harness_evolver
cd <目标项目> && node .agent/scripts/agent.mjs install
node --test .agent/scripts/*.test.mjs
python3 -m unittest discover -s harness_evolver/tests -v  # 应 7/7 绿
```
`install` 自动把 Harness 工作协议注册到项目根 `AGENTS.md`，保留已有规则。之后 Codex 处理具体 Bug 时先登记，不等用户提醒。编辑 `.agent/PROJECT.md` 和 `.agent/process.json` 后，用 `node .agent/scripts/agent.mjs next` 起步。已有项目升级脚手架后重跑一次 `install` 即可注册协议。

`AGENTS.md` 是会话入口；`bug close` 是归档硬门禁。普通 Git 提交和推送不会触发归档。需保护主分支时，单独配置必过 CI 检查和分支保护。

- 升级已装旧版：见 `dot-agent/UPGRADE-PROMPT.md`。
- 方法论/字段/换 skill：见 `dot-agent/process/README.md`、`dot-agent/process/SKILLS.md`。
- 命令与用法详见 `dot-agent/README.md`，移植细节 `dot-agent/PORTING.md`。

## 日常（照着 next 走）

```bash
node .agent/scripts/agent.mjs next          # 现在该干啥（唯一答案，含该调的 skill + 输入真源）
node .agent/scripts/agent.mjs phase start <id>
#   → 用提示的 skill 产出内容，产完：
node .agent/scripts/agent.mjs artifact add --phase <id> --key <k> --path <真实路径>
node .agent/scripts/agent.mjs board --open  # 刷新看板（流程/记忆双 tab）
node .agent/scripts/agent.mjs doctor        # 自检记忆是否真被调用
node .agent/scripts/build_viewer.mjs        # 生成 docs/viewer.html：自动发现 docs/ 产物内嵌成单页可视化（双击即开，零依赖）；看板产物总账可点开
node .agent/scripts/agent.mjs feedback evolve  # 只用已归档反馈生成规则差异
node .agent/scripts/agent.mjs feedback list  # 查看会话内自动登记的问题
```

## 外循环：项目如何反哺脚手架

`harness_evolver/history/2026-08-equipment-inspection-retrospective.md` 是内置的设备巡检示例。脚手架已从中建立 4 阶段事实账和规则库；新项目安装后直接继承这些防御规则。项目交付或 Bugfix 报告归档时，再运行：

```bash
node .agent/scripts/agent.mjs feedback evolve
cat harness_evolver/reports/LATEST.md
```

默认走确定性离线归因；只有显式传 `--use-llm auto|always` 才使用已配置的 OpenAI-compatible endpoint。状态、规则和报告均在 `harness_evolver/` 内，重复输入按 SHA、分析器版本和分析配置增量处理并去重。

> **产物可视化**：`build_viewer.mjs` 自动发现 `docs/` 下 architecture/blueprints/probes/product 的 JSON/YAML/MD，内嵌成一个自包含 `docs/viewer.html`（概览/菜单树/页面契约/数据模型/状态机/探针/API/异常警报/原文 分 Tab，双击即开、无需服务器）。产物变更后重跑刷新；已声明为 reverse-design 阶段产物，看板"产出物总账"可直接点开。

> **Bug 修复项目**：运行 `node .agent/scripts/agent.mjs install --workflow bugfix`。已有开发流程时，继续用 `--workflow bugfix` 选中独立的 Bugfix 进度。

Bug 修复前用 `bug add --title ".." --symptom ".."` 登记，或用 `bug sync --file` 同步外部台账。改完运行 `impact-check --bug <id>`。验证通过后运行 `bug close <id>`，把事实和证据归档到项目复盘，并更新本地 Harness 规则。用 `--scaffold-candidate ".."` 单独记录可提交给通用脚手架的建议。通用脚手架不会自动修改。

归档前必须通过 Bug 专属静态规则或运行时回归、禁止注释规则的正反例和全项目 Lint，并提供截图或视频。项目按 [Bugfix 校验接入说明](dot-agent/process/BUGFIX-LINT.md) 配置工具。

日常按看板的「下一步」推进。原 HTML 仍是进度入口，新增「知识」页，显示功能需求、验收依据和交付证据。安装时创建项目知识索引；使用方法见 [项目知识库](dot-agent/process/PROJECT-KNOWLEDGE.md)。

---

作者个人网站：<https://www.toop.club/>
