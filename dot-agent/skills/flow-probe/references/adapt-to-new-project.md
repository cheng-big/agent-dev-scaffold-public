# 新项目落地清单（flow-probe）

拿到本 skill，要在一个新项目跑起来，按此清单识别 5 类信息并填进 `flow-probe.config.mjs` / `run-stack.sh`。

## 0. 拷文件
把 `assets/` 里这些拷进目标项目 `harness/`（新建即可）：
- `flow-probe-lib.mjs`（不用改）
- `build-report.mjs`（不用改）
- `run-stack.sh.tmpl` → 改名 `run-stack.sh`，`chmod +x`
- `example-flow-probe.mjs`（当模板）
- `flow-probe.config.example.mjs` → `cp` 成 `flow-probe.config.mjs`
并确保项目能用 Playwright：`npm i -D playwright && npx playwright install chromium`（或在 config.chromiumPath 指到系统 Chrome）。

## 1. 流程规格在哪（应然真源）
- 找：产品给的业务流程文档 / 时序图 / PRD / 状态机表（例如项目中的 `system.html`）。
- 用途：抽泳道、列每系统的编号流程与状态机。
- 无正式时序图时：用 PRD 的流程章节 + 页面走查补，但仍要按「步骤→端」拆。

## 2. 登录端点与 token 存储 shape（填 config.adminLoginPath / portalLoginPath / auth / portalAuth）
- **登录端点**：找后端 auth controller 的登录 `@PostMapping`（管理端、公众端各一）。确认返回体含 `token` + 角色/用户信息。
- **token 存哪个 localStorage 键**：浏览器打开前端 → 登录 → F12 → Application → Local Storage，看真实键名（如 `xz_token`/`xz_portal_session`）与值的 shape。填进 config.auth / config.portalAuth。
- **验证码**：多数后端账密登录默认不强制图形验证码（仅当启用了验证码安全策略才校验）——直接调登录接口拿 JWT 注入即可，不驱动登录页。若你项目强制验证码，需在 config/probe 里处理。

## 3. 起栈命令（填 run-stack.sh 的 CONFIG 段）
- **隔离库**：起一个独立于正式库的测试库名（跑完 DROP），改 `db_create`/`db_drop`（示例是 MySQL；换你的 DB）。
- **后端启动**：改 `backend_compile`/`backend_start`，把端口 + 连隔离库注入（示例是 Spring `mvn spring-boot:run -Dspring-boot.run.jvmArguments=...`）；`BACKEND_READY` 改成你后端就绪的日志标记。
- **迁移**：多数框架随启动自动迁移（Flyway/Liquibase/Prisma migrate）；若需单独跑，在 backend_start 前加。
- **前端启动**：改 `web_start`/`portal_start`/`h5_start`（各端 dev server + 指向后端端口的代理 env）；没有的端设 `HAS_PORTAL=false` 或留空。
- **端口**：`BACKEND_PORT/WEB_PORT/PORTAL_PORT/H5_PORT` 按需。

## 4. 系统与编号流程清单（填 config.systems + run-stack ALL_CODES）
- 从流程规格列出要测的系统（给每个一个大写 code，如 ORDER/USER/VENUE）。
- 探针文件名约定：`harness/<code 小写>-flow-probe.mjs`。
- config.systems 决定 report.html 左侧目录顺序。

## 5. 各端各角色账号 + 分级路由（填 config.accounts）
- 找 Flyway/seed 里的种子账号；缺则补种子（管理操作员、省/市审核员、公众/群众探针账号，密码统一 config.password）。
- **分级路由**：确认审批实例区划怎么定（常取提交人区划）、各级审核员的区划——提交人须是辖区账号，否则审核员待办为空。
- DoD：「登进去就有可用可见数据」——种子要含起始业务数据，别空表。

## 上手顺序（建议）
1. 填好 config + run-stack CONFIG。
2. 照 `example-flow-probe.mjs` 为**第一个系统**写探针，先只写 3-5 步主链路。
3. `HEADLESS=true bash harness/run-stack.sh <系统>` 跑通选择器与断言（headless 快）。
4. `open harness/reports/report.html` 看结果。
5. 补全该系统全部编号流程 → `HEADLESS=false` 有头出图肉眼复核。
6. 下一个系统重复；全部完 `run-stack.sh all`。

## 自查（避免 xz 残留 / 假绿）
- config 里所有值都是你项目的（不是 xz 的示例值）。
- 每个 UI 步都有后端 `api()` 回查，不是纯截图。
- 有页面却点不到的步骤判红，不 HTTP 兜底。
- GAP（应然有实现无）如实记，不静默跳过。
