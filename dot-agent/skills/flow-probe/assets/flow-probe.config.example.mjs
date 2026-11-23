// ════════════════════════════════════════════════════════════════════
// flow-probe.config —— 每个项目一份（把本文件 cp 成 flow-probe.config.mjs 再改）
//   flow-probe-lib.mjs 会自动 import 本文件；缺失则用库内 DEFAULTS。
//   下方值是通用本地示例，必须改成你项目的配置。
//   怎么找每个字段见 references/adapt-to-new-project.md。
// ════════════════════════════════════════════════════════════════════
export default {
  // ── 各端 URL（起栈脚本会用 env 覆盖，这里给默认/本地开发值）──
  baseUrl: 'http://127.0.0.1:8087',    // 后端 API 根
  webUrl: 'http://127.0.0.1:5181',     // 管理后台前端
  portalUrl: 'http://127.0.0.1:5182',  // 公众/政务门户（无则填成与 webUrl 相同）
  h5Url: 'http://127.0.0.1:5183',      // 移动端（无则忽略）

  // ── 浏览器 ──
  chromiumPath: '',                    // 空=用 Playwright 自带 chromium；也可指到系统 Chrome，如
                                       //   '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  playwrightPaths: [],                 // 额外 playwright 模块搜索路径（默认已找项目 node_modules）

  // ── 登录 ──
  password: 'admin123',                // 种子统一密码（仅验证用）
  adminLoginPath: '/auth/login',       // 管理端登录端点，须返回 { token, roleCodes:[], userId, userNameZh, regionCode, ... }
  portalLoginPath: '/public/auth/login',// 公众门户登录端点，返回 { token, userId, regionCode, authLevel, roleCodes, ... }

  // ── 前端把登录态存 localStorage 的键名（打开前端→F12→Application→Local Storage 查真实键名）──
  auth: {                              // 管理端
    tokenKey: 'app_token',
    roleCodesKey: 'app_role_codes',
    primaryRoleKey: 'app_primary_role',
    userKey: 'app_user',
  },
  portalAuth: {                        // 公众门户
    sessionKey: 'app_portal_session',
    localeKey: 'app_portal_locale',
  },

  // ── 账号表（各端各角色；探针里按需 login/portalLogin 用；密码统一 password）──
  //   注意分级路由：审批实例区划常取提交人区划，提交人须是辖区账号，否则审核员待办为空。
  accounts: {
    admin: 'someadmin',                // 管理操作员（*_ADMIN）
    provAudit: 'provauditor',          // 省级审核（PROV_AUDIT / 540000）
    cityAudit: 'cityauditor_ls',       // 市级审核（CITY_AUDIT / 540100）
    citizen: 'someprobe_browser',      // 公众/群众（门户登录）
    // …按项目补各域专职审核员、越权探针账号等
  },

  // ── 系统清单（run-stack.sh 的 ALL_CODES 用；探针文件名 = <code 小写>-flow-probe.mjs）──
  systems: ['SYS_A', 'SYS_B'],
}
