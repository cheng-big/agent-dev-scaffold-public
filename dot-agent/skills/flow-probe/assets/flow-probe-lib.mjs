// ════════════════════════════════════════════════════════════════════
// flow-probe-lib —— 「浏览器真流程测试」共享库（项目无关 · 通过 flow-probe.config.mjs 适配）
//   方法论：flow-probe skill（SKILL.md / references/*）。核心：按泳道落端、每步后端权威回查、
//   凡有页面的动作浏览器点真按钮、点不到就判红、杜绝假绿。
//
//   适配：本项目相关的只有「登录端点 + localStorage token 键 + urls + Chrome/Playwright 路径」，
//   全部集中在同目录 `flow-probe.config.mjs`（照 flow-probe.config.example.mjs 建）。缺配置时用下方 DEFAULTS。
//   新系统探针：`import { createProbe, uiDrive, ... } from './flow-probe-lib.mjs'`（见 example-flow-probe.mjs）。
// ════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = process.env.PROJECT_ROOT || path.resolve(__dirname, '..')  // 默认 harness/ 的上一级 = 项目根
const reportRoot = path.join(__dirname, 'reports')
const systemsDir = path.join(reportRoot, 'systems')

// ── 缺省配置（新项目改 flow-probe.config.mjs 覆盖；env 变量再覆盖 urls）──
const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8087',
  webUrl: 'http://127.0.0.1:5181',      // 管理后台
  portalUrl: 'http://127.0.0.1:5182',   // 公众/政务门户（无则可与 webUrl 相同）
  h5Url: 'http://127.0.0.1:5183',       // 移动端（无则忽略）
  chromiumPath: '',                     // 空=用 Playwright 自带 chromium
  playwrightPaths: [],                  // 额外 playwright 模块搜索路径
  password: 'admin123',                 // 种子统一密码（仅验证用）
  adminLoginPath: '/auth/login',        // 管理端登录端点，返回 {token, roleCodes, userId, ...}
  portalLoginPath: '/public/auth/login',// 公众门户登录端点
  auth: { tokenKey: 'auth_token', roleCodesKey: 'role_codes', primaryRoleKey: 'primary_role', userKey: 'auth_user' },
  portalAuth: { sessionKey: 'portal_session', localeKey: 'portal_locale' },
}
let LOADED = {}
try { LOADED = (await import('./flow-probe.config.mjs')).default || {} } catch {}
const CFG = {
  ...DEFAULTS, ...LOADED,
  auth: { ...DEFAULTS.auth, ...(LOADED.auth || {}) },
  portalAuth: { ...DEFAULTS.portalAuth, ...(LOADED.portalAuth || {}) },
}

// ── 环境常量（起栈脚本注入 env 优先，其次 config）──
export const baseUrl = process.env.BASE_URL || CFG.baseUrl
export const webUrl = process.env.WEB_URL || CFG.webUrl
export const portalUrl = process.env.PORTAL_URL || CFG.portalUrl
export const h5Url = process.env.H5_URL || CFG.h5Url
export const executablePath = process.env.CHROMIUM_PATH || CFG.chromiumPath || undefined  // undefined=Playwright 自带
export const HEADED = process.env.HEADLESS === 'false'
export const unique = Date.now().toString(36)
export const PASSWORD = CFG.password
export const config = CFG

// ── Playwright 定位（config.playwrightPaths → 项目 node_modules → 全局解析）──
export function loadPlaywright() {
  const candidates = [
    ...(CFG.playwrightPaths || []),
    path.join(process.cwd(), 'node_modules/playwright'),
    path.join(process.cwd(), 'node_modules/playwright-core'),
    path.join(root, 'apps/web/node_modules/playwright'),
    path.join(root, 'apps/web/node_modules/playwright-core'),
    'playwright', 'playwright-core',
  ]
  for (const c of candidates) { try { return require(c) } catch {} }
  throw new Error('找不到 Playwright：请在项目 npm i -D playwright，或在 flow-probe.config.mjs 的 playwrightPaths 指定路径')
}

// ── 直连后端（不抛，供回查/兜底）──
export async function api(pathname, options = {}) {
  const { token, ...rest } = options
  try {
    const response = await fetch(baseUrl + pathname, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(options.headers || {}) },
    })
    const text = await response.text()
    let body = null
    if (text) { try { body = JSON.parse(text) } catch { body = text } }
    return { ok: response.ok, status: response.status, body }
  } catch (e) { return { ok: false, status: 0, body: null, netError: e?.message || String(e) } }
}

// ── 登录（管理端）──
export async function login(username, password = PASSWORD) {
  const r = await api(CFG.adminLoginPath, { method: 'POST', body: JSON.stringify({ username, password }) })
  if (!r.ok || !r.body?.token) throw new Error(`${username} 登录失败 HTTP ${r.status}`)
  return r.body
}
// 登录（公众/政务门户）——失败不抛，返回 {ok:false}
export async function portalLogin(username, password = PASSWORD) {
  const r = await api(CFG.portalLoginPath, { method: 'POST', body: JSON.stringify({ username, password }) })
  return r.ok && r.body?.token ? { ok: true, ...r.body } : { ok: false, status: r.status }
}

// ── localStorage 注入（页面加载前）；token 键从 config.auth 读 ──
export async function installAuth(context, info, fallbackRole) {
  await context.addInitScript((s) => {
    localStorage.setItem(s.__k.tokenKey, s.token)
    localStorage.setItem(s.__k.roleCodesKey, JSON.stringify(s.roleCodes || []))
    localStorage.setItem(s.__k.primaryRoleKey, s.roleCodes?.[0] || s.fallbackRole)
    localStorage.setItem(s.__k.userKey, JSON.stringify({ userId: s.userId, userNameZh: s.userNameZh, userNameBo: s.userNameBo, regionCode: s.regionCode }))
  }, { ...info, fallbackRole, __k: CFG.auth })
}
export async function installPortalAuth(context, session, locale = 'zh') {
  await context.addInitScript((v) => {
    localStorage.setItem(v.__k.sessionKey, JSON.stringify(v.s))
    localStorage.setItem(v.__k.localeKey, v.locale)
  }, { s: { token: session.token, identity: { userId: session.userId, userNameZh: session.userNameZh, userNameBo: session.userNameBo ?? null, regionCode: session.regionCode, authLevel: session.authLevel, roleCodes: session.roleCodes } }, locale, __k: CFG.portalAuth })
}

// ── 对话框内引用实体下拉（filterable el-select）──
export async function pickRemote(page, dialog, label, text) {
  const sel = dialog.locator(`.el-form-item:has-text("${label}") .el-select`).first()
  await sel.click()
  await page.keyboard.type(text, { delay: 20 })
  await page.waitForTimeout(400)
  const opt = page.locator('.el-select-dropdown:visible [role="option"]:visible').filter({ hasText: text }).first()
  await opt.waitFor({ state: 'visible', timeout: 6000 })
  await opt.click()
}
// 对话框内选下拉首项（不带过滤）
export async function pickFirst(page, dialog, label) {
  await dialog.locator(`.el-form-item:has-text("${label}") .el-select`).first().click()
  await page.locator('.el-select-dropdown:visible [role="option"]').first().click()
}
export async function fillItem(dialog, label, value) {
  await dialog.locator(`.el-form-item:has-text("${label}") input, .el-form-item:has-text("${label}") textarea`).first().fill(value)
}
export async function confirmPopupIfAny(page) {
  const btn = page.locator('.el-message-box__btns button.el-button--primary')
  try { if (await btn.isVisible({ timeout: 1500 })) await btn.click() } catch {}
}
export async function clickRowBtn(page, rowText, btnName, timeout = 6000) {
  const row = page.locator('tr').filter({ hasText: rowText }).first()
  await row.waitFor({ state: 'visible', timeout: 8000 })
  await row.getByRole('button', { name: btnName }).first().click({ timeout })
}
export async function savedOk(page) {
  try { await page.locator('.el-message').filter({ hasText: /保存成功|已保存|已通过|已提交|已发布|已公示|操作成功|新增成功/ }).first().waitFor({ timeout: 8000 }); return true } catch { return false }
}
export const vs = (actual, expected) => (actual === expected ? 'PASS' : 'MISMATCH')

// ── 「UI 优先、未落库则 HTTP 兜底」建实体（弱化用；纯 UI 优先用 uiBuild）──
export async function ensureEntity(uiFn, findFn, httpFn) {
  let via = 'UI', note = ''
  try { await uiFn() } catch (e) { via = 'HTTP(fallback)'; note = (e?.message || String(e)).slice(0, 60) }
  let ent = await findFn()
  if (!ent) { via = via === 'UI' ? 'HTTP(fallback:UI未落库)' : via; await httpFn(); ent = await findFn() }
  return { ent, via, note }
}
// ── 「UI 优先、未推进则 HTTP 兜底」状态迁移（弱化用；纯 UI 优先用 uiDrive）──
export async function driveAction(uiFn, verifyFn, target, httpFn) {
  let via = 'UI'
  try { await uiFn() } catch (e) { via = 'HTTP(fallback:' + (e?.message || String(e)).slice(0, 40) + ')' }
  let st = await verifyFn()
  if (st !== target) { via = via === 'UI' ? 'HTTP(fallback:UI未推进)' : via; await httpFn(); st = await verifyFn() }
  return { st, via }
}

// ── 纯 UI 驱动（不 HTTP 兜底；后端仅回查作断言；点不到→ok:false 判红）──
//   「浏览器上测试而非接口测试」的主力：状态迁移一律浏览器点真实页面，verifyFn 只坐实结果。
export async function uiDrive(uiFn, verifyFn, target) {
  let err = ''
  try { await uiFn() } catch (e) { err = (e?.message || String(e)).replace(/\s+/g, ' ').slice(0, 90) }
  const st = await verifyFn()
  return { ok: st === target, st, err }
}
// ── UI 建单：列表页→点新建→填对话框(fillFn)→保存/确定/提交→回查落库(findFn)。纯 UI，不 HTTP 造数。──
export async function uiBuild(page, route, newBtn, dialogTitle, fillFn, findFn) {
  let err = ''
  try {
    await page.goto(webUrl + '/#' + route, { waitUntil: 'networkidle', timeout: 20000 }); await page.waitForTimeout(500)
    await page.getByRole('button', { name: newBtn }).first().click()
    const d = page.locator('.el-dialog:visible').filter({ hasText: dialogTitle }).first()
    await d.waitFor({ state: 'visible', timeout: 10000 })
    await fillFn(d)
    await d.getByRole('button', { name: /^(保存|确定|提交)$/ }).first().click()
    await savedOk(page)
  } catch (e) { err = (e?.message || String(e)).replace(/\s+/g, ' ').slice(0, 90) }
  const ent = await findFn()
  return { ent, err }
}
// ── 审核员在【审核待办页】点真实「通过/驳回」按钮 + 处理意见弹框（有 prompt 时填，无则容错）──
//   todoRoute 如 /sys/<域>/review/todo；rowText=待办行可匹配文本；btnName 默认「通过」。
export async function auditTodo(page, todoRoute, rowText, btnName = '通过') {
  await page.goto(webUrl + '/#' + todoRoute, { waitUntil: 'networkidle', timeout: 20000 })
  await page.reload({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {})  // SPA 同路由复访要 reload，见 pitfalls
  await page.waitForTimeout(900)
  const row = page.locator('tr').filter({ hasText: rowText }).first()
  await row.waitFor({ state: 'visible', timeout: 8000 })
  await row.getByRole('button', { name: btnName }).first().click({ timeout: 6000 })
  const box = page.locator('.el-message-box:visible').first()
  try { await box.waitFor({ state: 'visible', timeout: 3000 }); await box.locator('textarea, input').first().fill('探针审核' + btnName).catch(() => {}); await box.locator('button.el-button--primary').click() } catch {}
  await page.waitForTimeout(700)
}
// ── UI 行操作：列表页(可选先切 tab)→找含 rowText 的行→点按钮→(可选)确认弹框。──
export async function uiRowAction(page, route, rowText, btnName, { tab } = {}) {
  await page.goto(webUrl + '/#' + route, { waitUntil: 'networkidle', timeout: 20000 })
  await page.reload({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(600)
  if (tab) { await page.getByRole('tab', { name: tab }).click().catch(() => {}); await page.waitForTimeout(500) }
  const row = page.locator('tr').filter({ hasText: rowText }).first()
  await row.waitFor({ state: 'visible', timeout: 8000 })
  await row.getByRole('button', { name: btnName }).first().click({ timeout: 6000 })
  const box = page.locator('.el-message-box__btns button.el-button--primary')
  try { if (await box.isVisible({ timeout: 1200 })) await box.click() } catch {}
  await page.waitForTimeout(600)
}

// ════════════════════════════════════════════════════════════════════
// createProbe(SYSTEM) —— 每支探针的状态容器 + 记录/截图/落盘方法
//   SYSTEM = { code, index, name }  （code 大写，如 'ORDER'；index 序号，如 '一'）
// ════════════════════════════════════════════════════════════════════
export function createProbe(SYSTEM) {
  const codeLower = SYSTEM.code.toLowerCase()
  const shotDir = path.join(reportRoot, 'screenshots', codeLower)
  const flows = []
  const pages = []
  const observations = []
  const infra = { baseUrl, webUrl, portalUrl, headed: HEADED, startedAt: new Date().toISOString() }
  let shotSeq = 0

  fs.mkdirSync(systemsDir, { recursive: true })
  fs.mkdirSync(shotDir, { recursive: true })

  function makeFlow(no, name, wbChain, note) { const f = { no, name, wbChain, note, steps: [] }; flows.push(f); return f }

  async function snap(page, label) {
    if (!page) return null
    shotSeq += 1
    const rel = `screenshots/${codeLower}/${String(shotSeq).padStart(2, '0')}-${String(label).replace(/[^\w一-鿿]/g, '')}.png`
    try { await page.screenshot({ path: path.join(reportRoot, rel), fullPage: false }); return rel } catch { return null }
  }
  // HTTP 步：先导航到管理端相关模块页，让「后端动作效果」在 UI 可见，再截图
  async function snapAt(page, route, label) {
    try { await page.goto(webUrl + '/#' + route, { waitUntil: 'networkidle', timeout: 15000 }); await page.waitForTimeout(400) } catch {}
    return snap(page, label)
  }
  async function goto(page, route) { await page.goto(webUrl + '/#' + route, { waitUntil: 'networkidle', timeout: 20000 }) }

  // step(flow, name, expected, actual, verdict, via, detail, shot, sys, fix)
  //   sys=端(默认「管理后台」)；via=UI/HTTP；fix=修复意见(仅非 PASS 需填，供问题清单汇出)。
  function step(flow, name, expected, actual, verdict, via, detail, shot, sys, fix) {
    flow.steps.push({ name, expected, actual, verdict, via: via || 'HTTP', detail: detail === undefined ? null : detail, shot: shot || null, sys: sys || '管理后台', fix: fix || null })
    const tag = { PASS: 'OK  ', MISMATCH: 'DIFF', GAP: 'GAP ', ERROR: 'ERR ', INFO: 'INFO' }[verdict] || '?   '
    console.log(`[${flow.no}] ${tag} ${(sys || '管理后台').padEnd(6)} ${(via || 'HTTP').padEnd(14)} ${name} → ${actual}`)
  }
  function observe(name, expected, actual, verdict, detail, fix) {
    observations.push({ name, expected, actual, verdict, detail: detail === undefined ? null : detail, fix: fix || null })
  }
  function addPage(route, title, verdict, detail, shot, sys) {
    pages.push({ route, title, verdict, detail: detail === undefined ? null : detail, shot: shot || null, sys: sys || '管理后台' })
  }

  // 后台页面浏览器真渲染批量断言（5xx/空白/404/console.error）
  async function renderPages(page, routes, sys = '管理后台') {
    for (const [route, title] of routes) {
      const errors = [], server = []
      const onC = (m) => { if (m.type() === 'error') errors.push(m.text()) }
      const onR = (r) => { if (r.status() >= 500) server.push(r.status() + ' ' + r.url()) }
      page.on('console', onC); page.on('response', onR)
      let verdict = 'PASS', detail = null
      try {
        await goto(page, route)
        if (page.url().includes('/login')) { verdict = 'ERROR'; detail = '被跳回登录页' }
        else {
          await page.waitForSelector('.el-table, .el-card, .el-tabs, .el-empty, main, h1, h2', { timeout: 12000 })
          const text = (await page.locator('body').innerText()).trim()
          if (!text) { verdict = 'ERROR'; detail = '无可见内容' }
          else if (/\b404\b|页面不存在|Internal Server Error/.test(text)) { verdict = 'ERROR'; detail = text.slice(0, 150) }
          else if (server.length) { verdict = 'ERROR'; detail = '5xx: ' + server.join('; ') }
          else if (errors.length) { verdict = 'MISMATCH'; detail = 'console.error: ' + errors.slice(0, 2).join(' | ') }
        }
      } catch (e) { verdict = 'ERROR'; detail = e?.message || String(e) }
      const shot = await snap(page, 'page-' + title)
      page.off('console', onC); page.off('response', onR)
      pages.push({ route, title, verdict, detail, shot, sys })
      console.log(`[page] ${verdict === 'PASS' ? 'OK  ' : verdict === 'MISMATCH' ? 'DIFF' : 'ERR '} ${route}`)
    }
  }

  // 汇总 + 落盘 systems/<code>.json（返回 counts 供收尾打印）
  function finalize(stateMachines = []) {
    const counts = { PASS: 0, MISMATCH: 0, GAP: 0, ERROR: 0, INFO: 0 }
    const viaCounts = { UI: 0, HTTP: 0 }
    const sysCounts = {}
    for (const f of flows) for (const s of f.steps) {
      if (counts[s.verdict] !== undefined) counts[s.verdict]++
      if (s.via === 'UI') viaCounts.UI++; else if (String(s.via).startsWith('HTTP')) viaCounts.HTTP++
      sysCounts[s.sys] = (sysCounts[s.sys] || 0) + 1
    }
    for (const p of pages) if (counts[p.verdict] !== undefined) counts[p.verdict]++
    for (const o of observations) if (counts[o.verdict] !== undefined) counts[o.verdict]++
    const total = flows.reduce((n, f) => n + f.steps.length, 0) + pages.length + observations.length
    const out = { code: SYSTEM.code, index: SYSTEM.index, name: SYSTEM.name, populated: true, infra, summary: { counts, viaCounts, sysCounts, total }, stateMachines, flows, pages, observations }
    const jsonPath = path.join(systemsDir, codeLower + '.json')
    fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2))
    console.log('\n─────────────────────────────────────────')
    console.log(`${SYSTEM.code} 深探针完成：总 ${total}  PASS ${counts.PASS}  MISMATCH ${counts.MISMATCH}  GAP ${counts.GAP}  ERROR ${counts.ERROR}  INFO ${counts.INFO}`)
    console.log(`步骤驱动：UI ${viaCounts.UI} / HTTP ${viaCounts.HTTP}   有头=${HEADED}`)
    console.log('端分布：' + Object.entries(sysCounts).map(([k, v]) => `${k} ${v}`).join(' / '))
    console.log('单系统 JSON：' + jsonPath)
    console.log(`${SYSTEM.code}_FLOW_PROBE_DONE`)
    return { counts, total }
  }

  return { SYSTEM, flows, pages, observations, infra, makeFlow, step, observe, addPage, snap, snapAt, goto, renderPages, finalize }
}
