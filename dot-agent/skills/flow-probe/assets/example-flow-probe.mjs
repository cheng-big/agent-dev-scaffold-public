#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// 示例探针骨架 —— 演示「浏览器真流程测试」一支探针怎么写（照抄改成 <你的系统>-flow-probe.mjs）
//   方法：每条流程 makeFlow；每步 step(端sys, 应然, 实测, 判定, 驱动via, 明细, 截图, 修复fix)；
//         有页面的动作用 uiDrive/uiRowAction/auditTodo 浏览器点真按钮，后端 api() 回查坐实；
//         点不到就判红(uiDrive 返回 ok:false)，不 HTTP 兜底驱动。
//   跑：bash harness/run-stack.sh SAMPLE   （或 HEADLESS=false 有头看）
// ════════════════════════════════════════════════════════════════════
import {
  createProbe, loadPlaywright, api, login, portalLogin, installAuth, installPortalAuth,
  vs, unique, HEADED, executablePath, webUrl, portalUrl, config,
  uiDrive, uiRowAction, auditTodo,
} from './flow-probe-lib.mjs'

const P = createProbe({ code: 'SAMPLE', index: '一', name: '示例系统' })
const { makeFlow, step, observe, snap, finalize, renderPages } = P

// 工作台状态机（应然 vs 实现），供报告展示；按你系统的 state-flow 表填
const STATE_MACHINES = [
  { name: '单据状态机', chain: '草稿→待审核→已通过/已驳回→已发布', impl: '实现枚举：草稿/审核中/通过/已发布（示例）' },
]

// 账号从 config.accounts 取（在 flow-probe.config.mjs 配）
const ACC = config.accounts || {}

async function main() {
  // ── 登录：为每个「端×角色」建独立浏览器上下文 ──
  const adminS = await login(ACC.admin)
  const cityS = await login(ACC.cityAudit)
  const provS = await login(ACC.provAudit)
  const at = adminS.token
  P.infra.operator = `${ACC.admin}(${(adminS.roleCodes || []).join('/')})`
  P.infra.auditor = `CITY:${ACC.cityAudit} / PROV:${ACC.provAudit}`
  const cit = ACC.citizen ? await portalLogin(ACC.citizen) : { ok: false }

  const { chromium } = loadPlaywright()
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 250 : 0, executablePath })
  // 管理员上下文
  const opCtx = await browser.newContext({ viewport: { width: 1440, height: 980 } }); await installAuth(opCtx, adminS, 'ADMIN'); const op = await opCtx.newPage()
  // 审核员上下文（辖区/办公室两节点）
  const cauCtx = await browser.newContext({ viewport: { width: 1440, height: 980 } }); await installAuth(cauCtx, cityS, 'CITY_AUDIT'); const cauPage = await cauCtx.newPage()
  const pauCtx = await browser.newContext({ viewport: { width: 1440, height: 980 } }); await installAuth(pauCtx, provS, 'PROV_AUDIT'); const pauPage = await pauCtx.newPage()
  // 公众门户上下文（如有）
  let pt = null
  if (cit.ok) { const c = await browser.newContext({ viewport: { width: 1024, height: 768 } }); await installPortalAuth(c, cit); pt = await c.newPage() }

  // ═══ 流程 1.1 建单 → 提交 → 两节点审核 → 发布 ═══
  const f1 = makeFlow('1.1', '单据建档与两节点审核', STATE_MACHINES[0].chain, '泳道：经办人建单(管理后台)→提交→辖区初审(CITY)→办公室复审(PROV)→发布')
  {
    // ① 建单（示例走 HTTP 造数据前置；也可用 uiBuild 走 UI 新建对话框）
    const cr = await api('/sample-orders', { method: 'POST', token: at, body: JSON.stringify({ nameZh: '探针单据' + unique, regionCode: '540100' }) })
    const id = cr.body?.id
    const orderNo = cr.body?.orderNo || ('探针单据' + unique)
    step(f1, '建单（POST /sample-orders→草稿）', 'status=草稿 且落库', id ? `status=${cr.body?.status}` : `HTTP ${cr.status}`, id ? vs(cr.body?.status, '草稿') : 'ERROR', 'HTTP', { id }, null, '管理后台', id ? null : '核对 POST /sample-orders 必填')

    if (id) {
      const statusOf = async () => (await api(`/sample-orders/${id}`, { token: at })).body?.status

      // ② 提交审核：管理员在列表页点该行「提交审核」（浏览器点真按钮 + 后端回查）
      const subDrv = await uiDrive(() => uiRowAction(op, '/sys/sample/order/manage', orderNo, '提交审核'), statusOf, '审核中')
      step(f1, '提交审核（点「提交审核」→审核中）', 'status=审核中', subDrv.ok ? '审核中·后端回查一致' : `未推进(仍${subDrv.st})·${subDrv.err}`, subDrv.ok ? 'PASS' : 'MISMATCH', 'UI', { id }, await snap(op, '11提交'), '管理后台', subDrv.ok ? null : '列表页点「提交审核」未推进：核对该单可见性/提交端点')

      // ③ 两节点审核：辖区(CITY)→办公室(PROV)在【审核待办】页依次点「通过」→已通过
      const rvDrv = await uiDrive(async () => {
        await auditTodo(cauPage, '/sys/sample/review/todo', orderNo, '通过')  // 节点1
        await auditTodo(pauPage, '/sys/sample/review/todo', orderNo, '通过')  // 节点2
      }, statusOf, '已通过')
      step(f1, '两节点审核通过（审核待办点「通过」·CITY→PROV→已通过）', 'status=已通过', rvDrv.ok ? '已通过·后端回查一致' : `未推进(仍${rvDrv.st})·${rvDrv.err}`, rvDrv.ok ? 'PASS' : 'MISMATCH', 'UI', { id }, await snap(cauPage, '11审核'), '管理后台', rvDrv.ok ? null : '审核待办两节点未办结：核对分级路由(CITY→PROV)与审批标题是否含单号')

      // ④ 发布：点「发布」→已发布
      const pubDrv = await uiDrive(() => uiRowAction(op, '/sys/sample/order/manage', orderNo, '发布'), statusOf, '已发布')
      step(f1, '发布（点「发布」→已发布）', 'status=已发布', pubDrv.ok ? '已发布·后端回查一致' : `未推进(仍${pubDrv.st})·${pubDrv.err}`, pubDrv.ok ? 'PASS' : 'MISMATCH', 'UI', { id }, await snap(op, '11发布'), '管理后台', pubDrv.ok ? null : '列表页点「发布」未推进：核对发布端点')
    }
  }

  // ═══ 流程 1.2 公众门户展示（如有）═══
  if (pt) {
    const f2 = makeFlow('1.2', '公众门户展示', '已发布→门户可见', '泳道：公众在门户浏览已发布单据')
    let ok = false, shot = null
    try {
      await pt.goto(`${portalUrl}/#/service/sample`, { waitUntil: 'networkidle', timeout: 20000 }); await pt.waitForTimeout(800)
      ok = await pt.locator('.el-table, .el-card, .el-empty, main').first().isVisible().catch(() => false)
      shot = await snap(pt, '12门户展示')
    } catch {}
    step(f2, '门户展示可见', '门户对应 tab 正常渲染(无登录门)', ok ? '门户已渲染' : '门户未渲染', ok ? 'PASS' : 'MISMATCH', 'UI', null, shot, '公众门户', ok ? null : '核对门户路由/会话注入 shape')
  }

  // ═══ 后台页面浏览器真渲染（可选，批量断言不 5xx/不空白）═══
  await renderPages(op, [
    ['/sys/sample/order/manage', '单据管理'],
    ['/sys/sample/review/todo', '审核待办'],
  ], '管理后台')

  // ═══ 跨切面观察（应然有实现无 = GAP；口径分叉 = MISMATCH；stub = INFO）═══
  observe('示例：某工作台要求的能力尚未落地', '工作台应然：XXX', '实现：未见 XXX', 'GAP', null, '按工作台补 XXX')

  await browser.close()
  finalize(STATE_MACHINES)
}
main().catch((e) => { console.error('SAMPLE 探针主流程异常：', e?.stack || e); process.exit(1) })
