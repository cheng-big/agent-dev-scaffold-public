/**
 * tailwind.config.js — 企业级中后台 UI Kit 设计 Token
 * 严格对齐 DESIGN_SYSTEM.md（gemini-code）§2 Design Tokens。
 *
 * 用法：
 *  - 本仓 zero-dependency：ui-kit/index.html 通过 Tailwind Play CDN 内联同一份 config，双击即开。
 *  - 若日后接入构建：`npm i -D tailwindcss` 后本文件可直接复用。
 *
 * 铁律：暗黑模式使用 class 策略；语义 Token 均映射到规范中的 Slate/Zinc 冷灰及状态色，
 *      严禁在业务代码里发明高饱和奇异色。
 */
module.exports = {
  darkMode: 'class',
  content: ['./**/*.{html,js,jsx,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // —— 结构层（画布 / 容器 / 次级背景），dark 变体附 -dark 后缀 ——
        canvas: { DEFAULT: '#F8FAFC', dark: '#0B0F19' }, // 全局外层底色，吸收眩光
        surface: { DEFAULT: '#FFFFFF', dark: '#0F172A' }, // 卡片/表格/弹窗/顶栏底色
        subtle: { DEFAULT: '#F1F5F9', dark: '#1E293B' }, // Hover/搜索框/斑马纹
        // —— 主品牌色（仅用于主操作 / 激活 / 选中，占屏 5%~10%）——
        brand: {
          DEFAULT: '#2563EB', // blue-600 · 核心 CTA
          hover: '#1D4ED8', // blue-700 · CTA hover
          light: '#EFF6FF', // blue-50  · 侧栏激活底 / 高亮 Tag
        },
      },
      fontFamily: {
        // 西文无衬线为主
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
        // 金额 / IP / 哈希 / 序列号 / 监控指标强制等宽
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      // 规范圆角：控件 lg=8px / 面板 xl=12px 均为 Tailwind 默认值，显式登记以固化契约
      borderRadius: {
        lg: '0.5rem', // 8px  · Button / Input / Select / Tag
        xl: '0.75rem', // 12px · Card / Modal / Dropdown Panel
      },
    },
  },
  plugins: [],
};
