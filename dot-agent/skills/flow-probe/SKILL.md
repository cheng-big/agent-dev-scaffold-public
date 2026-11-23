---
name: flow-probe
description: >
  「浏览器真流程测试」方法——把一个业务平台按其流程规格(时序图/流程文档)逐条流程、跨端、用浏览器点真实页面 + 后端权威回查地验证「按应然是否真跑得通」，产出单文件交互 HTML 报告(问题清单+修复意见)并闭环修复。不是「接口 200 冒烟」，也不是「导航+截图判 PASS」的假绿：每一步都后端回查坐实，凡有页面的动作一律浏览器点真按钮(含后台审核/状态迁移)，点不到就判红。适用于任何「有业务流程规格 + Web 前端(管理后台/公众门户/移动端) + 后端」的平台。触发场景：用户说「跑探针 <系统>」「深探针 <系统>」「flow-probe <系统>」「浏览器真流程测试」「按流程图逐步骤测业务系统」「real-flow browser probe」，或要「对着业务流程图把某系统端到端测一遍并出问题清单」。本 skill 自带可拷用的探针库/报告器/起栈模板，填一个 config 即可在新项目跑起来。
---

# flow-probe — 浏览器真流程测试方法

你扮演 **QA 技术总监 + 全栈工程师**：对着平台的业务流程规格，把每条流程当作真实用户跨端走一遍，用浏览器点真实页面驱动、后端权威回查坐实，评估「按应然是否真跑得通」，出问题清单+修复意见，并闭环修复。

## 一句话方法
**按流程规格时序图的「泳道（谁·在哪个端·做什么）」，把每一步落到正确的端，在那个端用浏览器点真实按钮驱动，每一步都用后端回查坐实结果——不做假绿，点不到就判红。**

## 一图流水线
```
流程规格(时序图/泳道/状态机) ──抽泳道──▶ 步骤→端映射
   (应然真源)                              │
角色/权限表 + 字段级需求 ───────────────────┤
                                           ▼
                  摸实现(后端 controller/状态枚举/种子 · 前端 路由/按钮/公众端点)
                                           ▼
                  写探针 <code>-flow-probe.mjs(逐步骤·落端·浏览器点真按钮·后端回查)
                                           ▼
                  起隔离栈跑 run-stack.sh(建库→迁移→后端→前端→Playwright→拆栈)
                                           ▼
                  判定 PASS/MISMATCH(P2)/GAP(P1)/ERROR(P0)/INFO (每步带 端sys·驱动via·修复fix·截图shot)
                                           ▼
        systems/<code>.json ─▶ ★report.html(单文件交互报告，最终交付物) + 问题清单
                                           ▼
                  闭环：问题→改产品代码→重跑该系统→findings 转绿
```

## 8 步流水线
1. **抽泳道**：从流程规格的时序图/participant，逐步骤列「角色(谁执行) + 端(公众门户/管理后台/移动端/统一身份/业务中心/数据中台…) + 是否跨系统」，产「步骤→端」映射表。**别把跨端流程全塞管理后台**。
2. **摸实现**：后端 controller/entity、迁移里的**状态字段枚举**、种子账号、公众端点；前端路由、页面、**真实按钮**（grep 表格 `prop=` 定位可见列、`@click=` 定位动作按钮）。
3. **定账号**：为每个「端×角色」建独立浏览器上下文（管理员、各级审核员、公众）；**注意分级路由**（省/市，审批实例区划常取提交人区划，提交人须辖区账号否则待办为空）。
4. **写探针（核心）**：`harness/<code>-flow-probe.mjs`，import `flow-probe-lib.mjs`。每条流程 `makeFlow`，每步 `step(端sys, 应然, 实测, 判定, 驱动via, 明细, 截图, 修复fix)`。驱动铁律：
   - **有页面的步骤 → 浏览器点真实按钮**（`uiDrive`/`uiRowAction`/`uiBuild`/审核待办两节点点通过/`pickRemote` 选下拉）；
   - **后端 `api()` 回查坐实**（建了 GET 单号、审了查状态迁移、对外展示断言 count≥1）；
   - **点不到就判红，不 HTTP 兜底驱动**；确实无页面的（后端不变式断言/外部 stub/定时任务）诚实保留 HTTP/INFO。
5. **起隔离栈跑**：`run-stack.sh <系统|all>`：建隔离库→迁移→起后端→起前端→Playwright 驱动浏览器跑探针→trap 拆栈清库。**headless 先验选择器/断言 → 有头出图**。
6. **判定口径**：PASS(通过且回查坐实) / MISMATCH(能跑但口径分叉，P2) / GAP(应然有实现无，P1) / ERROR(报错5xx，P0) / INFO(观察/stub)。每步双维度：`sys`(端) + `via`(UI/HTTP)。
7. **报告**：`systems/<code>.json`(机读) → `build-report.mjs` → **`report.html`（单文件交互：左选系统/右上流程逐步骤/右下问题+修复意见，每轮测试的最终交付物）**。
8. **闭环修复**：问题→责任定位(前端/后端/迁移/契约)→改产品代码→重跑该系统→该 finding 转绿。

## 五条质量纪律（这套方法凭什么可信）
1. **杜绝假绿**——每步后端权威回查，绝不「导航+截图+判 PASS」（截图页面可能是空的）。
2. **坐实再下结论**——下判断前读源码，别猜根因（教训见 references/methodology.md 例B）。
3. **点不到就算红**——有页面却点不到/点了没推进，如实判红，不 HTTP 兜底掩盖。
4. **诚实暴露 GAP**——应然有、实现无的流程记 GAP，不静默跳过。
5. **泳道不压平**——公众端步骤在公众门户做，别在管理后台建单代替。

## 最终产物是 HTML
每轮测试跑完 → `harness/reports/report.html`（单文件、自包含、浏览器打开即用）。这是交给评审/团队的东西。另有 `flow-report.html`(同数据另一视图) 与问题清单。

## 分发与使用（怎么丢给别人 · 别人怎么用）
**分发**：本方法 = `~/.claude/skills/flow-probe/` 整个目录。
- 打包：`zip -r flow-probe-skill.zip ~/.claude/skills/flow-probe`，发给对方。
- 对方解压到自己的 `~/.claude/skills/flow-probe/`（全局技能目录，跨项目生效），下次 Claude Code 会话即识别。
- 只想让人「看懂方法+怎么用」：单发 `assets/flow-probe-guide.html`，浏览器打开即读。

**别人怎么用（在自己项目落地）**：
1. 把 `assets/` 里的 `flow-probe-lib.mjs`、`build-report.mjs`、`run-stack.sh.tmpl`(改名 `run-stack.sh`)、`example-flow-probe.mjs` 拷进本项目 `harness/`。
2. `cp flow-probe.config.example.mjs flow-probe.config.mjs`，照 `references/adapt-to-new-project.md` 填本项目的 urls / 登录端点 / token 键 / 账号 / 系统清单。
3. 触发：对 Claude 说「**跑探针 <系统>**」→ 本 skill 自动加载方法。
4. 照 `example-flow-probe.mjs` 为该系统写 `<code>-flow-probe.mjs`（逐流程·落端·浏览器点真按钮·后端回查）。
5. `bash harness/run-stack.sh <系统>` 起隔离栈跑 → 产 `harness/reports/report.html`。
6. 看 report.html 问题清单 → 改产品代码 → 重跑 → findings 转绿。

## 快速上手（自查顺序）
① 找到流程规格 → ② 抽一个系统的泳道 → ③ 摸该系统实现+账号 → ④ 照 example 写探针(先 3-5 步跑通) → ⑤ headless 起栈跑 → ⑥ 看 report.html → ⑦ 补全流程 + 有头出图。

## 深入
- `references/methodology.md` —— 8 步展开 + 判定口径表 + **两个端到端 worked example**。
- `references/pitfalls.md` —— 通用踩坑清单（假绿/泳道压平/分级路由/SPA 同路由不重挂载/引用下拉不落库…）。
- `references/adapt-to-new-project.md` —— 新项目落地清单（识别什么、填到 config 哪里）。
- 参考实现：一个多系统业务平台的 `harness/` 可以作为本方法的完整落地样板（覆盖多个系统并包含细化流程文档）。
