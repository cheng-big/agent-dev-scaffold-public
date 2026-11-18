# UI Kit — 企业级中后台原子组件库（演示）

严格对齐 `DESIGN_SYSTEM.md`（gemini-code 规范）的**单文件、零依赖**组件演示。
中性冷灰（Slate/Zinc）基调，主品牌蓝仅占 5%~10%，状态确定性 + 键盘无障碍。

## 打开方式

**双击 `index.html` 即可**（通过 Tailwind Play CDN 加载，无需 `npm install` / 构建）。
> 首次打开需联网拉取 CDN；纯离线环境下 Tailwind 样式不会生效。

## 文件

| 文件 | 作用 |
| :--- | :--- |
| `tailwind.config.js` | 设计 Token 唯一真源（`darkMode:'class'` + Canvas/Surface/Subtle/Brand 语义色 + font-mono）。`index.html` 内联同一份；日后接入构建可直接复用。 |
| `index.html` | 全组件 + 标准布局的可交互演示页。 |

## 覆盖的组件与交互（对应规范章节）

- **Button**（§4.1）：Primary / Secondary / Ghost / Danger 四变体；`disabled` 禁用；「异步提交」点击后立即转 Loading（转圈 + 处理中…）并加 `pointer-events-none` 防重复提交。
- **Badge / Tag**（§2.2）：Success / Warning / Danger / Info，浅底 + 深字 + 弱描边 + 呼吸圆点（`animate-ping`）。
- **DataTable**（§4.2）：表头 `sticky` 固定、数值列右对齐 + `font-mono`、EmptyState 空状态、Skeleton 骨架屏（`animate-pulse`）、刷新半透明遮罩 Spinner。右上角按钮切换四态。
- **Modal / Drawer / Command Palette**（§4.3 / §3.3）：遮罩磨砂 `bg-slate-900/40 backdrop-blur`、`ESC` / 点遮罩关闭、Tab 键盘焦点锁定、关闭后焦点回归触发元素；危险确认按钮红色。`⌘K`（或 `Ctrl+K`）唤起命令面板。
- **Shell 布局**（§3）：`h-screen overflow-hidden flex` 视口锁定；可折叠 Sidebar（`w-64` ↔ `w-16`）；`h-16` 磨砂 Header；滚动仅发生在 `main.overflow-y-auto`。

## 约束

- 颜色严格取自规范的 Slate/Zinc 冷灰与 emerald/amber/rose/blue 状态色，**未自造高饱和奇异色**。
- 所有可交互元素统一挂 `.focus-ring`（`focus-visible:ring-2 ring-blue-500 ring-offset-2`）。
