#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// 单文件整合报告 builder（用户要求的交互物）
//   读 harness/reports/systems/*.json → 产 harness/reports/report.html（自包含单文件）
//   布局：左侧 13 系统目录（UI占比/通过率/问题数徽标）；
//         右上 = 该系统「正常流程」逐步骤（流程→步骤：端/应然/实测/判定/驱动UI-HTTP/截图）；
//         右下 = 该系统「当前问题」（非 PASS 步骤 + 跨切面观察，含修复意见）。
//   截图用相对路径（screenshots/<code>/*.png），从 reports/ 目录打开即可显示。
// ════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const reportDir = path.join(__dirname, 'reports')
const systemsDir = path.join(reportDir, 'systems')

// 目录顺序：优先用 flow-probe.config.mjs 的 systems；缺失则按各系统 json 的 code 排序。
let ORDER = []
try { ORDER = (await import('./flow-probe.config.mjs')).default?.systems || [] } catch {}

function load() {
  const map = new Map()
  if (fs.existsSync(systemsDir)) {
    for (const f of fs.readdirSync(systemsDir).filter((n) => n.endsWith('.json'))) {
      try { const d = JSON.parse(fs.readFileSync(path.join(systemsDir, f), 'utf8')); if (d?.code) map.set(d.code, d) } catch (e) { console.error('跳过', f, e.message) }
    }
  }
  const out = []
  for (const c of ORDER) if (map.has(c)) { out.push(map.get(c)); map.delete(c) }
  for (const d of map.values()) out.push(d)
  return out
}

// 每系统统计
function stat(sys) {
  let ui = 0, http = 0, pass = 0, total = 0
  const problems = []
  for (const fl of sys.flows || []) for (const s of fl.steps || []) {
    total++
    if (s.via === 'UI') ui++; else if (String(s.via).startsWith('HTTP')) http++
    if (s.verdict === 'PASS') pass++
    if (['ERROR', 'GAP', 'MISMATCH'].includes(s.verdict)) problems.push({ ...s, flowNo: fl.no, flowName: fl.name, src: '流程步骤' })
  }
  for (const o of sys.observations || []) if (['ERROR', 'GAP', 'MISMATCH'].includes(o.verdict)) problems.push({ ...o, flowNo: '观察', flowName: '跨切面观察', src: '观察' })
  const uiPct = ui + http ? Math.round(ui / (ui + http) * 100) : 0
  return { ui, http, uiPct, pass, total, problems, obsCount: (sys.observations || []).filter((o) => o.verdict === 'INFO').length }
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function main() {
  const systems = load().map((s) => ({ ...s, _stat: stat(s) }))
  const generatedAt = new Date().toISOString()
  const payload = { generatedAt, systems }
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>业务平台 · 浏览器探针「真流程」测试报告</title>
<style>
  :root{--bd:#e3e6ea;--ink:#1a2332;--mut:#6b7280;--bg:#f6f8fa;--sb:#fbfcfd}
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{font:14px/1.6 -apple-system,"PingFang SC",Segoe UI,Roboto,sans-serif;color:#1a1f27;background:var(--bg);display:flex;flex-direction:column;height:100vh}
  header{background:var(--ink);color:#fff;padding:12px 20px;flex:0 0 auto;display:flex;align-items:baseline;gap:16px}
  header h1{margin:0;font-size:16px} header .meta{font-size:11.5px;opacity:.8}
  .layout{flex:1 1 auto;display:flex;min-height:0}
  aside{flex:0 0 300px;background:var(--sb);border-right:1px solid var(--bd);overflow:auto;padding:8px 0}
  aside .tt{font-weight:700;color:var(--ink);padding:8px 16px 10px;font-size:13px;border-bottom:1px solid var(--bd);margin-bottom:4px}
  .sysrow{display:flex;flex-direction:column;gap:3px;padding:9px 16px;cursor:pointer;border-left:3px solid transparent}
  .sysrow:hover{background:#eef2f7}
  .sysrow.active{background:#e8f0fe;border-left-color:#1a5fd0}
  .sysrow .nm{font-weight:600;color:var(--ink);font-size:13px}
  .sysrow .nm .idx{color:var(--mut);font-weight:500;margin-right:6px}
  .sysrow .badges{display:flex;gap:6px;flex-wrap:wrap}
  .b{font-size:11px;border-radius:9px;padding:0 7px;white-space:nowrap}
  .b.ui{background:#e6f4ea;color:#137333} .b.pass{background:#eef3fb;color:#1a5fd0} .b.prob{background:#fff5f5;color:#c0392b} .b.prob0{background:#eef3fb;color:#137333}
  main{flex:1 1 auto;overflow:auto;padding:16px 22px}
  h2{font-size:17px;margin:0 0 4px;color:var(--ink)} .crumb{color:var(--mut);font-size:12px}
  .cards{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 4px}
  .card{background:#fff;border:1px solid var(--bd);border-radius:9px;padding:8px 14px;text-align:center;min-width:78px}
  .card .n{font-size:20px;font-weight:700} .card .l{font-size:11px;color:var(--mut)}
  .sec-h{font-size:14px;font-weight:700;color:var(--ink);margin:18px 0 6px;padding-bottom:4px;border-bottom:2px solid #e8f0fe}
  .flow{margin:10px 0} .flow-t{font-weight:600;color:#274b7a;font-size:13.5px;margin:6px 0 2px}
  .chain{font-size:12px;background:#eef3fb;color:#274b7a;padding:5px 10px;border-radius:6px;margin:2px 0}
  table{width:100%;border-collapse:collapse;margin-top:6px;font-size:12.5px;background:#fff}
  th,td{border:1px solid var(--bd);padding:6px 9px;text-align:left;vertical-align:top}
  th{background:#f0f3f7;font-weight:600;white-space:nowrap;position:sticky;top:0}
  .badge{display:inline-block;color:#fff;border-radius:10px;padding:1px 8px;font-size:11.5px;white-space:nowrap}
  .via{display:inline-block;border-radius:5px;padding:0 6px;font-size:11px;font-weight:600}
  .via-UI{background:#e6f4ea;color:#137333} .via-HTTP{background:#fdecea;color:#b93815}
  .chip{display:inline-block;border:1px solid;border-radius:5px;padding:0 6px;font-size:11px;font-weight:600;white-space:nowrap}
  tr.v-ERROR td,tr.v-GAP td{background:#fff5f5} tr.v-MISMATCH td{background:#fffaf2}
  .fix{color:#0a6b3b;font-size:12px} .thumb{width:120px;border:1px solid var(--bd);border-radius:4px;cursor:zoom-in;display:block}
  .noshot{color:#c3c9d0;font-size:11px} .none{color:var(--mut);padding:10px}
  .prio{color:#fff;border-radius:9px;padding:1px 7px;font-size:11px;font-weight:700}
  #lb{position:fixed;inset:0;background:rgba(10,15,25,.9);display:none;align-items:center;justify-content:center;z-index:99;cursor:zoom-out}
  #lb img{max-width:94vw;max-height:92vh;border-radius:6px}
</style></head>
<body>
<header><h1>业务平台 · 浏览器探针「真流程」测试报告</h1><div class="meta">应然真源：项目流程与权限文档 ｜ 驱动：<span class="via via-UI">UI</span> 浏览器点真实页面 · <span class="via via-HTTP">HTTP</span> 直连接口 ｜ 生成 ${esc(generatedAt)}</div></header>
<div class="layout">
  <aside><div class="tt">业务系统（13）</div><div id="toc"></div></aside>
  <main id="detail"></main>
</div>
<div id="lb" onclick="this.style.display='none'"><img alt=""></div>
<script type="application/json" id="data">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
<script>
const DATA=JSON.parse(document.getElementById('data').textContent)
const VMAP={PASS:['#0a7','通过'],MISMATCH:['#e69138','口径差异'],GAP:['#c00','缺口'],ERROR:['#c00','报错'],INFO:['#3572b0','观察']}
const PRIO={ERROR:['#c00','P0'],GAP:['#e69138','P1'],MISMATCH:['#3572b0','P2']}
const esc=(s)=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
const badge=(v)=>{const m=VMAP[v]||['#888',v];return '<span class="badge" style="background:'+m[0]+'">'+m[1]+'</span>'}
const via=(x)=>{const ui=x==='UI';return '<span class="via '+(ui?'via-UI':'via-HTTP')+'">'+esc(ui?'UI':(String(x).startsWith('HTTP')?'HTTP':x))+'</span>'}
const SC={'公众门户':'#137333','政务门户':'#1a5fd0','管理后台':'#1a5fd0','移动端':'#9333ea','统一身份认证':'#b45309','业务中心':'#b45309','其它系统':'#6b7280'}
const chip=(s)=>{const c=SC[s]||'#6b7280';return '<span class="chip" style="color:'+c+';border-color:'+c+'55;background:'+c+'12">'+esc(s||'—')+'</span>'}
const shot=(p)=>p?'<img class="thumb" loading="lazy" src="'+esc(p)+'" onclick="lb(this.src)">':'<span class="noshot">—</span>'
function lb(s){const b=document.getElementById('lb');b.querySelector('img').src=s;b.style.display='flex'}
function toc(){const t=document.getElementById('toc');t.innerHTML=''
  DATA.systems.forEach((sys,i)=>{const st=sys._stat;const el=document.createElement('div');el.className='sysrow';el.dataset.i=i
    el.innerHTML='<div class="nm"><span class="idx">'+esc(sys.index||'')+'</span>'+esc(sys.name)+'</div><div class="badges">'
      +'<span class="b ui">UI '+st.uiPct+'%</span><span class="b pass">通过 '+st.pass+'/'+st.total+'</span>'
      +'<span class="b '+(st.problems.length?'prob':'prob0')+'">问题 '+st.problems.length+'</span></div>'
    el.onclick=()=>sel(i);t.appendChild(el)})}
function sel(i){document.querySelectorAll('.sysrow').forEach(r=>r.classList.toggle('active',+r.dataset.i===i))
  const sys=DATA.systems[i],st=sys._stat,d=document.getElementById('detail')
  let h='<div class="crumb">'+esc(sys.index+' '+sys.name+' ('+sys.code+')')+'</div><h2>'+esc(sys.name)+'</h2>'
    +'<div class="cards"><div class="card"><div class="n">'+st.total+'</div><div class="l">检查点</div></div>'
    +'<div class="card"><div class="n" style="color:#0a7">'+st.pass+'</div><div class="l">通过</div></div>'
    +'<div class="card"><div class="n" style="color:#137333">'+st.uiPct+'%</div><div class="l">UI驱动</div></div>'
    +'<div class="card"><div class="n" style="color:#c0392b">'+st.problems.length+'</div><div class="l">问题</div></div>'
    +'<div class="card"><div class="n" style="color:#3572b0">'+st.obsCount+'</div><div class="l">观察</div></div></div>'
  // 右上：正常流程
  h+='<div class="sec-h">正常业务流程（逐步骤 · 端/应然/实测/判定/驱动/截图）</div>'
  ;(sys.flows||[]).forEach(f=>{h+='<div class="flow"><div class="flow-t">'+esc(f.no)+' '+esc(f.name)+'</div>'
    +(f.wbChain?'<div class="chain"><b>工作台状态链：</b>'+esc(f.wbChain)+'</div>':'')
    +'<table><thead><tr><th>步骤</th><th>端</th><th>工作台应然</th><th>实测</th><th>判定</th><th>驱动</th><th>截图</th></tr></thead><tbody>'
    +(f.steps||[]).map(s=>'<tr class="v-'+s.verdict+'"><td>'+esc(s.name)+'</td><td>'+chip(s.sys)+'</td><td>'+esc(s.expected)+'</td><td>'+esc(s.actual)+'</td><td>'+badge(s.verdict)+'</td><td>'+via(s.via)+'</td><td>'+shot(s.shot)+'</td></tr>').join('')
    +'</tbody></table></div>'})
  // 右下：当前问题
  h+='<div class="sec-h">当前问题（'+st.problems.length+' 条 · 含修复意见）</div>'
  if(!st.problems.length)h+='<div class="none">✓ 无问题（该系统正常流程全通过）</div>'
  else{h+='<table><thead><tr><th>级</th><th>流程</th><th>问题/端</th><th>工作台应然</th><th>实测</th><th>修复意见</th></tr></thead><tbody>'
    +st.problems.map(p=>{const pr=PRIO[p.verdict]||['#888','?'];return '<tr class="v-'+p.verdict+'"><td><span class="prio" style="background:'+pr[0]+'">'+pr[1]+'</span></td><td>'+esc(p.flowNo)+'<br><small>'+esc(p.flowName)+'</small></td><td>'+esc(p.name)+'<br>'+chip(p.sys)+'</td><td>'+esc(p.expected)+'</td><td>'+esc(p.actual)+'</td><td class="fix">'+esc(p.fix||'（待评估）')+'</td></tr>'}).join('')
    +'</tbody></table>'}
  d.innerHTML=h;d.scrollTop=0}
toc();sel(0)
</script>
</body></html>`
  fs.writeFileSync(path.join(reportDir, 'report.html'), html)
  const totUI = systems.reduce((n, s) => n + s._stat.ui, 0), totH = systems.reduce((n, s) => n + s._stat.http, 0)
  const totProb = systems.reduce((n, s) => n + s._stat.problems.length, 0)
  console.log('单文件报告：' + path.join(reportDir, 'report.html'))
  console.log('13 系统 · UI驱动占比 ' + Math.round(totUI / (totUI + totH) * 100) + '% · 问题合计 ' + totProb)
}
main()
