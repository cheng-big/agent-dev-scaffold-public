// 项目反馈事实账：结构化 JSONL 真源 + 中文 Markdown 投影。

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { agentRoot, atomicWriteFile, nowIso, redact } from './store.mjs';

const GENERATED_START = '<!-- FEEDBACK:GENERATED-START -->';
const GENERATED_END = '<!-- FEEDBACK:GENERATED-END -->';
const MANUAL_START = '<!-- FEEDBACK:MANUAL-NOTES-START -->';
const MANUAL_END = '<!-- FEEDBACK:MANUAL-NOTES-END -->';
const STATUSES = ['待定位', '处理中', '已修复待验证', '已验证待归档', '已归档', '延后'];
const SIGNALS = ['问题', 'bug', '报错', '异常', '失败', '不对', '不应该', '打不开', '不能', '缺失', '遗漏', '不好用', '需要修复'];
const EXPLICIT_CAPTURE = ['记入复盘'];
const NEGATED = /(?:没有|没|无)(?:任何)?\s*(?:问题|异常|报错|bug)|不是(?:一个)?\s*(?:问题|bug)|不算\s*(?:问题|bug)/i;
const HYPOTHETICAL = /(?:如果|假如|假设|以后|将来)|(?:如何|怎么)(?:管理|记录|处理)(?:问题|bug)/i;
const GENERIC = /(?:介绍|说明|讲讲|什么是).{0,8}(?:bug|问题)|(?:bug|问题)(?:管理|流程|规范)/i;
const QUOTED_DISCUSSION = /(?:文档|需求|规则|示例|原文|说明).{0,16}(?:写着|写了|提到|包含|例如|举例).{0,32}(?:问题|bug|报错|异常|失败|不对|打不开|不能|缺失)/i;
const LOCK_STALE_MS = 60_000;

export function feedbackProjectRoot() {
  return dirname(agentRoot());
}

export function feedbackPaths(root = feedbackProjectRoot()) {
  const docs = join(root, 'docs', 'retrospective');
  return {
    docs,
    ledger: join(docs, 'feedback.jsonl'),
    markdown: join(docs, '项目复盘待办.md'),
    evolutionInput: join(docs, '已归档反馈.md'),
    evolution: join(docs, 'evolution.json'),
    lock: join(root, '.agent', 'retrospective', 'feedback.lock'),
  };
}

function error(message, code = 'EFEEDBACK') {
  return Object.assign(new Error(message), { code });
}

function staleFeedbackLockToken(lockPath) {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs <= LOCK_STALE_MS) return '';
    const payload = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (!Number.isInteger(payload.pid)) return payload.token || '(legacy-malformed)';
    try {
      process.kill(payload.pid, 0);
      return '';
    } catch (cause) {
      return cause.code === 'ESRCH' ? (payload.token || '(legacy-dead)') : '';
    }
  } catch {
    return '(unreadable)';
  }
}

function acquireFeedbackLock(root) {
  const lockPath = feedbackPaths(root).lock;
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = randomUUID();
  try {
    const fd = openSync(lockPath, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, token, at: nowIso() }));
    closeSync(fd);
  } catch (cause) {
    if (cause.code !== 'EEXIST') throw cause;
    const staleToken = staleFeedbackLockToken(lockPath);
    if (!staleToken) throw error(`反馈账本正被另一进程锁定：${lockPath}`, 'ELOCKED');
    let currentToken = '';
    try { currentToken = JSON.parse(readFileSync(lockPath, 'utf8')).token || '(legacy-malformed)'; } catch { currentToken = '(unreadable)'; }
    if (currentToken !== staleToken) throw error(`反馈锁持有者已变化，拒绝夺锁：${lockPath}`, 'ELOCKED');
    try { unlinkSync(lockPath); } catch {}
    const fd = openSync(lockPath, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, token, at: nowIso() }));
    closeSync(fd);
  }
  return () => {
    try {
      const current = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (current.token === token) unlinkSync(lockPath);
    } catch {}
  };
}

function withFeedbackLock(root, operation) {
  const release = acquireFeedbackLock(root);
  try { return operation(); } finally { release(); }
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function redactFeedbackText(value, maxLength = 4000) {
  return String(redact(String(value || '')))
    .replace(/(?<!\d)(1[3-9]\d)(\d{4})(\d{4})(?!\d)/g, '$1****$3')
    .trim()
    .slice(0, maxLength);
}

function fingerprint(source, title, symptom) {
  return createHash('sha256')
    .update([source, normalize(title), normalize(symptom)].join('\n'))
    .digest('hex');
}

export function classifyFeedbackSignal(text) {
  const value = String(text || '').trim();
  const lowered = value.toLowerCase();
  const explicitKeywords = EXPLICIT_CAPTURE.filter((keyword) => lowered.includes(keyword.toLowerCase()));
  const keywords = SIGNALS.filter((keyword) => lowered.includes(keyword.toLowerCase()));
  if (explicitKeywords.length) return { capture: true, explicit: true, keywords: explicitKeywords, reason: 'explicit-keyword' };
  if (!keywords.length) return { capture: false, explicit: false, keywords: [], reason: 'no-signal' };
  if (NEGATED.test(value)) return { capture: false, explicit: false, keywords, reason: 'negated' };
  if (QUOTED_DISCUSSION.test(value)) return { capture: false, explicit: false, keywords, reason: 'quoted-discussion' };
  const firstSignal = Math.min(...keywords.map((keyword) => lowered.indexOf(keyword.toLowerCase())).filter((index) => index >= 0));
  const hypothetical = value.search(HYPOTHETICAL);
  if (hypothetical >= 0 && hypothetical <= firstSignal) return { capture: false, explicit: false, keywords, reason: 'hypothetical' };
  if (GENERIC.test(value)) return { capture: false, explicit: false, keywords, reason: 'generic-discussion' };
  return { capture: true, explicit: false, keywords, reason: 'concrete-signal' };
}

export function loadFeedback(root = feedbackProjectRoot()) {
  const file = feedbackPaths(root).ledger;
  if (!existsSync(file)) return [];
  const records = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try { return JSON.parse(line); }
      catch { throw error(`反馈账本第 ${index + 1} 行不是合法 JSON：${file}`, 'EINVALID_FEEDBACK'); }
    });
  const ids = new Set();
  const fingerprints = new Set();
  for (const record of records) {
    validateRecord(record);
    if (ids.has(record.id)) throw error(`反馈账本存在重复 ID：${record.id}`, 'EINVALID_FEEDBACK');
    if (fingerprints.has(record.fingerprint)) throw error(`反馈账本存在重复 fingerprint：${record.id}`, 'EINVALID_FEEDBACK');
    ids.add(record.id);
    fingerprints.add(record.fingerprint);
  }
  return records;
}

function manualNotesFromMarkdown(markdown) {
  const start = markdown.indexOf(MANUAL_START);
  const end = markdown.indexOf(MANUAL_END);
  if (start < 0 || end < start) return '';
  return markdown.slice(start + MANUAL_START.length, end).trim();
}

function existingManualNotes(root) {
  const file = feedbackPaths(root).markdown;
  return existsSync(file) ? manualNotesFromMarkdown(readFileSync(file, 'utf8')) : '';
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function displayStatus(record) {
  return record.status || '待定位';
}

function displayIssue(record) {
  if (!record.symptom || normalize(record.title) === normalize(record.symptom)) return record.title || record.symptom;
  return `${record.title}：${record.symptom}`;
}

function displayEngineeringImpact(record) {
  const values = [record.impact, record.resolution ? `处置：${record.resolution}` : ''].filter(Boolean);
  return values.join('；');
}

function sortRecords(records) {
  return [...records].sort((left, right) => {
    const prefix = left.id[0].localeCompare(right.id[0]);
    return prefix || Number(left.id.replace(/\D/g, '')) - Number(right.id.replace(/\D/g, ''));
  });
}

export function renderFeedbackDocument({ root = feedbackProjectRoot(), records, manualNotes, includeScaffold = true } = {}) {
  const all = sortRecords(records || loadFeedback(root));
  const notes = manualNotes === undefined ? existingManualNotes(root) : String(manualNotes || '').trim();
  const users = all.filter((record) => record.source === 'user');
  const engineering = all.filter((record) => record.source === 'engineering');
  const lastUpdated = all.map((record) => record.updated_at).filter(Boolean).sort().at(-1) || '（暂无记录）';
  const lines = [
    '# 项目复盘待办',
    '',
    '> 本文由 `.agent feedback` 自动维护；结构化真源为 `feedback.jsonl`。请通过 CLI 更新生成区。',
    `> 最后更新：${lastUpdated}`,
    '',
    GENERATED_START,
    '',
    '## 用户反馈与处置',
    '',
    '| 编号 | 用户反馈 / 现象 | 根因 | 本轮处置 | 状态 |',
    '|---|---|---|---|---|',
    ...(users.length ? users.map((record) => `| ${record.id} | ${escapeCell(displayIssue(record))} | ${escapeCell(record.root_cause)} | ${escapeCell(record.resolution)} | ${displayStatus(record)} |`) : ['| - | 暂无 |  |  |  |']),
    '',
    '## 实施过程暴露的工程问题',
    '',
    '| 编号 | 现象 | 定位结果 | 影响 | 状态 |',
    '|---|---|---|---|---|',
    ...(engineering.length ? engineering.map((record) => `| ${record.id} | ${escapeCell(displayIssue(record))} | ${escapeCell(record.root_cause)} | ${escapeCell(displayEngineeringImpact(record))} | ${displayStatus(record)} |`) : ['| - | 暂无 |  |  |  |']),
    '',
    '## 通用脚手架待审建议',
    '',
    ...(includeScaffold ? all.filter((record) => record.status === '已归档' && record.scaffold_candidate)
      .map((record) => `- ${record.bug_id} / ${record.id}：${escapeCell(record.scaffold_candidate)}`) : []),
    '',
    GENERATED_END,
    '',
    MANUAL_START,
    notes,
    MANUAL_END,
    '',
  ];
  return lines.join('\n');
}

function ensureSafeToRender(root) {
  const paths = feedbackPaths(root);
  if (!existsSync(paths.markdown) || existsSync(paths.ledger)) return;
  throw error(`已有复盘文档但结构化账本缺失；先运行 feedback import --file ${paths.markdown}`, 'EIMPORT_REQUIRED');
}

function validateRecord(record) {
  if (!/^[UE]-\d+$/i.test(record.id || '')) throw error(`反馈 ID 非法：${record.id || '(空)'}`, 'EINVALID_FEEDBACK');
  if (!['user', 'engineering'].includes(record.source)) throw error(`反馈来源非法：${record.source}`, 'EINPUT');
  if (!record.title || !record.symptom) throw error('反馈必须包含 title 和 symptom', 'EINPUT');
  if (!STATUSES.includes(record.status)) throw error(`反馈状态非法：${record.status}`, 'EINPUT');
  if (!/^[a-f0-9]{64}$/i.test(record.fingerprint || '')) throw error(`反馈 fingerprint 非法：${record.id}`, 'EINVALID_FEEDBACK');
  if (record.status === '已归档' && (!record.root_cause || !record.resolution)) {
    throw error('归档反馈必须填写 root cause（根因）和 resolution（处置）', 'EINCOMPLETE_FEEDBACK');
  }
  if (record.status === '延后' && !record.resolution) throw error('延后反馈必须填写处置理由', 'EINCOMPLETE_FEEDBACK');
}

function persistFeedback(root, records, { manualNotes } = {}) {
  const paths = feedbackPaths(root);
  mkdirSync(paths.docs, { recursive: true });
  for (const record of records) validateRecord(record);
  const content = sortRecords(records).map((record) => JSON.stringify(record)).join('\n');
  atomicWriteFile(paths.ledger, content ? `${content}\n` : '');
  atomicWriteFile(paths.markdown, renderFeedbackDocument({ root, records, manualNotes }));
}

function nextId(records, source) {
  const prefix = source === 'user' ? 'U' : 'E';
  const max = records
    .filter((record) => record.id?.startsWith(`${prefix}-`))
    .reduce((value, record) => Math.max(value, Number(record.id.replace(/\D/g, '')) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export function addFeedback({
  root = feedbackProjectRoot(), source, title, symptom, phaseId = '', taskId = '', evidence = [], bugId,
}) {
  return withFeedbackLock(root, () => {
    ensureSafeToRender(root);
    const records = loadFeedback(root);
    const safeTitle = redactFeedbackText(title, 280);
    const safeSymptom = redactFeedbackText(symptom, 4000);
    const digest = fingerprint(source, safeTitle, bugId ? `${bugId}: ${safeSymptom}` : safeSymptom);
    const duplicate = records.find((record) => bugId ? record.bug_id === bugId : record.fingerprint === digest);
    if (bugId && duplicate) return { record: duplicate, duplicate: true, reopened: false };
    if (duplicate && ['已归档', '延后'].includes(duplicate.status)) {
      duplicate.previous_closures = [...(duplicate.previous_closures || []), {
        status: duplicate.status,
        root_cause: duplicate.root_cause,
        resolution: duplicate.resolution,
        impact: duplicate.impact,
        closed_at: duplicate.updated_at,
      }].slice(-10);
      duplicate.status = '待定位';
      duplicate.root_cause = '';
      duplicate.resolution = '';
      duplicate.impact = '';
      duplicate.reopened_count = Number(duplicate.reopened_count || 0) + 1;
      duplicate.updated_at = nowIso();
      duplicate.evidence = [...new Set([
        ...(duplicate.evidence || []),
        ...[].concat(evidence || []).map((value) => redactFeedbackText(value, 500)).filter(Boolean),
      ])];
      persistFeedback(root, records);
      return { record: duplicate, duplicate: true, reopened: true };
    }
    if (duplicate) return { record: duplicate, duplicate: true, reopened: false };
    const at = nowIso();
    const record = {
      id: nextId(records, source),
      source,
      title: safeTitle,
      symptom: safeSymptom,
      root_cause: '',
      resolution: '',
      impact: '',
      status: '待定位',
      phase_id: String(phaseId || ''),
      task_id: String(taskId || ''),
      evidence: [...new Set([].concat(evidence || []).map((value) => redactFeedbackText(value, 500)).filter(Boolean))],
      fingerprint: digest,
      created_at: at,
      updated_at: at,
      ...(bugId ? { bug_id: bugId } : {}),
    };
    validateRecord(record);
    records.push(record);
    persistFeedback(root, records);
    return { record, duplicate: false, reopened: false };
  });
}

function mutateFeedback({ root, id, rootCause, resolution, impact, status, evidence, scaffoldCandidate, allowTerminal }) {
  return withFeedbackLock(root, () => {
    const records = loadFeedback(root);
    const record = records.find((item) => item.id === id);
    if (!record) throw error(`反馈不存在：${id}`, 'ENOFEEDBACK');
    if (rootCause !== undefined) record.root_cause = redactFeedbackText(rootCause, 4000);
    if (resolution !== undefined) record.resolution = redactFeedbackText(resolution, 4000);
    if (impact !== undefined) record.impact = redactFeedbackText(impact, 4000);
    if (scaffoldCandidate !== undefined) record.scaffold_candidate = redactFeedbackText(scaffoldCandidate, 4000);
    if (status !== undefined && ['已归档', '延后'].includes(String(status)) && !allowTerminal) {
      throw error('终态只能通过 feedback close 设置，确保自动触发 Evolver', 'EINPUT');
    }
    if (status !== undefined) record.status = String(status);
    if (evidence !== undefined) record.evidence = [...new Set([].concat(evidence || []).map((value) => redactFeedbackText(value, 500)).filter(Boolean))];
    record.updated_at = nowIso();
    validateRecord(record);
    persistFeedback(root, records);
    return record;
  });
}

export function updateFeedback({
  root = feedbackProjectRoot(), id, rootCause, resolution, impact, status, evidence,
}) {
  return mutateFeedback({ root, id, rootCause, resolution, impact, status, evidence, allowTerminal: false });
}

export function closeFeedback({
  root = feedbackProjectRoot(), id, rootCause, resolution, impact, status = '已归档', evidence, scaffoldCandidate,
}) {
  if (!['已归档', '延后'].includes(status)) throw error('feedback close 的 status 只允许 已归档 或 延后', 'EINPUT');
  return mutateFeedback({ root, id, rootCause, resolution, impact, status, evidence, scaffoldCandidate, allowTerminal: true });
}

function splitRow(line) {
  return String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function legacyStatus(value) {
  const status = String(value || '').trim();
  if (STATUSES.includes(status)) return status;
  if (/复盘已关闭|已归档/.test(status)) return '已归档';
  if (/已验证/.test(status)) return '已验证待归档';
  if (/已修复/.test(status)) return '已修复待验证';
  if (/处理中/.test(status)) return '处理中';
  if (/延后/.test(status)) return '延后';
  return '待定位';
}

function parseLegacyMarkdown(markdown) {
  const lines = markdown.split('\n');
  const records = [];
  let lastFeedbackLine = -1;
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim().startsWith('|') || !/^\s*\|?(?:\s*:?-+:?\s*\|)+/.test(lines[index + 1])) continue;
    const headers = splitRow(lines[index]);
    const titleIndex = headers.findIndex((header) => /用户反馈|现象|问题|title|bug/i.test(header));
    const causeIndex = headers.findIndex((header) => /根因|定位结果|cause/i.test(header));
    const resolutionIndex = headers.findIndex((header) => /本轮处置|修复|解决|corrective/i.test(header));
    const impactIndex = headers.findIndex((header) => /影响|impact/i.test(header));
    const statusIndex = headers.findIndex((header) => /状态|status/i.test(header));
    let cursor = index + 2;
    while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
      const cells = splitRow(lines[cursor]);
      const id = cells[0] || '';
      if (/^[UE]-\d+$/i.test(id)) {
        const source = id.toUpperCase().startsWith('U-') ? 'user' : 'engineering';
        const title = redactFeedbackText(cells[titleIndex >= 0 ? titleIndex : 1] || '', 280);
        const symptom = title;
        const at = nowIso();
        const record = {
          id: id.toUpperCase(), source, title, symptom,
          root_cause: redactFeedbackText(cells[causeIndex] || ''),
          resolution: redactFeedbackText(cells[resolutionIndex] || ''),
          impact: redactFeedbackText(cells[impactIndex] || ''),
          status: legacyStatus(cells[statusIndex] || ''),
          phase_id: '', task_id: '', evidence: [],
          fingerprint: fingerprint(source, title, symptom),
          created_at: at, updated_at: at,
        };
        if (record.status === '已归档' && !record.resolution) record.resolution = record.impact || '历史记录已归档';
        validateRecord(record);
        records.push(record);
        lastFeedbackLine = cursor;
      }
      cursor += 1;
    }
    index = cursor - 1;
  }
  const manualNotes = lastFeedbackLine >= 0 ? lines.slice(lastFeedbackLine + 1).join('\n').trim() : '';
  return { records, manualNotes };
}

function backupPathFor(file) {
  const extension = extname(file);
  const stem = basename(file, extension);
  let candidate = join(dirname(file), `${stem}.legacy${extension}`);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = join(dirname(file), `${stem}.legacy-${index}${extension}`);
    index += 1;
  }
  return candidate;
}

export function importFeedbackMarkdown({ root = feedbackProjectRoot(), file }) {
  return withFeedbackLock(root, () => {
    const source = String(file || feedbackPaths(root).markdown);
    if (!existsSync(source)) throw error(`复盘文档不存在：${source}`, 'EINPUT');
    if (existsSync(feedbackPaths(root).ledger)) throw error('反馈账本已存在，拒绝重复导入', 'EEXISTS');
    const canonical = feedbackPaths(root).markdown;
    if (existsSync(canonical) && resolve(source) !== resolve(canonical)) {
      throw error(`主复盘文档已存在，必须先导入它以防覆盖：${canonical}`, 'EIMPORT_REQUIRED');
    }
    const original = readFileSync(source, 'utf8');
    const { records, manualNotes } = parseLegacyMarkdown(original);
    if (!records.length) throw error('复盘文档中没有识别到 U/E 编号反馈', 'EINPUT');
    const backupPath = backupPathFor(source);
    atomicWriteFile(backupPath, original);
    persistFeedback(root, records, { manualNotes });
    return { imported: records.length, backupPath };
  });
}

export function feedbackStatuses() {
  return [...STATUSES];
}
