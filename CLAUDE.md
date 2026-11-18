# CLAUDE.md — 项目级约定

> 本文件在每次会话自动加载，补充（不替代）全局规则。

## 中后台前端规范（Admin / Dashboard UI）

凡涉及**管理后台 / 中后台 / dashboard** 类页面或组件，必须遵循 `ui-kit/` 的设计与交互规范：

- **颜色只取 Token**：一律使用 `ui-kit/tailwind.config.js` 定义的语义色（Canvas / Surface / Subtle / Brand）与状态色（emerald / amber / rose / blue）。**严禁自造高饱和奇异色**；主品牌色占屏 ≤10%。暗黑模式用 `class` 策略。
- **焦点无障碍**：所有可交互元素必带 `.focus-ring`（`focus-visible:ring-2 ring-blue-500 ring-offset-2`）。
- **状态确定性**：处理网络请求的按钮/表单必须实现 Loading（转圈 + 处理中…）+ Disabled 防重复提交。
- **数据表格**：表头 `sticky` 固定；数值列右对齐 + `font-mono`；必配空状态 EmptyState 与骨架屏 Skeleton。
- **弹出层**：Modal / Drawer 需遮罩磨砂、`ESC` / 点遮罩关闭、键盘焦点锁定；危险确认按钮用红色 + 确定性文案（如“确认删除”）。
- **参考样板**：`ui-kit/index.html`（全组件可交互演示）、完整规范见 `ui-kit/README.md`。

> 冲突处理：若本仓其他设计 skill（如 `gk-design-system` / `frontend-design`）的美学与本规范不一致，**中后台页面以本规范为准**，另一套标记为待清理，不要强行融合。
