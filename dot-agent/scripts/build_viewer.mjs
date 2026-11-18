#!/usr/bin/env node
// 零依赖（仅 Node 内置模块）。把 docs/ 下所有产物自动发现并内嵌进单个 docs/viewer.html
// （双击即开，无需服务器）。数据变了重跑本脚本即可刷新。
// 自动发现约定：
//   docs/architecture/*.json        → 架构（取首个，通常单一全局）
//   docs/blueprints/*_blueprint.json → 页面契约（按文件名分系统）
//   docs/probes/*_probe.json         → 探针（取首个）
//   docs/product/contracts/*.{yaml,yml,json} → API 契约（json 结构化 / yaml 原文）
//   docs/product/**.md, docs/blueprints/*.md → 原始文档
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// —— 定位项目根：从脚本目录向上找含 docs/ 的目录 ——
function findRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, 'docs'))) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return process.cwd();
}
const SELF = dirname(fileURLToPath(import.meta.url));
const ROOT = findRoot(SELF);
const DOCS = join(ROOT, 'docs');

function ls(dir, re) {
  const p = join(DOCS, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p).filter((f) => re.test(f)).sort().map((f) => join(dir, f));
}
function rd(rel) { const p = join(DOCS, rel); return existsSync(p) ? readFileSync(p, 'utf8') : ''; }
function rj(rel) { const t = rd(rel); try { return t ? JSON.parse(t) : null; } catch (e) { console.error('⚠ JSON 解析失败', rel, e.message); return null; } }

// 架构（首个 *.json）
const archFile = ls('architecture', /\.json$/i).find((f) => /_arch\.json$/i.test(f)) || ls('architecture', /\.json$/i)[0];
const arch = archFile ? rj(archFile) : null;

// 页面契约（每个 *_blueprint.json 一个系统，key=去掉后缀的中文名）
const blueprints = {};
for (const f of ls('blueprints', /_blueprint\.json$/i)) {
  const name = basename(f).replace(/_blueprint\.json$/i, '');
  blueprints[name] = rj(f);
}

// 探针（首个 *_probe.json）
const probeFile = ls('probes', /_probe\.json$/i)[0];
const probe = probeFile ? rj(probeFile) : null;

// API 契约（json 结构化 / yaml 原文）
let openapi = null;
const cJson = ls('product/contracts', /\.json$/i)[0];
const cYaml = ls('product/contracts', /\.(ya?ml)$/i)[0];
if (cJson) openapi = { kind: 'json', doc: rj(cJson), name: basename(cJson) };
else if (cYaml) openapi = { kind: 'yaml', raw: rd(cYaml), name: basename(cYaml) };

// 原始文档（product 与 blueprints 下的 md）
const md = {};
for (const f of [...ls('product', /\.md$/i), ...ls('blueprints', /\.md$/i)]) {
  md[basename(f).replace(/\.md$/i, '')] = rd(f);
}

const data = { arch, blueprints, probe, openapi, md };
const PAYLOAD = JSON.stringify(data);

const HTML = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>产物可视化</title>
<style>
:root{--bg:#0f1420;--panel:#171e2e;--card:#1e2739;--line:#2b3650;--txt:#e6ebf5;--mut:#93a1bf;--acc:#4da3ff;--ok:#3ddc97;--warn:#ffb454;--bad:#ff6b6b;--chip:#26324a}
*{box-sizing:border-box}
body{margin:0;font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--txt)}
header{padding:16px 22px;background:linear-gradient(90deg,#12305a,#0f1420);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:10}
h1{margin:0;font-size:18px}
.sub{color:var(--mut);font-size:12px;margin-top:4px}
nav{display:flex;flex-wrap:wrap;gap:6px;padding:10px 18px;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:60px;z-index:9}
nav button{background:var(--chip);color:var(--txt);border:1px solid transparent;border-radius:20px;padding:6px 14px;cursor:pointer;font-size:13px}
nav button.on{background:var(--acc);color:#04121f;font-weight:600}
main{padding:18px 22px;max-width:1180px;margin:0 auto}
.tab{display:none}.tab.on{display:block}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0}
.card h3{margin:0 0 8px;font-size:15px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.chip{display:inline-block;background:var(--chip);border-radius:6px;padding:1px 8px;margin:2px 4px 2px 0;font-size:12px;color:var(--mut)}
.chip.role{background:#1c3a5e;color:#bcd7ff}
table{border-collapse:collapse;width:100%;margin:6px 0;font-size:13px}
th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
th{background:#202a3f;color:var(--mut);font-weight:600}
.mut{color:var(--mut)}
.req{color:var(--bad);font-weight:700}
details{margin:6px 0;border:1px solid var(--line);border-radius:8px;overflow:hidden}
summary{cursor:pointer;padding:8px 12px;background:#202a3f;font-weight:600}
details>div{padding:10px 12px}
.method{font-weight:700;border-radius:5px;padding:1px 7px;font-size:11px;margin-right:6px}
.m-get{background:#123d2c;color:var(--ok)}.m-post{background:#1c3a5e;color:#bcd7ff}.m-put{background:#463a1a;color:var(--warn)}.m-delete{background:#43201f;color:var(--bad)}
.route{font-family:ui-monospace,Menlo,monospace;color:var(--acc);font-size:12px}
.sm-flow{font-family:ui-monospace,monospace;font-size:12px;color:#cdd8ee;background:#131a29;border-radius:8px;padding:8px 12px;white-space:pre-wrap}
.warn{color:var(--warn)}.bad{color:var(--bad)}.ok{color:var(--ok)}
.md h1,.md h2,.md h3{border-bottom:1px solid var(--line);padding-bottom:4px}
.md code{background:#131a29;padding:1px 5px;border-radius:4px;font-size:12px}
.md pre,pre.raw{background:#131a29;padding:10px;border-radius:8px;overflow:auto;font-size:12px}
.kpi{display:inline-block;background:var(--chip);border-radius:10px;padding:8px 14px;margin:4px 8px 4px 0;text-align:center}
.kpi b{font-size:20px;color:var(--acc);display:block}
</style>
</head>
<body>
<header>
  <h1>📦 产物可视化</h1>
  <div class="sub">自动发现 docs/ 产物 · 数据内嵌（双击即开）· 更新后重跑 <code>node .agent/scripts/build_viewer.mjs</code></div>
</header>
<nav id="nav"></nav>
<main id="main"></main>
<script id="payload" type="application/json">__PAYLOAD__</script>
<script>
const D = JSON.parse(document.getElementById('payload').textContent);
const esc = s => (s==null?'':String(s)).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function md(t){
  if(!t) return '<p class="mut">（无内容）</p>';
  const FENCE=String.fromCharCode(96).repeat(3);
  const lines=t.split('\n');let h='',intbl=false,inpre=false;
  for(let ln of lines){
    if(ln.trim().startsWith(FENCE)){inpre=!inpre;h+=inpre?'<pre>':'</pre>';continue;}
    if(inpre){h+=esc(ln)+'\n';continue;}
    if(/^\s*\|.*\|/.test(ln)){
      const cells=ln.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
      if(/^[-:\s|]+$/.test(ln))continue;
      if(!intbl){h+='<table>';intbl=true;h+='<tr>'+cells.map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr>';}
      else h+='<tr>'+cells.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>';
      continue;
    } else if(intbl){h+='</table>';intbl=false;}
    if(/^### /.test(ln))h+='<h3>'+inline(ln.slice(4))+'</h3>';
    else if(/^## /.test(ln))h+='<h2>'+inline(ln.slice(3))+'</h2>';
    else if(/^# /.test(ln))h+='<h1>'+inline(ln.slice(2))+'</h1>';
    else if(/^\s*[-*] /.test(ln))h+='<li>'+inline(ln.replace(/^\s*[-*] /,''))+'</li>';
    else if(ln.trim()!=='')h+='<p>'+inline(ln)+'</p>';
  }
  if(intbl)h+='</table>';
  return h;
}
function inline(s){const bt=String.fromCharCode(96);return esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(new RegExp(bt+'(.+?)'+bt,'g'),'<code>$1</code>');}

const TABS=[['概览','overview'],['功能菜单树','menu'],['页面契约','contracts'],['数据模型','model'],['状态机','sm'],['探针','probe'],['API契约','api'],['异常警报','amb'],['原始文档','docs']];
const nav=document.getElementById('nav'),main=document.getElementById('main');
TABS.forEach(([label,id],i)=>{const b=document.createElement('button');b.textContent=label;if(i===0)b.className='on';
  b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.remove('on'));b.classList.add('on');
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));document.getElementById('tab-'+id).classList.add('on');window.scrollTo(0,0);};
  nav.appendChild(b);const d=document.createElement('div');d.className='tab'+(i===0?' on':'');d.id='tab-'+id;main.appendChild(d);});
const T=id=>document.getElementById('tab-'+id);

// 概览
(function(){const a=D.arch||{};let h='';
  if(a.systems){h+='<div class="card"><h3>系统与角色</h3>';
    if(a.roles)h+='<div>角色：'+a.roles.map(r=>'<span class="chip role">'+esc(r)+'</span>').join('')+'</div>';
    h+='<div class="grid" style="margin-top:10px">';
    a.systems.forEach(s=>{h+='<div class="card" style="margin:0"><h3>'+esc(s.name)+'</h3><div class="mut" style="font-size:12px">'+esc(s.layer||'')+' · '+esc(s.positioning||'')+'</div><p>'+esc(s.duty||'')+'</p><div style="font-size:12px"><b>用户</b>：'+esc(s.users||'')+'<br><b>核心数据</b>：'+esc(s.core_data||'')+'</div></div>';});
    h+='</div></div>';}
  const bp=D.blueprints||{},pages=Object.values(bp).reduce((n,b)=>n+(b?b.length:0),0);
  const oa=(D.openapi&&D.openapi.kind==='json')?D.openapi.doc:null;
  const ops=oa&&oa.paths?Object.values(oa.paths).reduce((n,v)=>n+Object.keys(v).filter(m=>['get','post','put','delete'].includes(m)).length,0):(D.openapi?'yaml':0);
  const kpi=(n,l)=>'<span class="kpi"><b>'+n+'</b>'+l+'</span>';
  h+='<div class="card"><h3>产物规模</h3>'+kpi(pages,'页面契约')+kpi((a.lineage||[]).length,'数据实体')+kpi(((D.probe&&D.probe.tab2_execution)||[]).length,'探针实体')+kpi(ops,'API操作')+kpi((a.golden_paths||[]).length,'黄金链路')+kpi((a.ambiguities||[]).length,'待确认')+'</div>';
  if(a.golden_paths){h+='<div class="card"><h3>核心业务链路</h3>';a.golden_paths.forEach(g=>{h+='<div style="margin:8px 0"><b>'+esc(g.flowname)+'</b> <span class="mut" style="font-size:12px">'+esc(g.flowsrc||'')+'</span><div class="sm-flow">'+g.steps.map(esc).join('  →  ')+'</div></div>';});h+='</div>';}
  T('overview').innerHTML=h||'<p class="mut">无架构数据</p>';})();

// 功能菜单树
(function(){const fns=(D.arch||{}).functions;if(!fns){T('menu').innerHTML='<p class="mut">无功能树</p>';return;}
  const byL1={};fns.forEach(f=>{(byL1[f.l1]=byL1[f.l1]||[]).push(f);});let h='<div class="card"><h3>功能菜单树（WBS）</h3>';
  Object.entries(byL1).forEach(([l1,arr])=>{h+='<h3 style="color:var(--acc)">'+esc(l1)+'</h3><ul>';arr.forEach(f=>{h+='<li><b>'+esc(f.l2)+'</b> › '+esc(f.l3)+' <span class="mut" style="font-size:12px">'+esc(f.desc||'')+'</span></li>';});h+='</ul>';});
  T('menu').innerHTML=h+'</div>';})();

// 页面契约
(function(){let h='';const vt=(title,cols,rows)=>{if(!rows.length)return '';return '<div style="font-size:12px;margin-top:8px"><b>'+title+'</b></div><table><tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+(c||'')+'</td>').join('')+'</tr>').join('')+'</table>';};
  Object.entries(D.blueprints||{}).forEach(([sys,pages])=>{if(!pages)return;h+='<div class="card"><h3>'+esc(sys)+' <span class="mut" style="font-size:12px">（'+pages.length+' 页）</span></h3>';let grp='';
    pages.forEach(p=>{if(p.menu_group!==grp){grp=p.menu_group;h+='<h3 style="color:var(--warn);margin-top:14px">▸ '+esc(grp)+'</h3>';}
      h+='<details><summary>'+esc(p.page_menu_name)+' <span class="route">'+esc(p.route_path)+'</span></summary><div>';
      h+='<div class="mut" style="font-size:12px;margin-bottom:8px">'+esc(p.reference_section||'')+'</div>';const ac=p.atomic_contract||{};
      h+=vt('展示字段 data',['字段','类型','说明'],(ac.data_view||[]).map(x=>[x.field,x.type,x.remark]));
      h+=vt('动作 action',['动作','类型','权限','说明'],(ac.action_view||[]).map(x=>[x.action_name,x.type,x.permission,x.remark]));
      h+=vt('输入 input',['输入项','组件','必填','说明'],(ac.input_view||[]).map(x=>[x.input_label,x.component,x.required?'<span class="req">必填</span>':'',x.remark]));
      if(p.state_machine){h+='<div class="mut" style="font-size:12px;margin-top:6px"><b>状态机</b>：'+esc(p.state_machine.entity)+'（初态 '+esc(p.state_machine.initial)+'）</div><div class="sm-flow">'+p.state_machine.transitions.map(t=>esc(t.from)+' --['+esc(t.action)+(t.guard?' · '+esc(t.guard):'')+']--> '+esc(t.to)).join('\n')+'</div>';}
      h+='</div></details>';});h+='</div>';});
  T('contracts').innerHTML=h||'<p class="mut">无页面契约</p>';})();

// 数据模型（优先用 JSON 契约的 schemas；否则提示看原始文档）
(function(){const oa=(D.openapi&&D.openapi.kind==='json')?D.openapi.doc:null;const sc=oa&&oa.components&&oa.components.schemas;
  if(!sc){T('model').innerHTML='<div class="card"><p class="mut">数据模型见「原始文档」中的数据模型.md，或提供 JSON 版 OpenAPI 契约以结构化渲染。</p></div>';return;}
  let h='<div class="card"><h3>数据模型（取自 OpenAPI schema）</h3></div>';
  Object.entries(sc).forEach(([e,s])=>{let props={},req=[];(function walk(o){if(!o)return;if(o.allOf)o.allOf.forEach(walk);if(o.properties)Object.assign(props,o.properties);if(o.required)req=req.concat(o.required);})(s);
    if(!Object.keys(props).length)return;
    h+='<div class="card"><h3>'+esc(e)+'</h3><table><tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th></tr>';
    Object.entries(props).forEach(([k,v])=>{const en=v.enum?(' ['+v.enum.join('/')+']'):'';const ro=v.readOnly?' <span class="mut">只读</span>':'';
      h+='<tr><td>'+esc(k)+'</td><td>'+esc(v.type||(v.allOf?'enum':((v.$ref||'').split('/').pop())))+esc(en)+ro+'</td><td>'+(req.includes(k)?'<span class="req">必填</span>':'')+'</td><td>'+esc(v.description||'')+'</td></tr>';});
    h+='</table></div>';});
  T('model').innerHTML=h;})();

// 状态机
(function(){let h='<div class="card"><h3>全量状态机</h3></div>',seen={},any=false;
  Object.entries(D.blueprints||{}).forEach(([sys,pages])=>{if(!pages)return;pages.forEach(p=>{if(!p.state_machine)return;const sm=p.state_machine;if(seen[sm.entity])return;seen[sm.entity]=1;any=true;
    h+='<div class="card"><h3>'+esc(sm.entity)+' <span class="mut" style="font-size:12px">初态 '+esc(sm.initial)+' · '+esc(sys)+'</span></h3><div class="sm-flow">'+sm.transitions.map(t=>esc(t.from)+'  --['+esc(t.action)+(t.guard?' · '+esc(t.guard):'')+']-->  '+esc(t.to)).join('\n')+'</div></div>';});});
  T('sm').innerHTML=any?h:'<p class="mut">无状态机</p>';})();

// 探针
(function(){const pb=D.probe;if(!pb){T('probe').innerHTML='<p class="mut">无探针</p>';return;}const ov=pb.tab1_overview.systems[0];let h='';
  h+='<div class="card"><h3>验收目标</h3><p>'+esc(ov.business_target)+'</p><b style="font-size:12px">测试七寸</b><ul>'+ov.testing_strategy.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></div>';
  const stg={'1_create':'①投毒创建','2_publish':'②发布/审核','3_use':'③使用','4_statistics':'④统计','5_crossref':'⑤跨系统穿透'};
  pb.tab2_execution.forEach(e=>{h+='<div class="card"><h3>🧪 '+esc(e.entity_name)+' <span class="mut" style="font-size:12px">'+esc(e.system)+'</span></h3><div style="font-size:12px">探针：<span class="chip">'+esc(e.primary_probe.Name)+'</span> <span class="warn">'+esc(e.primary_probe.Key_Value)+'</span></div>';
    Object.entries(e.stages).forEach(([k,v])=>{h+='<div style="margin-top:6px"><b style="font-size:12px">'+(stg[k]||k)+'</b><table><tr><th>端</th><th>模块</th><th>动作</th><th>断言</th><th>探针值</th></tr>';
      v.checks.forEach(c=>{h+='<tr><td>'+esc(c.client_end)+'</td><td>'+esc(c.system_module)+'</td><td>'+esc(c.action)+'</td><td>'+esc(c.assertion)+'</td><td class="warn">'+esc(c.probe_data)+'</td></tr>';});h+='</table></div>';});h+='</div>';});
  T('probe').innerHTML=h;})();

// API 契约（json 结构化 / yaml 原文）
(function(){const o=D.openapi;if(!o){T('api').innerHTML='<p class="mut">无 API 契约</p>';return;}
  if(o.kind==='yaml'){T('api').innerHTML='<div class="card"><h3>API 契约 · '+esc(o.name)+' <span class="mut" style="font-size:12px">（YAML 原文）</span></h3><pre class="raw">'+esc(o.raw)+'</pre></div>';return;}
  const oa=o.doc;const tags={};Object.entries(oa.paths||{}).forEach(([route,ms])=>{Object.entries(ms).forEach(([m,op])=>{if(!['get','post','put','delete'].includes(m))return;const tg=(op.tags||['其他'])[0];(tags[tg]=tags[tg]||[]).push({route,m,op});});});
  let h='<div class="card"><h3>API 契约 · '+Object.keys(oa.paths||{}).length+' 路径</h3><div class="mut" style="font-size:12px">'+esc((oa.info||{}).title||'')+' '+esc((oa.info||{}).version||'')+'</div></div>';
  Object.entries(tags).forEach(([tg,arr])=>{h+='<div class="card"><h3>#'+esc(tg)+'</h3>';arr.forEach(({route,m,op})=>{h+='<div style="margin:4px 0"><span class="method m-'+m+'">'+m.toUpperCase()+'</span><span class="route">'+esc(route)+'</span> <span style="font-size:12px">'+esc(op.summary||'')+'</span></div>';});h+='</div>';});
  if(oa.components&&oa.components.schemas)h+='<div class="card"><h3>Schemas（'+Object.keys(oa.components.schemas).length+'）</h3>'+Object.keys(oa.components.schemas).map(s=>'<span class="chip">'+esc(s)+'</span>').join('')+'</div>';
  T('api').innerHTML=h;})();

// 异常警报
(function(){const a=(D.arch||{}).ambiguities;if(!a){T('amb').innerHTML='<p class="mut">无异常警报</p>';return;}
  let h='<div class="card"><h3>⚠️ 异常警报（待业务确认）</h3><table><tr><th>警报</th></tr>';
  a.forEach(x=>{let cls='';if(String(x).includes('🔴'))cls='bad';else if(String(x).includes('🟠'))cls='warn';h+='<tr><td class="'+cls+'">'+esc(typeof x==='string'?x:JSON.stringify(x))+'</td></tr>';});
  T('amb').innerHTML=h+'</table></div>';})();

// 原始文档
(function(){let h='';Object.entries(D.md||{}).forEach(([name,txt])=>{h+='<details><summary>'+esc(name)+'.md</summary><div class="md">'+md(txt)+'</div></details>';});
  T('docs').innerHTML=h||'<p class="mut">无文档</p>';})();
</script>
</body>
</html>`;

const out = HTML.replace('__PAYLOAD__', PAYLOAD.replace(/</g, '\\u003c'));
const op = join(DOCS, 'viewer.html');
writeFileSync(op, out);
console.log('✅ 生成', op, '(' + Math.round(out.length / 1024) + ' KB)  根=' + ROOT);
