# 本方法论用到的 skill 清单（引用，不随模板打包）

内置默认方法论（`process.template.json`）在各阶段**引用**下列 skill 作为「该调哪个 skill」的引导指针。
**这些 skill 的本体不随本模板打包**——它们是你环境里自建/安装的 skill，住在 `~/.claude/skills/<name>/`（或项目 `./.claude/skills/<name>/`）。
脚手架只打印 skill 名、并探测它是否已装（`✓已装 / ✗未装 / ?未知`），**不自动执行**；实际起动由你/AI 走正常的 Skill 机制。

## 清单（阶段 → skill → 用途 → 证据级别）

> 映射按 `xzPrdV2` 真实实现核对。证据级别：**代码**=workflows/*.mjs 里有 `agentType` 真调用；**文档**=复盘 HTML / DAG-PLAYBOOK 等事后归纳。

| 阶段 | skill | 用途 | 证据 |
|---|---|---|---|
| 01 读懂需求 · 02 逆向设计 | `kando-macro-architecture-extractor` | 从原型 PDF 提取 L0 架构 / L2 页面契约 / L4 探针 | 文档 |
| 02 逆向设计 | `kando-product-spec-generator` | 架构产物 → 六类产品交付物 | 文档 |
| 02 逆向设计 | `anti-omission-dev-blueprint` | 纯文本 PRD（无原型）防漏蓝图 | 文档 |
| 02 逆向设计 · 05 做实验证 | `dirty-data-probe` | 脏数据探针穿透（跨端五段式生命周期） | 文档 |
| 03 夯实地基 · 04 逐系统建造 | `kando-system-build` | Spring Modulith + Vue3 全栈闭环（= xz-system.mjs / xz-foundation-build.mjs） | 代码 |
| **03 夯实地基（评审步）** | `agent-skills:code-reviewer` | 平台内核模块评审（identity/auth/message…） | **代码** `xz-foundation-build.mjs:194-196` |
| 05 做实验证 | `flow-probe` | 浏览器真流程测试（跨端逐步 + 后端回查） | harness 实现 |
| 06 交付复盘 | `kando-gap-fill-driver` | 文档↔代码缺口分析 + 查漏补缺 | 文档（仅复盘 HTML 单处） |

> **诚实边界**（核对发现）：① `agent-skills:` 系列在 `xzPrdV2` 只在**阶段03 内核评审**用了 `code-reviewer`（唯一代码级证据）；`BUILD-LEDGER.md` 另有一句 `/loop` 走 `agent-skills:plan/build/review/test/ship` 的**文字约定**，但无脚本落地。② 阶段 04 逐系统建造是**纯 kando-system-build**，未渗入 agent-skills。③ `kando-usability-closure`、`prd-ux-*` 全仓无引用，故不写进默认 process.json。

## 怎么确认装没装

```bash
node .agent/scripts/agent.mjs process status   # 每个阶段下会列出 skill 及 ✓已装/✗未装/?未知
```
`install` 完成时也会把「引用了但未检测到」的 skill 列出来提示。

## 缺 skill 怎么办

- 这些 skill **不是本模板的一部分**，缺了不影响记忆层/脚手架层本身运行——只是 `next` 提示里那个 skill 你手上没有。
- 自行获取并放到 `~/.claude/skills/<name>/`（Claude Code 布局），或改用你自己的等价 skill。
- **换一套方法论/换 skill**：直接改 `.agent/process.json` 的 `phases[].skills` 字段指向你用的 skill（如 `agent-skills:spec` / `agent-skills:build`），不用改任何代码。
- 探测路径面向 Claude Code（`.claude/skills`）；其他 agent 平台可在 `scripts/lib/skills.mjs` 的 `skillRoots()` 里扩展根目录。
