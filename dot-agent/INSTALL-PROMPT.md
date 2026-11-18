# INSTALL-PROMPT — 一段话丢给大模型，让它把这套装进新项目

> 用法：把下面「====」之间整段**复制给新项目里的 AI**（Claude Code / Codex / Cursor 等），
> 把 `<模板仓库路径>` 换成 `agent-dev-scaffold` 仓库路径，把 `<需求文档路径>` 换成本项目需求文档位置。
> 前提：目标机器有 `node` 与 `python3`（与业务语言无关）。

====
请把这套「任务记忆 + 方法论脚手架」装到本项目，并带我起步。严格按下面做，每步做完如实报告，任一步失败就停下报告、不要往下走：

1. **先调查**：读本项目 README / 构建方式 / 测试方式 / 是否已有 `.agent`；看 `git status` 保护未提交改动。已装过就别重复装。
2. **拷贝两个安装单元**：
   ```bash
   cp -r <模板仓库路径>/dot-agent ./.agent
   cp -r <模板仓库路径>/harness_evolver ./harness_evolver
   ```
3. **安装**（幂等）：开发项目运行 `node .agent/scripts/agent.mjs install`；以修 Bug 为主的项目运行 `node .agent/scripts/agent.mjs install --workflow bugfix`。
   —— 它会建运行时目录、生成 `.agent/PROJECT.md` 与 `.agent/process.json`、追加 `.gitignore`，并检测方法论引用的 skill 装没装。
4. **自测**：
   ```bash
   node --test .agent/scripts/*.test.mjs
   python3 -m unittest discover -s harness_evolver/tests -v
   ```
   两个命令都必须通过。若有失败，停下并报告失败项。
5. **填身份**：编辑 `.agent/PROJECT.md`，写清本项目身份 / 不可违反规则 / 真源 / DoD 通则；把**本项目需求文档位置**写进「真源」一节。
6. **确认协议**：检查 `install` 是否在项目根 `AGENTS.md` 注册 Harness 区块，并保留原有规则。具体 Bug 按区块规定先登记，不需要用户另行提醒。
7. **对齐方法论**：打开 `.agent/process.json`——
   - 把阶段 01 `inputs` 里需求文档的 `path` 改成本项目真实路径：`<需求文档路径>`；
   - 若默认 7 阶段（读懂需求→逆向设计→页面契约→夯实地基→逐系统建造→做实验证→交付复盘）不适用本项目，改 `phases`（阶段 / `skills` / `artifacts.path`）换成本项目的方法论。字段说明见 `.agent/process/README.md`，用到的 skill 见 `.agent/process/SKILLS.md`。
   - 若选择 Bugfix，把 `intake` 输入改成真实 Bug 清单；无清单时用 `bug add` 登记。
   - 若已存在 `docs/retrospective/项目复盘待办.md` 但没有 `feedback.jsonl`，先运行 `node .agent/scripts/agent.mjs feedback import --file docs/retrospective/项目复盘待办.md`；CLI 会备份旧原文后再切换为结构化账本，禁止直接覆盖。
8. **确认反馈外循环**：运行 `python3 -m harness_evolver.context_injector --stage REQUIREMENT`，输出必须包含「历史交付质量反馈」和 Stage 1；已有本项目反馈文档时，登记其路径但不要擅自发送给外部 LLM。
9. **起步**：跑 `node .agent/scripts/agent.mjs resume`（会自动生成/刷新进度看板并打印其地址），**把输出里那行「📊 进度看板：<地址>」原样告诉我**，让我知道去哪看进度。再跑 `next`，确认输出含当前阶段的历史规则，再照它给的**唯一下一步**做。
10. **报告**：告诉我安装内容、自测结果、自动反馈协议是否接入、Evolver 注入的阶段、缺哪些 skill、流程配置还需确认什么。
====

## 装完之后的日常（引导闭环）

```
node .agent/scripts/agent.mjs next                     # 随时问：现在该干啥（唯一答案）
node .agent/scripts/agent.mjs phase start <phase-id>   # 进入它让你进的阶段
（照提示读输入真源、调对应 skill 产出内容）
node .agent/scripts/agent.mjs artifact add --phase <id> --key <k> --path <真实路径>   # 登记产物（磁盘回读✓✗）
node .agent/scripts/agent.mjs board --open             # 生成看板：当前站高亮 + 产物在哪 + skill 装没装
python3 -m harness_evolver.evolve --input-docs <复盘.md|目录>  # 交付反馈反哺下一轮
```
核心一句：**每敲完一条命令，看末尾「下一步 →」照做。** 详见 `README.md` / `process/README.md`。
