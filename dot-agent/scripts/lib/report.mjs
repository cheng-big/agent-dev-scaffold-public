// report：读 bugs.json + 各 bug 目录阶段产物 + harness 证据 → 自包含 HTML 报告。
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { atomicWriteFile, readJson, writeJsonAtomic } from './store.mjs';
import { imageExtension, videoExtension } from './bugmedia.mjs';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const readMd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function fileInput(agentRoot, path, extra = {}) {
  return {
    ...extra,
    path: relative(agentRoot, path),
    sha256: sha256(readFileSync(path)),
  };
}

function readEvidenceText(path) {
  const raw = readFileSync(path, 'utf8');
  if (!path.endsWith('.json')) return raw;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function findHarnessEvidence(agentRoot, ref) {
  const evidenceRoot = join(agentRoot, 'evidence');
  if (!existsSync(evidenceRoot)) return null;
  const filename = `ev_${String(ref).replace(/^ev:/, '')}.json`;
  try {
    for (const entry of readdirSync(evidenceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(evidenceRoot, entry.name, filename);
      if (existsSync(candidate)) return candidate;
    }
  } catch { /* ignore unreadable runtime evidence */ }
  return null;
}

function collectReportInputs(agentRoot, bugs) {
  const records = [];
  const bugsPath = join(agentRoot, 'bugs.json');
  records.push(fileInput(agentRoot, bugsPath));

  for (const bug of bugs) {
    const bugDir = join(agentRoot, 'bugs', bug.id || '');
    for (const name of ['repro.md', 'root-cause.md', 'impact.md', 'fix-plan.md', 'change.md', 'lint.json', 'regression.json']) {
      const path = join(bugDir, name);
      if (existsSync(path)) records.push(fileInput(agentRoot, path));
    }
    const evidenceDir = join(bugDir, 'evidence');
    if (existsSync(evidenceDir)) {
      for (const name of readdirSync(evidenceDir).sort()) {
        const path = join(evidenceDir, name);
        records.push(fileInput(agentRoot, path));
      }
    }
    for (const ref of Array.isArray(bug.evidence_refs) ? bug.evidence_refs : []) {
      const path = findHarnessEvidence(agentRoot, ref);
      records.push(path
        ? fileInput(agentRoot, path, { ref })
        : { ref, missing: true });
    }
  }

  return records.sort((a, b) => String(a.ref || a.path).localeCompare(String(b.ref || b.path)));
}

const verificationClass = (status) => {
  if (['已验证', '已验收', '已归档'].includes(status)) return 'st-verified';
  if (status === '部分验证' || status === '待真机验收') return 'st-partial';
  return 'st-pending';
};

const sourceStatusClass = (status) => {
  if (status === '待开发') return 'st-dev';
  if (status === '待修复') return 'st-fix';
  if (status === '已验收') return 'st-verified';
  return 'st-confirm';
};

function bugCard(agentRoot, bug) {
  const id = bug.id || '(无id)';
  const dir = join(agentRoot, 'bugs', id);
  const stage = (f) => readMd(join(dir, `${f}.md`));
  const evDir = join(dir, 'evidence');
  let imgs = [];
  let videos = [];
  let evidenceDocs = [];
  if (existsSync(evDir)) {
    try {
      const files = readdirSync(evDir).sort();
      imgs = files.filter((file) => imageExtension.test(file));
      videos = files.filter((file) => videoExtension.test(file));
      evidenceDocs = files
        .filter((f) => /\.(md|txt|json)$/i.test(f))
        .map((f) => ({ label: f, text: readEvidenceText(join(evDir, f)) }));
    } catch { /* ignore */ }
  }
  const sev = esc(bug.severity || '普通');
  const sourceStatus = bug.source_status || bug.status || bug.raw?.['状态'] || '未同步';
  const verificationStatus = bug.verification_status || '待验证';
  const rawMod = bug.module || bug.raw?.['﻿模块'] || bug.raw?.['模块'] || '';
  const rawPg = bug.page || bug.raw?.['页面'] || '';
  const moduleName = esc(rawMod || '常规组件');
  const pageName = esc(rawPg || '全局/未指定');
  const reporter = esc(bug.reporter || bug.raw?.['提出人'] || '');

  const row = (label, txt, icon = '') => txt ? `
    <div class="detail-row">
      <div class="detail-key">${icon} ${label}</div>
      <div class="detail-val"><pre>${esc(txt)}</pre></div>
    </div>` : '';

  const shots = imgs.length
    ? `<div class="shots">${imgs.map((f) => `<figure><img src="../bugs/${encodeURIComponent(id)}/evidence/${encodeURIComponent(f)}" loading="lazy"><figcaption>${esc(f)}</figcaption></figure>`).join('')}</div>`
    : '';
  const recordings = videos.map((file) => `<p><a href="../bugs/${encodeURIComponent(id)}/evidence/${encodeURIComponent(file)}">${esc(file)}</a></p>`).join('');

  const harnessItems = (Array.isArray(bug.evidence_refs) ? bug.evidence_refs : [])
    .map((ref) => ({ ref, path: findHarnessEvidence(agentRoot, ref) }));
  const harnessDocs = harnessItems
    .filter((item) => item.path)
    .map((item) => ({ label: item.ref, text: readEvidenceText(item.path) }));
  const missingEvidence = harnessItems
    .filter((item) => !item.path)
    .map((item) => `证据引用缺失：${item.ref}`);
  const allEvidenceDocs = [...evidenceDocs, ...harnessDocs];
  const textEvidence = allEvidenceDocs.length
    ? `<div class="evidence-docs">${allEvidenceDocs.map((doc) => `
        <article class="evidence-doc">
          <div class="evidence-title">${esc(doc.label)}</div>
          <pre>${esc(doc.text)}</pre>
        </article>`).join('')}</div>`
    : '';
  const missingHtml = missingEvidence.length
    ? `<div class="evidence-missing">${missingEvidence.map(esc).join('<br>')}</div>`
    : '';
  const evidence = shots || recordings || textEvidence || missingHtml
    ? `${missingHtml}${textEvidence}${shots}${recordings}`
    : '<div class="empty-shot">（暂无验证证据）</div>';

  const verificationSummary = [
    `状态：${verificationStatus}`,
    bug.verification_scope ? `范围：${bug.verification_scope}` : '',
    bug.verified_at ? `时间：${bug.verified_at}` : '',
    bug.verification_note || '',
  ].filter(Boolean).join('\n');

  const titleText = bug.title || bug.raw?.['描述'] || id;
  const isHigh = sev === '高' || sev === 'P1' || sev === 'P0';

  return `<section class="bug-card" data-module="${moduleName}" data-status="${esc(verificationStatus)}">
    <div class="card-header">
      <div class="header-left">
        <span class="bug-badge">${esc(id)}</span>
        <span class="tag mod-tag">📂 ${moduleName}${rawPg ? ' / ' + pageName : ''}</span>
      </div>
      <div class="header-right">
        ${reporter ? `<span class="tag reporter-tag">👤 ${reporter}</span>` : ''}
        ${isHigh ? '<span class="tag high-tag">🔥 高优先级</span>' : ''}
        <span class="tag status-tag ${verificationClass(verificationStatus)}">本轮：${esc(verificationStatus)}</span>
        <span class="tag source-status-tag ${sourceStatusClass(sourceStatus)}">源状态：${esc(sourceStatus)}</span>
      </div>
    </div>

    <div class="desc-box">
      <div class="desc-title">📌 问题现象与反馈描述 (在线 Excel)</div>
      <div class="desc-text">${esc(titleText)}</div>
    </div>

    <div class="details-grid">
      ${row('复现步骤与现象', stage('repro') || bug.repro, '🔍')}
      ${row('根因分析', stage('root-cause'), '🎯')}
      ${row('影响面评估', stage('impact'), '⚡')}
      ${row('修复方案设计', stage('fix-plan'), '🛠️')}
      ${row('代码改动说明', stage('change'), '📝')}
      ${row('本轮验证结论', verificationSummary, '✅')}
      <div class="detail-row">
        <div class="detail-key">📎 验证证据</div>
        <div class="detail-val">${evidence}</div>
      </div>
    </div>
  </section>`;
}

export function buildBugReport(agentRoot) {
  const bugsPath = join(agentRoot, 'bugs.json');
  if (!existsSync(bugsPath)) throw Object.assign(new Error('缺 .agent/bugs.json（先跑 `bug import`）'), { code: 'ENOBUGS' });
  const j = JSON.parse(readFileSync(bugsPath, 'utf8'));
  const bugs = Array.isArray(j) ? j : (j.bugs || []);

  const total = bugs.length;
  const verified = bugs.filter((b) => ['已验证', '已验收', '已归档'].includes(b.verification_status)).length;
  const limited = bugs.filter((b) => ['部分验证', '待真机验收'].includes(b.verification_status)).length;
  const pendingVerification = total - verified - limited;
  const sourcePending = bugs.filter((b) => ['待修复', '待开发'].includes(b.source_status || b.status || b.raw?.['状态'])).length;
  const highSev = bugs.filter((b) => (b.severity || b.raw?.['优先级']) === '高' || b.severity === 'P1').length;

  const modules = Array.from(new Set(bugs.map((b) => (b.module || b.raw?.['﻿模块'] || b.raw?.['模块'] || '常规组件').trim()).filter(Boolean)));

  const cards = bugs.map((b) => bugCard(agentRoot, b)).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bug 深度分析与修复报告</title>
<style>
  :root {
    --bg: #0b0f19;
    --panel: #151d2a;
    --panel-header: #1e293b;
    --border: #283548;
    --fg: #f1f5f9;
    --muted: #94a3b8;
    --accent: #38bdf8;
    --red: #f43f5e;
    --red-bg: #4c1d24;
    --amber: #fbbf24;
    --amber-bg: #453010;
    --blue: #60a5fa;
    --blue-bg: #1e3a8a;
    --green: #10b981;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-sans);
    line-height: 1.6;
    font-size: 14px;
    padding-bottom: 60px;
  }
  header {
    background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
    border-bottom: 1px solid var(--border);
    padding: 32px 36px;
  }
  .header-content {
    max-width: 1200px;
    margin: 0 auto;
  }
  .header-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    color: #ffffff;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .sub-title {
    color: var(--muted);
    font-size: 13px;
    margin-top: 6px;
  }
  .stats-bar {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 20px;
  }
  .stat-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 18px;
    display: flex;
    flex-direction: column;
    min-width: 130px;
  }
  .stat-card .num {
    font-size: 20px;
    font-weight: 700;
    font-family: var(--font-mono);
    color: var(--accent);
  }
  .stat-card.red .num { color: var(--red); }
  .stat-card.amber .num { color: var(--amber); }
  .stat-card.high .num { color: #f87171; }
  .stat-card .label {
    font-size: 12px;
    color: var(--muted);
    margin-top: 2px;
  }
  main {
    max-width: 1200px;
    margin: 24px auto;
    padding: 0 20px;
  }
  .filter-bar {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 24px;
    padding: 14px 18px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .filter-label {
    font-weight: 600;
    color: var(--muted);
    font-size: 13px;
    margin-right: 6px;
  }
  .filter-btn {
    appearance: none;
    background: var(--panel-header);
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 20px;
    padding: 5px 14px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .filter-btn:hover { border-color: var(--accent); color: var(--accent); }
  .filter-btn.active { background: var(--accent); color: #000000; border-color: var(--accent); font-weight: 700; }
  .bugs-list {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .bug-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 22px 24px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    transition: transform 0.15s, border-color 0.15s;
  }
  .bug-card:hover {
    border-color: #3b82f6;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 14px;
    margin-bottom: 16px;
  }
  .header-left, .header-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .bug-badge {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--accent);
    background: #0c4a6e;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid #0284c7;
  }
  .tag {
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 20px;
    border: 1px solid var(--border);
    background: var(--panel-header);
  }
  .mod-tag { color: #cbd5e1; }
  .reporter-tag { color: var(--muted); }
  .high-tag { background: #450a0a; color: #fca5a5; border-color: #991b1b; font-weight: 600; }
  .status-tag.st-fix { background: var(--red-bg); color: #fca5a5; border-color: var(--red); font-weight: 600; }
  .status-tag.st-dev { background: var(--amber-bg); color: #fde047; border-color: var(--amber); font-weight: 600; }
  .status-tag.st-confirm { background: var(--blue-bg); color: #93c5fd; border-color: var(--blue); }
  .status-tag.st-verified, .source-status-tag.st-verified { background: #052e25; color: #6ee7b7; border-color: var(--green); font-weight: 600; }
  .status-tag.st-partial { background: #422006; color: #fcd34d; border-color: #d97706; font-weight: 600; }
  .status-tag.st-pending { background: #1e293b; color: #cbd5e1; border-color: #64748b; }
  .source-status-tag { color: var(--muted); }
  .source-status-tag.st-fix { color: #fca5a5; border-color: #7f1d1d; }
  .source-status-tag.st-dev { color: #fde047; border-color: #854d0e; }
  .source-status-tag.st-confirm { color: #93c5fd; border-color: #1e40af; }
  .desc-box {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-left: 4px solid var(--accent);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 16px;
  }
  .desc-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }
  .desc-text {
    font-size: 15px;
    font-weight: 600;
    color: #ffffff;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
  }
  .details-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .detail-row {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 16px;
    padding: 10px 0;
    border-top: 1px dashed #1e293b;
  }
  .detail-key {
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
  }
  .detail-val pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono);
    font-size: 13px;
    color: #e2e8f0;
  }
  .shots { display: flex; flex-wrap: wrap; gap: 12px; }
  .shots img { max-width: 340px; border: 1px solid var(--border); border-radius: 8px; display: block; }
  .evidence-docs { display: grid; gap: 10px; margin-bottom: 12px; }
  .evidence-doc { background: #0f172a; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .evidence-title { padding: 7px 10px; color: var(--accent); background: #111827; border-bottom: 1px solid var(--border); font-family: var(--font-mono); font-size: 12px; }
  .evidence-doc pre { padding: 10px; max-height: 360px; overflow: auto; }
  .evidence-missing { margin-bottom: 10px; padding: 9px 11px; color: #fecaca; background: #450a0a; border: 1px solid #991b1b; border-radius: 8px; font-size: 12px; }
  figcaption { color: var(--muted); font-size: 11px; margin-top: 4px; }
  .empty-shot { color: var(--muted); font-style: italic; font-size: 12px; }
</style>
</head>
<body>
<header>
  <div class="header-content">
    <div class="header-title-row">
      <div>
        <h1>🩹 Bug 深度分析与修复报告</h1>
        <div class="sub-title">源系统状态与本轮验证状态分离展示 · 证据直接回读自 harness 与 Bug 验证记录</div>
      </div>
    </div>
    <div class="stats-bar">
      <div class="stat-card">
        <span class="num">${total}</span>
        <span class="label">台账总数</span>
      </div>
      <div class="stat-card">
        <span class="num">${verified}</span>
        <span class="label">本轮已验证</span>
      </div>
      <div class="stat-card amber">
        <span class="num">${limited}</span>
        <span class="label">受限 / 待真机</span>
      </div>
      <div class="stat-card red">
        <span class="num">${sourcePending}</span>
        <span class="label">源系统仍待处理</span>
      </div>
      <div class="stat-card">
        <span class="num">${pendingVerification}</span>
        <span class="label">本轮待验证</span>
      </div>
      <div class="stat-card high">
        <span class="num">${highSev}</span>
        <span class="label">🔥 高优先级</span>
      </div>
    </div>
  </div>
</header>

<main>
  <div class="filter-bar">
    <span class="filter-label">模块筛选:</span>
    <button class="filter-btn active" data-mod="ALL">全部模块 (${total})</button>
    ${modules.map((m) => {
      const count = bugs.filter((b) => (b.module || b.raw?.['﻿模块'] || b.raw?.['模块'] || '常规组件').trim() === m).length;
      return `<button class="filter-btn" data-mod="${esc(m)}">${esc(m)} (${count})</button>`;
    }).join('')}
  </div>

  <div class="bugs-list" id="bugsContainer">
    ${cards || '<p class="empty-shot">暂无待处理 Bug 记录</p>'}
  </div>
</main>

<script>
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mod = btn.dataset.mod;
      document.querySelectorAll('.bug-card').forEach(card => {
        if (mod === 'ALL' || card.dataset.module === mod) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });
</script>
</body>
</html>`;
}

export function buildBugReportBundle(agentRoot) {
  const bugsPath = join(agentRoot, 'bugs.json');
  if (!existsSync(bugsPath))
    throw Object.assign(new Error('缺 .agent/bugs.json（先跑 `bug import`）'), { code: 'ENOBUGS' });
  const parsed = JSON.parse(readFileSync(bugsPath, 'utf8'));
  const bugs = Array.isArray(parsed) ? parsed : (parsed.bugs || []);
  const html = buildBugReport(agentRoot);
  return {
    html,
    manifest: {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      inputs: collectReportInputs(agentRoot, bugs),
      output_sha256: sha256(Buffer.from(html)),
    },
  };
}

export function writeBugReport(agentRoot, outputPath = join(agentRoot, 'reports', 'index.html')) {
  const { html, manifest } = buildBugReportBundle(agentRoot);
  mkdirSync(dirname(outputPath), { recursive: true });
  atomicWriteFile(outputPath, html);
  const manifestPath = join(dirname(outputPath), 'manifest.json');
  writeJsonAtomic(manifestPath, manifest);
  return { outputPath, manifestPath };
}

function inputKey(record) {
  return String(record.ref || record.path);
}

export function checkBugReport(agentRoot, outputPath = join(agentRoot, 'reports', 'index.html')) {
  const reasons = [];
  const manifestPath = join(dirname(outputPath), 'manifest.json');
  if (!existsSync(manifestPath)) return { fresh: false, reasons: ['missing report manifest'] };
  if (!existsSync(outputPath))
    return { fresh: false, reasons: [`missing report output: ${relative(agentRoot, outputPath)}`] };

  const saved = readJson(manifestPath);
  const current = buildBugReportBundle(agentRoot).manifest;
  const savedInputs = new Map((saved.inputs || []).map((record) => [inputKey(record), record]));
  const currentInputs = new Map((current.inputs || []).map((record) => [inputKey(record), record]));

  for (const record of current.inputs || []) {
    const key = inputKey(record);
    if (record.missing) {
      reasons.push(`missing evidence: ${key}`);
      continue;
    }
    const previous = savedInputs.get(key);
    if (!previous) reasons.push(`input added: ${key}`);
    else if (previous.missing || previous.sha256 !== record.sha256)
      reasons.push(`input changed: ${key}`);
  }
  for (const key of savedInputs.keys()) {
    if (!currentInputs.has(key)) reasons.push(`input removed: ${key}`);
  }

  const outputHash = sha256(readFileSync(outputPath));
  if (outputHash !== saved.output_sha256)
    reasons.push(`output changed: ${relative(agentRoot, outputPath)}`);

  return { fresh: reasons.length === 0, reasons: [...new Set(reasons)] };
}
