// 反馈闭环门禁：离线运行 Harness Evolver，并阻断带未闭环反馈的交付完成。

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { delimiter, isAbsolute, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { atomicWriteFile, nowIso, writeJsonAtomic } from './store.mjs';
import {
  feedbackPaths,
  loadFeedback,
  renderFeedbackDocument,
} from './feedback.mjs';

const GATED_PHASES = new Set(['delivery', 'report']);
const OPEN_STATUSES = new Set(['待定位', '处理中', '已修复待验证', '已验证待归档']);

function gateError(message, code = 'EEVOLUTION') {
  return Object.assign(new Error(message), { code });
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function loadEvolutionState(root) {
  const file = feedbackPaths(root).evolution;
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw gateError(`反馈进化状态不是合法 JSON：${file}`, 'EINVALID_EVOLUTION'); }
}

function reportExists(root, reportPath) {
  if (!reportPath) return false;
  const file = isAbsolute(reportPath) ? reportPath : join(root, reportPath);
  try {
    const stat = statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch { return false; }
}

function parseJsonOutput(stdout) {
  const lines = String(stdout || '').trim().split('\n').filter(Boolean);
  if (!lines.length) throw gateError('Evolver 未返回 JSON 结果');
  try { return JSON.parse(lines.at(-1)); }
  catch { throw gateError(`Evolver 返回不可解析：${lines.at(-1).slice(0, 240)}`); }
}

function invokeEvolver({ root, markdown, spawn }) {
  const args = [
    '-m', 'harness_evolver.evolve',
    '--input-docs', markdown,
    '--use-llm', 'never',
    '--project-root', root,
    '--json',
  ];
  const env = {
    ...process.env,
    PYTHONPATH: [root, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  };
  const candidates = [process.env.HARNESS_EVOLVER_PYTHON, 'python3', 'python'].filter(Boolean);
  let failure = '';
  for (const command of candidates) {
    const result = spawn(command, args, { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
    if (result.status === 0) return { command, args, output: parseJsonOutput(result.stdout) };
    if (result.error?.code === 'ENOENT') continue;
    failure = String(result.stderr || result.stdout || result.error?.message || `exit ${result.status}`).trim().slice(0, 600);
    break;
  }
  throw gateError(`反馈规则演进失败：${failure || '未找到可用 Python'}`);
}

function persistPending(root, { reason, documentSha, previous, message }) {
  const state = {
    schema_version: 1,
    document_sha256: documentSha,
    report_path: previous?.report_path || '',
    evolved_at: previous?.evolved_at || null,
    attempted_at: nowIso(),
    reason,
    pending: true,
    error: message,
    added_rule_ids: previous?.added_rule_ids || [],
    removed_rule_ids: previous?.removed_rule_ids || [],
  };
  writeJsonAtomic(feedbackPaths(root).evolution, state);
  return state;
}

export function runFeedbackEvolution({
  root,
  reason = 'manual',
  force = false,
  spawn = spawnSync,
} = {}) {
  if (!root) throw gateError('runFeedbackEvolution 缺少 root', 'EINPUT');
  const paths = feedbackPaths(root);
  const records = loadFeedback(root);
  if (existsSync(paths.markdown) && !existsSync(paths.ledger)) {
    throw gateError(`已有复盘文档但尚未导入结构化账本；先运行 feedback import --file ${paths.markdown}`, 'EIMPORT_REQUIRED');
  }
  let evolutionInput = paths.markdown;
  if (records.length) {
    atomicWriteFile(paths.markdown, renderFeedbackDocument({ root, records }));
    const archived = records.filter((record) => ['已归档', '延后'].includes(record.status));
    if (!archived.length) return { gated: true, skipped: true, reason: 'no-archived-feedback', state: loadEvolutionState(root) };
    atomicWriteFile(paths.evolutionInput, renderFeedbackDocument({ root, records: archived, manualNotes: '', includeScaffold: false }));
    evolutionInput = paths.evolutionInput;
  }
  if (!existsSync(evolutionInput)) {
    return { gated: true, skipped: true, reason: 'no-feedback', state: null };
  }
  const documentSha = sha256File(evolutionInput);
  const previous = loadEvolutionState(root);
  if (
    !force
    && previous
    && previous.pending === false
    && previous.document_sha256 === documentSha
    && reportExists(root, previous.report_path)
  ) {
    return { gated: true, skipped: true, reason: 'unchanged', state: previous };
  }

  try {
    const { command, args, output } = invokeEvolver({ root, markdown: evolutionInput, spawn });
    if (output.ok === false) throw gateError(output.error || 'Evolver 返回失败');
    const reportPath = output.report_path || '';
    const absoluteReport = isAbsolute(reportPath) ? reportPath : join(root, reportPath);
    if (!reportPath || !reportExists(root, reportPath)) throw gateError(`Evolver 报告不可回读或不是非空文件：${reportPath || '(空)'}`);
    const relativeReport = relative(realpathSync(root), realpathSync(absoluteReport));
    if (relativeReport.startsWith('..') || isAbsolute(relativeReport)) throw gateError(`Evolver 报告越出项目根：${reportPath}`);
    const state = {
      schema_version: 1,
      document_sha256: documentSha,
      report_path: relativeReport,
      evolved_at: nowIso(),
      attempted_at: nowIso(),
      reason,
      pending: false,
      error: '',
      added_rule_ids: output.added_rule_ids || [],
      removed_rule_ids: output.removed_rule_ids || [],
      analyzer_stages: output.stages || {},
      command,
      args: args.map((value) => {
        if (value === root) return '.';
        if (value === evolutionInput) return relative(root, evolutionInput);
        return value;
      }),
    };
    writeJsonAtomic(paths.evolution, state);
    return { gated: true, skipped: false, reason, state, output };
  } catch (cause) {
    persistPending(root, {
      reason,
      documentSha,
      previous,
      message: cause.message,
    });
    throw cause;
  }
}

export function assertFeedbackCompletionGate({ root, phaseId, spawn = spawnSync } = {}) {
  if (!GATED_PHASES.has(String(phaseId || ''))) {
    return { gated: false, skipped: true, reason: 'phase-not-gated' };
  }
  const records = loadFeedback(root);
  const open = records.filter((record) => OPEN_STATUSES.has(record.status));
  if (open.length) {
    const ids = open.map((record) => record.id).join(', ');
    throw gateError(`交付门禁发现未闭环反馈：${ids}。先定位、验证并归档或明确延后。`, 'EOPEN_FEEDBACK');
  }
  return runFeedbackEvolution({ root, reason: `${phaseId}-completion-gate`, spawn });
}
