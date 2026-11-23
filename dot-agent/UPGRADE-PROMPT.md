# UPGRADE-PROMPT — 一段话丢给大模型，把已装的旧版 `.agent` 升级到新版

> 场景：某项目已经装过旧版 `.agent`，升级到含 Harness Evolver 的完整脚手架。
> 用法：把「====」之间整段复制给那个项目里的 AI，`<新模板仓库路径>` 换成 `agent-dev-scaffold` 的真实路径。
>
> 核心安全原则：**只更新代码/schema/文档，绝不动 `.agent` 运行时数据或项目已经积累的 Evolver 知识。**

====
请把本项目已有的 `.agent`（旧版：只有任务记忆层）**升级**到新版，严格按下面做，每步做完如实报告，任一步失败就停下：

0. **先调查再动手**：`git status`。确认 `.agent/scripts` 与 `.agent/schemas` 里**没有本项目的本地改动**（若有，先告诉我，别覆盖）。以下是「我的数据 / 运行时」，**全程绝不能覆盖或删除**：
   `.agent/PROJECT.md`、`.agent/process.json`（若已存在）、`.agent/bugs.json`、`.agent/bugs/`、`.agent/reports/`、`.agent/arch-map.md`、`.agent/tasks/`、`.agent/journal/`、`.agent/decisions/`、`.agent/evidence/`、`.agent/checkpoints/`、`.agent/ACTIVE_TASK.json`、`.agent/process-state.json`、`.agent/board.html`。
   若已有 `harness_evolver/`，其 `state/`、`knowledge_base/`、`history/`、`reports/`、`config.json` 也是项目知识，**禁止覆盖**。
   另保留 `.agent/process-bugfix.json`、`.agent/process-bugfix-state.json`、`.agent/ACTIVE_BUGFIX_TASK.json`、`.agent/board-bugfix.html` 和 `docs/retrospective/`。

1. **拷新版的「可提交」部分**覆盖到本项目 `.agent/`（这些是代码/schema/文档，不含任何运行时数据）：
   ```bash
   T=<新模板仓库路径>/dot-agent
   cp -R "$T/scripts/." .agent/scripts/     # 覆盖 agent.mjs + lib/（新增 process/board/skills）+ process.test.mjs
   cp -R "$T/schemas/." .agent/schemas/     # 新增 process.schema.json、process-state.schema.json
   cp -R "$T/process"   .agent/             # 新增 process/（process.template.json + README + SKILLS）
   mkdir -p .agent/skills
   for skill in "$T"/skills/*; do
     name="$(basename "$skill")"
     test -e ".agent/skills/$name" || cp -R "$skill" .agent/skills/
   done                                      # 新增项目内置 skill，不覆盖项目已有 skill
   cp "$T/README.md" "$T/PORTING.md" "$T/INSTALL-PROMPT.md" "$T/UPGRADE-PROMPT.md" "$T/FEEDBACK-PROTOCOL.md" .agent/
   ```
   注意：源模板里没有运行时数据文件、也没有 `PROJECT.md`/`process.json`，所以上面的 `cp` **不会**碰到我的数据。

2. **安装或升级 Harness Evolver**：
   ```bash
   H=<新模板仓库路径>/harness_evolver
   if [ ! -d harness_evolver ]; then
     cp -R "$H" ./harness_evolver
   else
     cp "$H/__init__.py" "$H/bug_analyzer.py" "$H/context_injector.py" \
        "$H/evolve.py" "$H/llm_mapper.py" "$H/models.py" \
        "$H/pipeline_evolver.py" "$H/README.md" harness_evolver/
     mkdir -p harness_evolver/tests
     cp -R "$H/tests/." harness_evolver/tests/
   fi
   ```
   已存在时只升级实现与测试，不覆盖项目的规则、事实账、历史、报告和阶段覆盖配置。新版默认阶段映射会与旧 `config.json` 合并。

3. **跑升级安装**（幂等；不会覆盖已有 PROJECT.md/运行时/用户已有 hook）：
   ```bash
   node .agent/scripts/agent.mjs install
   node .agent/scripts/agent.mjs hook install   # 若上一步提示无 .git 而后来才 git init，可单独补装
   ```
   `install` 自动注册项目根 `AGENTS.md` 的 Harness 区块，保留其他规则；不需要重复粘贴协议。

4. **自测**：
   ```bash
   node --test .agent/scripts/*.test.mjs
   python3 -m unittest discover -s harness_evolver/tests -v
   ```
   两个命令都必须通过。若有失败，停下并报告失败项。

5. **确认旧数据与注入完好**：
   ```bash
   node .agent/scripts/agent.mjs doctor    # 原有任务数 / journal 事件应仍在
   node .agent/scripts/agent.mjs resume    # 能读出原任务上下文
   python3 -m harness_evolver.context_injector --phase root-cause
   ```
   若项目已有 `docs/retrospective/项目复盘待办.md` 且尚无 `feedback.jsonl`，运行一次 `feedback import --file docs/retrospective/项目复盘待办.md`，确认 `.legacy.md` 备份和结构化账本均可回读。

6. **确认方法论**：确认 `AGENTS.md` 已注册 Harness 区块，再按需编辑 `.agent/process.json` 的阶段和输入。
   - **注意**：若你**已有旧版 `process.json`**（install 不覆盖它），新版模板把「页面契约·约束优先」独立成一个阶段（原 6 阶段→7 阶段，`blueprint` 从逆向设计迁到新阶段、产 JSON+渲染 HTML 两份）——想用这个新阶段，对照 `process/process.template.json` 手动把 `page-contract` 阶段并入你的 `process.json` 并顺延后续阶段 `no`。

7. **报告**：新增了哪些能力、自测结果（Node X/57、Python X/7）、`doctor`/`resume` 是否证明旧数据完好、自动反馈协议是否接入、Evolver 注入了哪个阶段、还需我确认什么。
====

## 这次升级新增了什么（相对只有记忆层的旧版）

- **命令**：`process init/status`、`next`、`phase start <id>`、`artifact add/list`、`system add/list`、`worklist set`、`board`、`hook install`、`doctor`、`repo-map`、`bug import/sync/list`、`report/check`
- **新文件**：`scripts/lib/{process,board,skills,hook,effects,bugimport,repomap,report,feedback,evolution-gate}.mjs`、`scripts/{process,external-effects,bugfix,feedback}.test.mjs`、`schemas/{process,process-state,bug}.schema.json`、`process/`（默认模板+Bugfix模板+README+SKILLS）、`INSTALL-PROMPT.md`、`UPGRADE-PROMPT.md`
- **改的文件**：`scripts/agent.mjs`（加新命令 + 下一步收口 + 看板地址 + 装 git hook + doctor）、`README.md`、`PORTING.md`
- **看板增强**：流程 tab「逐系统开发任务清单」矩阵（`worklist` + `system`/`worklist set` 驱动）、任务卡片展开「阶段验收 DoD」、产物/依据路径可点跳转、`post-commit` 提交后自动刷新
- **方法论**：新增独立阶段「页面契约·约束优先」（原 6→7 阶段），产页面契约 JSON + 渲染 HTML 两份；默认 skill 随 `.agent/skills/` 分发
- **证据硬门**：`external-write` 步骤要求每个目标都有独立上下文持久化回读 PASS；恢复流程也不能绕过。
- **Bugfix**：源状态/验证状态分离；报告读取 Markdown/JSON/图片/harness evidence，并用 `report check` 拒绝 stale 输出。
- **Harness Evolver**：历史反馈四阶段归因、规则去重、能力进化报告，以及 `next/context/resume/phase start` 动态注入。
- **Feedback Auto-Trigger**：会话内问题关键词自动登记、结构化复盘账本、归档自动 Evolver、delivery/report 完成门禁。
- **兼容**：`task.mjs`/`journal.mjs` 会为旧 open_step 补默认 effect/targets；不会改写或删除现有运行时数据。
