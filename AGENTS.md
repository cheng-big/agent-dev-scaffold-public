# Harness 工作协议

本仓是源模板，不在本仓运行 `install`。处理本仓的真实 Bug 时，从仓库根目录使用 `node dot-agent/scripts/agent.mjs`。

- 不等用户提醒。收到或发现当前项目的具体 Bug，先运行 `bug list`。使用已有 ID，或用 `bug add --title "..." --symptom "..."` 登记，再修改代码。功能需求、假设和引用示例不登记为 Bug。
- 按 `dot-agent/FEEDBACK-PROTOCOL.md` 执行。先定位根因，再选静态 Lint 或运行时回归检查。用清楚的命名或单元测试说明逻辑，不写代码注释。
- 修复完成后运行 `impact-check`，只验证复现路径和受影响功能。取得实际截图或视频后运行 `bug close <id>`。缺配置、规则或证据时，报告缺项，保留未归档状态。
- 不重复登记普通反馈。归档由 CLI 更新项目 Harness。用 `--scaffold-candidate` 单独记录通用改进，不自动修改上游。
