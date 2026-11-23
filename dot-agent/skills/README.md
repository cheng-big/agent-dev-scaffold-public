# 项目内置 Skills

这些目录随 `.agent/` 一起复制到目标项目。每个目录的 `SKILL.md` 是该 skill 的入口，`assets/` 和 `references/` 是它的配套文件。

AI 开始某个阶段时，先读取 `.agent/process/SKILLS.md`，再读取对应的 `.agent/skills/<name>/SKILL.md`。脚手架只负责提示和检查，不会自动执行 skill。

更新项目内置 skill 时，保持目录名与 `process.template.json`、`bugfix.template.json` 中的名称一致。带 `agent-skills:` 前缀的名称会自动尝试去掉前缀，例如 `agent-skills:code-reviewer` 对应 `code-reviewer/`。
