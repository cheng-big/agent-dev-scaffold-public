# 本方法论用到的 skill 清单

内置默认方法论（`process.template.json`）在各阶段引用下列 skill。可分发的 skill 本体位于本目录的 `../skills/<name>/`，复制脚手架后会随 `.agent/` 一起进入目标项目。
脚手架优先读取项目内 `.agent/skills/`，源模板开发时也读取 `dot-agent/skills/`，再读取项目 `.claude/skills/` 和用户全局目录。看板显示 `✓项目内置 / ✓全局已装 / ✗未装 / ?未知`。Skill 仍由你或 AI 显式调用，脚手架不会自动执行。

## 清单（阶段 → skill → 用途 → 证据级别）

> 映射按参考项目的实际实现核对。证据级别：**代码**=工作流脚本里有真实调用；**文档**=项目复盘或流程文档中的约定。

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

## 项目内置目录

以下 skill 已随仓库提供完整 `SKILL.md`，有配套资源的目录也一并提供：

- `kando-macro-architecture-extractor`
- `kando-product-spec-generator`
- `anti-omission-dev-blueprint`
- `dirty-data-probe`
- `kando-system-build`
- `flow-probe`
- `kando-gap-fill-driver`
- `debugging-and-error-recovery`
- `browser-testing-with-devtools`
- `code-reviewer`

`agent-skills:code-reviewer` 会解析为项目内的 `code-reviewer`。`agent-skills:debugging-and-error-recovery` 和 `agent-skills:browser-testing-with-devtools` 也会解析为对应的项目目录。

> **诚实边界**：`agent-skills:` 系列只在平台内核评审阶段使用 `code-reviewer`。其他阶段使用对应的系统构建、探针和缺口检查 skill。没有实际调用证据的 skill 不写入默认流程。

## 怎么确认装没装

```bash
node .agent/scripts/agent.mjs process status   # 每个阶段下会列出 skill 及 ✓已装/✗未装/?未知
```
`install` 完成时也会把「引用了但未检测到」的 skill 列出来提示。

## 缺少外部扩展时怎么办

- 默认清单里的 skill 已随模板提供。项目自行修改 `process.json` 后，如果引用了仓库没有的 skill，运行 `process status` 查看 `✗未装`。
- 外部 skill 放到项目 `.claude/skills/<name>/` 或用户全局 skill 目录，或者改用仓库内已有的等价 skill。
- **换一套方法论/换 skill**：直接改 `.agent/process.json` 的 `phases[].skills` 字段指向你用的 skill（如 `agent-skills:spec` / `agent-skills:build`），不用改任何代码。
- 其他 agent 平台可在 `scripts/lib/skills.mjs` 的 `skillLocations()` 里扩展根目录。AI 使用时读取 `.agent/skills/<name>/SKILL.md`，或按平台规范注册项目 skill 目录。
