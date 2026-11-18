# 自动反馈协议

- 当前项目的具体 Bug 先运行 `node .agent/scripts/agent.mjs bug add --title ".." --symptom ".."`，或引用已导入的 ID。不要为同一 Bug 再执行 `feedback add`。
- 确认根因后，先定义可执行的防复发检查，再修业务代码。静态问题使用 Lint 正反例；运行时问题使用回归用例。无法提供可执行检查时，不把 Bug 标为已归档。
- 项目代码禁止行注释和块注释，也禁止用注释绕过 Lint。用更清楚的变量名或单元测试说明意图。全项目 Lint 必须启用禁止注释规则。
- 改完先运行 `impact-check --bug <id>`，再验证复现路径和受影响功能，把截图或视频放入 Bug 的 `evidence/`。非界面修复可截取实际命令和结果。`bug close <id>` 运行全项目 Lint 和防复发检查，再关联证据与项目复盘。
- 可跨项目复用的改进由 Agent 通过 `bug close <id> --scaffold-candidate ".."` 提交待审建议。该参数不会写入通用源模板。范围不明确时，有已授权的 Jev 接入才用脱敏摘要分类；不能确定时由 Codex 核查，保留为项目记录。
- 以下 `feedback` 命令用于不属于具体 Bug 的项目反馈。
- 每条用户消息先判断是否明确描述当前项目的具体问题。
- 命中 `问题/bug/报错/异常/失败/不对/不应该/打不开/不能/缺失/遗漏/不好用/需要修复` 时，在处理前执行 `node .agent/scripts/agent.mjs feedback add --source user --title ".." --symptom ".."`。
- “没有问题”、假设性讨论、引用文本、泛化 Bug 管理问题不得自动登记。
- 工程错误只有复现或有证据后执行 `node .agent/scripts/agent.mjs feedback add --source engineering`。
- 用户说 `记入复盘` 时立即登记当前具体问题。
- 用户说 `生成规则差异/执行evolve/复盘归档/项目复盘` 时执行 `node .agent/scripts/agent.mjs feedback evolve`。
- 确认根因和处置后执行 `node .agent/scripts/agent.mjs feedback close <id> --root-cause ".." --resolution ".."`；不得凭关键词猜根因或归档。
- delivery/report 的 `complete` 会阻断未闭环反馈，并在归档输入变化时自动运行离线 Evolver。
- 自动触发仅在当前 Agent 会话内生效，不宣称后台监听会话外聊天。
