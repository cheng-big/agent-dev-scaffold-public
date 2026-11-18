#!/usr/bin/env node
// 外部任务记忆与可恢复执行 CLI。零依赖。
// 用法：node .agent/scripts/agent.mjs <命令> [--flag value ...]
// 每个改状态的命令：校验输入 → 校验状态转换 → 原子更新 → 写日志 → 失败非零退出 → 机读(--json)+人读错误。

import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, appendFileSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  paths, ensureDirs, nowIso, shortId, redact, writeJsonAtomic, byteSize, listTaskIds, readJson,
  atomicWriteFile, isBugfixSidecar, useBugfixSidecar,
} from './lib/store.mjs';
import {
  newTask, loadTask, taskExists, updateTask, writeTaskChecked,
  loadActive, setActive, requireActiveId, assertValidTask,
} from './lib/task.mjs';
import { appendEvent, readEvents, hasCommittedIdem, findInterruptedSteps } from './lib/journal.mjs';
import { guard } from './lib/statemachine.mjs';
import { buildContext, buildCheckpoint, projectProfileStatus } from './lib/context.mjs';
import { validate } from './lib/schema.mjs';
import {
  processPath, statePath, processExists, initProcessFile, loadProcess, loadState, saveState,
  freshState, findPhase, seedPhaseTask, computePhaseView, computeNext, phaseTaskId, phaseStatus,
  worklistDef, addSystem, setWorklistStatus,
} from './lib/process.mjs';
import { buildBoardHtml } from './lib/board.mjs';
import { installBoardHook } from './lib/hook.mjs';
import { installAgentPolicy } from './lib/agent-policy.mjs';
import {
  captureKnowledge, checkKnowledge, confirmKnowledge, deliverKnowledge, featureId, featureRefs,
  initKnowledge, readKnowledge, retrieveKnowledge,
} from './lib/knowledge.mjs';
import { detectSkill, skillBadge } from './lib/skills.mjs';
import { memoryStats } from './lib/stats.mjs';
import { parseTargets, assertExternalWriteEvidence } from './lib/effects.mjs';
import { buildRepoMap } from './lib/repomap.mjs';
import { importBugs, mergeBugLedger } from './lib/bugimport.mjs';
import { archiveBug, bugDirectory, recordBug } from './lib/buglearning.mjs';
import { buildImpactCheck } from './lib/impactcheck.mjs';
import { checkBugReport, writeBugReport } from './lib/report.mjs';
import { buildEvolutionContext } from './lib/evolver.mjs';
import {
  addFeedback,
  classifyFeedbackSignal,
  closeFeedback,
  feedbackPaths,
  feedbackProjectRoot,
  importFeedbackMarkdown,
  loadFeedback,
  updateFeedback,
} from './lib/feedback.mjs';
import {
  assertFeedbackCompletionGate,
  runFeedbackEvolution,
} from './lib/evolution-gate.mjs';

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { flags[key] = true; }
      else { // 支持重复 flag → 数组
        if (key in flags) flags[key] = [].concat(flags[key], next);
        else flags[key] = next;
        i++;
      }
    } else positional.push(a);
  }
  return { positional, flags };
}
const asArray = (v) => (v === undefined ? [] : [].concat(v));

// ---------- 输出 ----------
let JSON_MODE = false;
function ok(human, machine = {}) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: true, ...machine }) + '\n');
  else if (human) process.stdout.write(human + '\n');
}
function fail(err) {
  const code = err.code || 'EGENERIC';
  if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: false, code, error: err.message }) + '\n');
  process.stderr.write(`ERROR [${code}]: ${err.message}\n`);
  process.exit(1);
}

// ---------- git 辅助 ----------
function git(args) {
  try {
    const r = spawnSync('git', args, { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : '';
  } catch { return ''; }
}
const gitBranch = () => git(['rev-parse', '--abbrev-ref', 'HEAD']);
const repoName = () => (git(['rev-parse', '--show-toplevel']).split('/').pop() || '');

// ---------- 证据是否存在（用于 complete 守卫）----------
function taskHasVerificationEvidence(task) {
  const events = readEvents(task.task_id);
  const passed = events.some((e) => e.event === 'verification_finished' && e.payload?.result === 'pass');
  const dodEvidenced = (task.definition_of_done || []).every((d) => d.met && (d.evidence?.length || 0) > 0);
  return passed && dodEvidenced;
}

function assertDeliveryProof(taskId, proof) {
  const latest = readEvents(taskId).filter((event) => event.event === 'verification_finished').at(-1);
  const verified = latest?.payload?.result === 'pass' ? latest.references || [] : [];
  const refs = new Set(verified.filter((id) => /^ev:[\w-]+$/.test(id)).flatMap((id) => {
    try {
      const record = readJson(join(paths.evidenceDir(taskId), `${id.replace(':', '_')}.json`));
      return record.id === id && record.task_id === taskId ? [record.ref] : [];
    } catch { return []; }
  }));
  if (proof.some((path) => !refs.has(path))) throw Object.assign(new Error('--proof 必须引用本任务最近一次通过验证所使用的证据文件'), { code: 'EKNOWLEDGE' });
}

// ---------- 强引导：把「唯一下一步」追加到命令输出末尾（process 未初始化则无声跳过）----------
function nextHintLine() {
  if (!processExists()) return '';
  try {
    const p = loadProcess();
    const st = loadState(p);
    const n = computeNext(p, st);
    return `\n下一步 → ${n.hint}`;
  } catch { return ''; }
}
const withNext = (human) => `${human}${nextHintLine()}`;

function evolutionForNext(next) {
  if (!next?.phase_id) return '';
  return buildEvolutionContext({
    phaseId: next.phase_id,
    action: next.action,
    worklistTask: next.worklist_task || '',
    targetPath: next.target_path || '',
    techStack: (next.skills || []).join(','),
  });
}

function taskKnowledge(task, next, features = []) {
  return retrieveKnowledge(feedbackProjectRoot(), {
    features: features.length ? features : featureRefs(task),
    paths: [...(task?.references || []).map((ref) => ref.replace(/^输入:/, '')), next?.target_path],
  });
}

function activeTask() {
  const id = loadActive().active_task_id;
  return id && taskExists(id) ? loadTask(id) : null;
}

function taskContext(task) {
  let evolutionContext = '';
  let next = null;
  if (processExists()) {
    const p = loadProcess();
    const st = loadState(p);
    const taskPhase = Object.entries(st.phase_tasks || {}).find(([, taskId]) => taskId === task.task_id)?.[0];
    next = computeNext(p, st);
    const phaseId = taskPhase || next.phase_id || st.current_phase || '';
    evolutionContext = buildEvolutionContext({
      phaseId,
      action: next.phase_id === phaseId ? next.action : 'context',
      worklistTask: next.phase_id === phaseId ? (next.worklist_task || '') : '',
      targetPath: next.phase_id === phaseId ? (next.target_path || '') : '',
      techStack: (findPhase(p, phaseId)?.skills || []).join(','),
    });
  }
  const text = buildContext(task, {
    cwd: process.cwd(), branch: gitBranch(), repoName: repoName(), evolutionContext,
  });
  const knowledge = taskKnowledge(task, next);
  return { text: text + knowledge.text, evolutionContext, next, knowledge };
}

// 看板地址行：让每个新会话/推进都直接看到「去哪查看进度」，不用再问。
// generate=true 时顺带刷新 board.html（用于 resume：新会话第一条命令）。
function defaultBoardOut() { return join(paths.root(), isBugfixSidecar() ? 'board-bugfix.html' : 'board.html'); }
function boardLine({ generate = false } = {}) {
  if (!processExists()) return '';
  const out = defaultBoardOut();
  if (generate) {
    try {
      const p = loadProcess();
      const st = loadState(p);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, buildBoardHtml(p, st, { cwd: process.cwd(), outDir: dirname(out) }));
    } catch { /* 生成失败不阻塞 */ }
  }
  return existsSync(out)
    ? `\n📊 进度看板：${out}（浏览器打开查看；状态变了跑 \`board\` 刷新）`
    : `\n📊 进度看板：跑 \`node .agent/scripts/agent.mjs board\` 生成，产于 ${out}`;
}

// 相对时间（人读）
function relTime(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

// ---------- 命令 ----------
const commands = {};

commands.init = ({ flags }) => {
  const taskId = flags.id || `task-${nowIso().slice(0, 10)}-${shortId()}`;
  if (taskExists(taskId)) throw Object.assign(new Error(`任务已存在：${taskId}`), { code: 'EEXISTS' });
  if (!flags.objective) throw Object.assign(new Error('缺少 --objective'), { code: 'EINPUT' });
  const task = newTask({
    taskId,
    objective: String(flags.objective),
    phase: flags.phase ? String(flags.phase) : undefined,
    nextAction: flags.next ? String(flags.next) : undefined,
    dod: asArray(flags.dod).map(String),
    constraints: asArray(flags.constraint).map(String),
    references: [...asArray(flags.ref).map(String), ...asArray(flags.feature).map((id) => `feature:${featureId(id)}`)],
  });
  writeTaskChecked(task);
  appendEvent(taskId, 'task_created', { taskVersion: task.version, payload: { objective: task.objective } });
  if (flags.activate !== false && flags['no-activate'] !== true) setActive(taskId);
  ok(`✔ 已创建任务 ${taskId}（status=planned）${flags['no-activate'] ? '' : '，已设为活动任务'}`, { task_id: taskId });
};

commands.switch = ({ positional, flags }) => {
  const id = positional[0] || flags.id;
  if (!id) throw Object.assign(new Error('用法：switch <task-id>'), { code: 'EINPUT' });
  if (!taskExists(id)) throw Object.assign(new Error(`任务不存在：${id}`), { code: 'ENOTASK' });
  setActive(id);
  ok(`✔ 活动任务切换为 ${id}`, { task_id: id });
};

commands.status = () => {
  const id = requireActiveId();
  const t = loadTask(id);
  const interrupted = findInterruptedSteps(id);
  const lines = [
    `任务 ${t.task_id}  status=${t.status}  phase=${t.phase}  version=${t.version}`,
    `目标：${t.objective}`,
    `下一步：${t.next_action}`,
    `open_step：${t.open_step ? `${t.open_step.step_id}（未提交）` : '无'}`,
    `中断步骤：${interrupted.length}`,
    `DoD：${(t.definition_of_done || []).filter((d) => d.met).length}/${(t.definition_of_done || []).length} 达成`,
    `blockers：${(t.blockers || []).length}`,
  ];
  ok(lines.join('\n'), { task_id: id, status: t.status, version: t.version, interrupted: interrupted.length });
};

commands.context = () => {
  const id = requireActiveId();
  const t = loadTask(id);
  const context = taskContext(t);
  ok(context.text, {
    task_id: id,
    context: context.text,
    evolution_context: context.evolutionContext,
    knowledge: context.knowledge.rows,
    knowledge_missing: context.knowledge.missing,
    worklist_task: context.next?.worklist_task || null,
  });
};

commands.resume = () => {
  // 无活动任务但已启用方法论脚手架：给起步引导 + 看板地址，而非报错（新项目装完第一条 resume 即此态）。
  if (!loadActive().active_task_id && processExists()) {
    const p = loadProcess();
    const st = loadState(p);
    const n = computeNext(p, st);
    const evolution = evolutionForNext(n);
    const knowledge = taskKnowledge(null, n);
    ok(`（当前无活动任务）方法论脚手架已就绪。\n下一步 → ${n.hint}${evolution ? `\n\n${evolution}` : ''}${knowledge.text}` + boardLine({ generate: true }), {
      no_active_task: true, action: n.action, worklist_task: n.worklist_task || null, evolution_context: evolution,
      knowledge: knowledge.rows, knowledge_missing: knowledge.missing, board: defaultBoardOut(),
    });
    return;
  }
  const id = requireActiveId();
  const t = loadTask(id);
  const interrupted = findInterruptedSteps(id);
  const context = taskContext(t);
  const banner = interrupted.length
    ? `\n⚠ 恢复检查：发现 ${interrupted.length} 个已 started 未提交步骤 → ${interrupted.map((s) => s.step_id).join(', ')}\n  用 \`recover --reconcile <step> --evidence ev:..\` 或 \`recover --fail <step> --reason ..\` 处理。\n`
    : '\n✔ 恢复检查：无中断步骤。\n';
  ok(withNext(context.text + banner) + boardLine({ generate: true }), {
    task_id: id,
    interrupted: interrupted.map((s) => s.step_id),
    evolution_context: context.evolutionContext,
    knowledge: context.knowledge.rows,
    knowledge_missing: context.knowledge.missing,
    worklist_task: context.next?.worklist_task || null,
    board: processExists() ? defaultBoardOut() : null,
  });
};

commands['start-step'] = ({ flags }) => {
  const id = requireActiveId();
  if (!flags.intent) throw Object.assign(new Error('缺少 --intent（步骤意图）'), { code: 'EINPUT' });
  const cur = loadTask(id);
  if (cur.open_step && !flags.force)
    throw Object.assign(new Error(`已有未提交步骤 ${cur.open_step.step_id}；先 commit-step/ fail-step，或加 --force`), { code: 'EOPEN' });
  const stepId = flags.step ? String(flags.step) : shortId('step-');
  const idem = flags.idem ? String(flags.idem) : shortId('idem-');
  const effect = flags.effect ? String(flags.effect) : 'none';
  const targets = parseTargets(flags.target);
  if (!['none', 'external-write'].includes(effect))
    throw Object.assign(new Error(`不支持的 effect：${effect}`), { code: 'EINPUT' });
  if (effect === 'external-write' && !targets.length)
    throw Object.assign(new Error('external-write 必须声明 --target'), { code: 'EINPUT' });
  const attempt = 1;
  const startedAt = nowIso();
  const next = updateTask(id, (t) => {
    if (t.status === 'planned' || t.status === 'blocked') t.status = 'in_progress';
    t.open_step = {
      step_id: stepId,
      intent: String(flags.intent).slice(0, 280),
      attempt,
      idempotency_key: idem,
      started_at: startedAt,
      verified: false,
      effect,
      targets,
    };
    if (flags.focus) t.current_focus = String(flags.focus).slice(0, 500);
  });
  appendEvent(id, 'step_started', {
    stepId,
    attempt,
    taskVersion: next.version,
    idempotencyKey: idem,
    payload: { intent: String(flags.intent), effect, targets },
  });
  ok(`✔ 步骤已开始 step_id=${stepId} idem=${idem}（记得完成后 commit-step）`, { step_id: stepId, idempotency_key: idem });
};

commands['verify'] = ({ flags }) => {
  const id = requireActiveId();
  const cur = loadTask(id);
  const result = flags.fail ? 'fail' : 'pass';
  const stepId = flags.step ? String(flags.step) : (cur.open_step?.step_id || null);
  const g = guard(cur.status, 'verifying', {});
  if (cur.status !== 'verifying' && !g.ok) throw Object.assign(new Error(g.reason), { code: 'ESTATE' });
  appendEvent(id, 'verification_started', { stepId, taskVersion: cur.version, payload: { of: flags.of || '' } });
  const next = updateTask(id, (t) => { if (t.status !== 'verifying') t.status = 'verifying'; if (t.open_step) t.open_step.verified = result === 'pass'; });
  appendEvent(id, 'verification_finished', { stepId, taskVersion: next.version, references: asArray(flags.evidence).map(String), payload: { result, note: flags.note ? String(flags.note).slice(0, 280) : '' } });
  ok(withNext(`✔ 验证记录 result=${result}（status=verifying）`), { result });
};

commands['commit-step'] = ({ flags }) => {
  const id = requireActiveId();
  const cur = loadTask(id);
  const stepId = flags.step ? String(flags.step) : (cur.open_step?.step_id);
  if (!stepId) throw Object.assign(new Error('无 open_step 且未给 --step'), { code: 'EINPUT' });
  const idem = flags.idem ? String(flags.idem) : (cur.open_step?.idempotency_key || '');
  // 幂等：同 idem 已提交 → 跳过不重复执行
  if (idem && hasCommittedIdem(id, idem)) {
    ok(`↺ 幂等跳过：idem=${idem} 已提交过，不重复执行`, { skipped: true, idempotency_key: idem });
    return;
  }
  const summary = flags.summary ? String(flags.summary).slice(0, 280) : (cur.open_step?.intent || stepId);
  const evidence = asArray(flags.evidence).map(String);
  const step = cur.open_step?.step_id === stepId ? cur.open_step : { step_id: stepId, effect: 'none', targets: [] };
  assertExternalWriteEvidence({ taskId: id, step, evidenceRefs: evidence });
  const next = updateTask(id, (t) => {
    t.recent_completed.push({ at: nowIso(), summary, step_id: stepId, evidence });
    if (t.recent_completed.length > 10) t.recent_completed = t.recent_completed.slice(-10); // 明确规则：保留最近 10
    t.open_step = null;
    for (const r of asArray(flags.ref).map(String)) if (!t.references.includes(r) && t.references.length < 20) t.references.push(r);
  });
  appendEvent(id, 'step_committed', { stepId, attempt: cur.open_step?.attempt || 1, taskVersion: next.version, idempotencyKey: idem, references: evidence, payload: { summary } });
  ok(withNext(`✔ 步骤已提交 step_id=${stepId}`), { step_id: stepId });
};

commands['fail-step'] = ({ flags }) => {
  const id = requireActiveId();
  const cur = loadTask(id);
  const stepId = flags.step ? String(flags.step) : (cur.open_step?.step_id);
  if (!stepId) throw Object.assign(new Error('无 open_step 且未给 --step'), { code: 'EINPUT' });
  if (!flags.reason) throw Object.assign(new Error('缺少 --reason'), { code: 'EINPUT' });
  const next = updateTask(id, (t) => { t.open_step = null; });
  appendEvent(id, 'step_failed', { stepId, attempt: cur.open_step?.attempt || 1, taskVersion: next.version, payload: { reason: String(flags.reason).slice(0, 280) } });
  ok(`✔ 已记录步骤失败 step_id=${stepId}`, { step_id: stepId });
};

commands.evidence = ({ positional, flags }) => {
  if ((positional[0] || 'add') !== 'add') throw Object.assign(new Error('用法：evidence add --kind .. --ref .. [--data ..]'), { code: 'EINPUT' });
  const id = requireActiveId();
  const kind = flags.kind ? String(flags.kind) : 'note';
  const evId = 'ev:' + shortId();
  const dir = paths.evidenceDir(id);
  mkdirSync(dir, { recursive: true });
  let data = flags.data ? String(flags.data).slice(0, 4000) : '';
  try { data = data ? JSON.parse(data) : {}; } catch { /* legacy text evidence */ }
  const task = loadTask(id);
  const createdAt = nowIso();
  const record = redact({
    id: evId,
    kind,
    task_id: id,
    step_id: task.open_step?.step_id || null,
    target: flags.target ? String(flags.target) : '',
    ref: flags.ref ? String(flags.ref) : '',
    data,
    created_at: createdAt,
    at: createdAt,
  });
  const file = join(dir, `${evId.replace(':', '_')}.json`);
  writeJsonAtomic(file, record);
  appendEvent(id, 'artifact_written', { taskVersion: loadTask(id).version, references: [evId], payload: { kind, ref: record.ref } });
  ok(`✔ 证据已记录 ${evId}（${file}）`, { evidence_id: evId, file });
};

commands.decision = ({ positional, flags }) => {
  if ((positional[0] || 'add') !== 'add') throw Object.assign(new Error('用法：decision add --title .. --why .. [--scope ..]'), { code: 'EINPUT' });
  const id = requireActiveId();
  if (!flags.title || !flags.why) throw Object.assign(new Error('缺少 --title / --why'), { code: 'EINPUT' });
  const decId = 'dec:' + shortId();
  const dir = paths.decisionsDir(id);
  mkdirSync(dir, { recursive: true });
  const record = redact({
    id: decId,
    title: String(flags.title).slice(0, 280),
    why: String(flags.why).slice(0, 1000),
    scope: flags.scope ? String(flags.scope).slice(0, 280) : '',
    still_valid: true,
    at: nowIso(),
  });
  const file = join(dir, `${decId.replace(':', '_')}.json`);
  writeJsonAtomic(file, record);
  const v = loadTask(id).version;
  appendEvent(id, 'decision_recorded', { taskVersion: v, references: [decId], payload: { title: record.title, why: record.why } });
  ok(`✔ 决策已记录 ${decId}`, { decision_id: decId, file });
};

commands.checkpoint = ({ flags }) => {
  const id = requireActiveId();
  const t = loadTask(id);
  const { markdown, fromSeq, toSeq } = buildCheckpoint(t, { trigger: flags.auto ? 'pre-compact/auto' : 'manual' });
  const dir = paths.checkpointsDir(id);
  mkdirSync(dir, { recursive: true });
  const existing = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).length : 0;
  const seq = String(existing + 1).padStart(4, '0');
  const file = join(dir, `${seq}.md`);
  writeFileSync(file, markdown);
  appendEvent(id, 'checkpoint_created', { taskVersion: t.version, references: [`checkpoint:${seq}`], payload: { from_seq: fromSeq, to_seq: toSeq } });
  ok(`✔ Checkpoint 已生成 ${file}（依据 seq ${fromSeq}..${toSeq}）`, { file, from_seq: fromSeq, to_seq: toSeq });
};

commands.recover = ({ flags }) => {
  const id = requireActiveId();
  const interrupted = findInterruptedSteps(id);
  // --reconcile <step>：确认真实态已完成 → 补 recovery_performed + step_committed
  if (flags.reconcile) {
    const stepId = String(flags.reconcile);
    const evidence = asArray(flags.evidence).map(String);
    if (!evidence.length) throw Object.assign(new Error('reconcile 必须带 --evidence（真实态证据），不得凭摘要猜完成'), { code: 'EINPUT' });
    const cur = loadTask(id);
    const step = cur.open_step?.step_id === stepId
      ? cur.open_step
      : interrupted.find((item) => item.step_id === stepId);
    if (!step) throw Object.assign(new Error(`未找到中断步骤：${stepId}`), { code: 'ENOSTEP' });
    assertExternalWriteEvidence({ taskId: id, step, evidenceRefs: evidence });
    const next = updateTask(id, (t) => {
      t.recent_completed.push({ at: nowIso(), summary: `[恢复] ${stepId} 经真实态核对确认完成`, step_id: stepId, evidence });
      if (t.recent_completed.length > 10) t.recent_completed = t.recent_completed.slice(-10);
      if (t.open_step?.step_id === stepId) t.open_step = null;
    });
    appendEvent(id, 'recovery_performed', { stepId, taskVersion: next.version, references: evidence, payload: { action: 'reconcile-commit' } });
    appendEvent(id, 'step_committed', { stepId, taskVersion: next.version, references: evidence, payload: { summary: '恢复补提交（真实态已确认）' } });
    ok(`✔ 已 reconcile 并补提交 step=${stepId}`, { reconciled: stepId });
    return;
  }
  if (flags.fail) {
    const stepId = String(flags.fail);
    const next = updateTask(id, (t) => { if (t.open_step?.step_id === stepId) t.open_step = null; });
    appendEvent(id, 'recovery_performed', { stepId, taskVersion: next.version, payload: { action: 'mark-failed' } });
    appendEvent(id, 'step_failed', { stepId, taskVersion: next.version, payload: { reason: flags.reason ? String(flags.reason) : '恢复判定未完成' } });
    ok(`✔ 已把中断步骤判失败 step=${stepId}`, { failed: stepId });
    return;
  }
  // 只读报告
  if (!interrupted.length) { ok('✔ 恢复检查：无 started 未提交步骤。', { interrupted: [] }); return; }
  const lines = ['⚠ 发现中断步骤（started 未 committed/failed）：'];
  for (const s of interrupted) lines.push(`  - ${s.step_id}（attempt ${s.attempt}，起于 ${s.at}）意图：${s.intent || '(未记)'}`);
  lines.push('先核对代码/Git/测试/外部系统真实态，再：');
  lines.push('  确认已完成 → recover --reconcile <step> --evidence ev:..');
  lines.push('  确认未完成 → recover --fail <step> --reason ..');
  ok(lines.join('\n'), { interrupted: interrupted.map((s) => s.step_id) });
};

commands.block = ({ flags }) => {
  const id = requireActiveId();
  if (!flags.blocker) throw Object.assign(new Error('缺少 --blocker'), { code: 'EINPUT' });
  const cur = loadTask(id);
  const g = guard(cur.status, 'blocked', { hasBlocker: true });
  if (!g.ok) throw Object.assign(new Error(g.reason), { code: 'ESTATE' });
  const next = updateTask(id, (t) => {
    t.status = 'blocked';
    for (const b of asArray(flags.blocker).map(String)) if (t.blockers.length < 8) t.blockers.push(b.slice(0, 280));
  });
  appendEvent(id, 'task_blocked', { taskVersion: next.version, payload: { blockers: asArray(flags.blocker).map(String) } });
  ok(`✔ 任务已置 blocked`, { status: 'blocked' });
};

commands.complete = ({ flags }) => {
  const id = requireActiveId();
  const cur = loadTask(id);
  let phaseId = cur.phase;
  if (processExists()) {
    const p = loadProcess();
    const st = loadState(p);
    phaseId = Object.entries(st.phase_tasks || {})
      .find(([, taskId]) => taskId === id)?.[0] || cur.phase || '';
    assertFeedbackCompletionGate({ root: feedbackProjectRoot(), phaseId });
    const legacyBugfix = existsSync(join(paths.root(), 'bugs.json'))
      && (p.phases || []).some((phase) => phase.id === 'report');
    if ((p.workflow === 'bugfix' || legacyBugfix) && phaseId === 'report') {
      const freshness = checkBugReport(paths.root(), join(paths.root(), 'reports', 'index.html'));
      if (!freshness.fresh) {
        throw Object.assign(
          new Error(`Bug 报告已过期：${freshness.reasons.join('；')}`),
          { code: 'ESTALE_REPORT' },
        );
      }
      if (findPhase(p, 'reconcile')) {
        const closed = new Map(loadFeedback(feedbackProjectRoot()).filter((record) => record.bug_id)
          .map((record) => [record.bug_id, record.status]));
        const open = loadBugs().filter((bug) => bug.in_scope === true &&
          (!['已归档', '延后'].includes(bug.verification_status) || closed.get(bug.id) !== bug.verification_status));
        if (open.length) throw Object.assign(new Error(`先归档或延后本轮 Bug：${open.map((bug) => bug.id).join(', ')}`), { code: 'EOPEN_BUGS' });
      }
    }
  }
  const hasEvidence = taskHasVerificationEvidence(cur);
  const g = guard(cur.status, 'completed', { hasVerificationEvidence: hasEvidence });
  if (!g.ok) throw Object.assign(new Error(g.reason + '（提示：先 `verify --evidence ..` 且每条 DoD 标记 met+evidence）'), { code: 'ESTATE' });
  if (cur.open_step) throw Object.assign(new Error(`仍有未提交步骤 ${cur.open_step.step_id}，不能完成`), { code: 'EOPEN' });
  const root = feedbackProjectRoot();
  const proof = asArray(flags.proof);
  const linked = featureRefs(cur);
  if (proof.length) assertDeliveryProof(id, proof);
  const delivery = proof.length || (phaseId === 'delivery' && (linked.length || readKnowledge(root).entries.length))
    ? deliverKnowledge(root, { features: linked, proof, taskId: id, commit: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])) })
    : [];
  const next = updateTask(id, (t) => { t.status = 'completed'; });
  appendEvent(id, 'task_completed', { taskVersion: next.version, payload: { objective: cur.objective } });
  ok(withNext(`✔ 任务已完成 ${id}${delivery.length ? `；已索引验收证据：${delivery.map((entry) => entry.feature).join(', ')}` : ''}`)
    + boardLine({ generate: true }), { status: 'completed', knowledge_delivery: delivery });
};

// ---------- Feedback Auto-Trigger ----------
commands.feedback = ({ positional, flags }) => {
  const action = positional[0] || 'list';
  const root = feedbackProjectRoot();
  if (action === 'detect') {
    const input = flags.text ? String(flags.text) : positional.slice(1).join(' ');
    if (!input) throw Object.assign(new Error('用法：feedback detect --text "用户消息"'), { code: 'EINPUT' });
    const result = classifyFeedbackSignal(input);
    ok(result.capture ? `检测到具体反馈信号：${result.keywords.join(', ')}` : `未自动登记：${result.reason}`, result);
    return;
  }
  if (action === 'add') {
    const source = flags.source ? String(flags.source) : '';
    const title = flags.title ? String(flags.title) : '';
    const symptom = flags.symptom ? String(flags.symptom) : '';
    if (!source || !title || !symptom) {
      throw Object.assign(new Error('用法：feedback add --source user|engineering --title .. --symptom .. [--evidence ..]*'), { code: 'EINPUT' });
    }
    const activeTaskId = loadActive().active_task_id || '';
    let phaseId = '';
    if (processExists() && activeTaskId) {
      const p = loadProcess();
      const st = loadState(p);
      phaseId = Object.entries(st.phase_tasks || {}).find(([, taskId]) => taskId === activeTaskId)?.[0] || '';
    }
    const result = addFeedback({
      root,
      source,
      title,
      symptom,
      phaseId,
      taskId: activeTaskId,
      evidence: asArray(flags.evidence).map(String),
    });
    ok(result.duplicate
      ? (result.reopened ? `↻ 历史反馈已复发并重新打开：${result.record.id}` : `↺ 重复反馈已抑制：${result.record.id}`)
      : `✔ 已自动记入复盘：${result.record.id} ${result.record.title}`,
    { feedback: result.record, duplicate: result.duplicate, reopened: result.reopened });
    return;
  }
  if (action === 'import') {
    const file = flags.file ? String(flags.file) : positional[1];
    if (!file) throw Object.assign(new Error('用法：feedback import --file <existing-retrospective.md>'), { code: 'EINPUT' });
    const result = importFeedbackMarkdown({ root, file: resolve(file) });
    ok(`✔ 已导入 ${result.imported} 条反馈；原文备份：${result.backupPath}`, result);
    return;
  }
  if (action === 'update' || action === 'close') {
    const id = positional[1] || flags.id;
    if (!id) throw Object.assign(new Error(`用法：feedback ${action} <U/E-id> ...`), { code: 'EINPUT' });
    const status = action === 'close' ? String(flags.status || '已归档') : (flags.status ? String(flags.status) : undefined);
    if (action === 'close' && !['已归档', '延后'].includes(status)) {
      throw Object.assign(new Error('feedback close 的 status 只允许 已归档 或 延后'), { code: 'EINPUT' });
    }
    const feedback = (action === 'close' ? closeFeedback : updateFeedback)({
      root,
      id: String(id),
      rootCause: flags['root-cause'] !== undefined ? String(flags['root-cause']) : undefined,
      resolution: flags.resolution !== undefined ? String(flags.resolution) : undefined,
      impact: flags.impact !== undefined ? String(flags.impact) : undefined,
      status,
      evidence: flags.evidence !== undefined ? asArray(flags.evidence).map(String) : undefined,
    });
    if (action === 'update') {
      ok(`✔ 反馈已更新：${feedback.id} → ${feedback.status}`, { feedback });
      return;
    }
    const evolution = runFeedbackEvolution({ root, reason: `feedback-close:${feedback.id}` });
    ok(`✔ 反馈已归档并完成规则差异：${feedback.id}${evolution.skipped ? '（内容未变化，跳过重复演进）' : ''}`,
      { feedback, evolution: evolution.state, skipped: evolution.skipped });
    return;
  }
  if (action === 'evolve') {
    const evolution = runFeedbackEvolution({ root, reason: 'explicit-keyword', force: flags.force === true });
    ok(evolution.skipped
      ? `↺ 规则差异未变化：${evolution.reason}`
      : `✔ 规则差异报告：${evolution.state.report_path}`,
    { skipped: evolution.skipped, reason: evolution.reason, evolution: evolution.state });
    return;
  }
  if (action === 'list') {
    const status = flags.status ? String(flags.status) : '';
    const source = flags.source ? String(flags.source) : '';
    const items = loadFeedback(root).filter((record) => (!status || record.status === status) && (!source || record.source === source));
    const lines = items.map((record) => `${record.id}  ${record.status}  ${record.title}`);
    ok(lines.join('\n') || '（反馈账本为空）', { items });
    return;
  }
  throw Object.assign(new Error('用法：feedback detect|add|import|update|close|list|evolve'), { code: 'EINPUT' });
};

// DoD 标记辅助（complete 前置）：dod set --index N [--met] [--evidence ev:..]
commands.dod = ({ positional, flags }) => {
  if ((positional[0] || '') !== 'set') throw Object.assign(new Error('用法：dod set --index N [--met] [--unmet] [--evidence ev:..]'), { code: 'EINPUT' });
  const id = requireActiveId();
  const idx = Number(flags.index);
  const next = updateTask(id, (t) => {
    const d = t.definition_of_done[idx];
    if (!d) throw Object.assign(new Error(`DoD 序号越界：${idx}`), { code: 'EINPUT' });
    if (flags.met) d.met = true;
    if (flags.unmet) d.met = false;
    for (const e of asArray(flags.evidence).map(String)) if (!d.evidence.includes(e) && d.evidence.length < 6) d.evidence.push(e);
  });
  ok(withNext(`✔ DoD[${idx}] met=${next.definition_of_done[idx].met}`), { index: idx });
};

commands.validate = () => {
  const problems = [];
  // ACTIVE
  const activePath = paths.active();
  if (existsSync(activePath)) {
    const a = loadActive();
    const r = validate('active-task.schema.json', a);
    if (!r.valid) problems.push(`ACTIVE_TASK: ${r.errors.join('; ')}`);
    if (a.active_task_id && !taskExists(a.active_task_id)) problems.push(`ACTIVE_TASK 指向不存在的任务：${a.active_task_id}`);
  }
  for (const id of listTaskIds()) {
    try {
      const t = loadTask(id);
      assertValidTask(t); // schema + 16KB + recent 上限
    } catch (e) { problems.push(`task ${id}: ${e.message.split('\n')[0]}`); }
    for (const [i, e] of readEvents(id).entries()) {
      const r = validate('journal-event.schema.json', e);
      if (!r.valid) problems.push(`journal ${id}[${i}]: ${r.errors.join('; ')}`);
    }
  }
  // 方法论脚手架层（若启用）
  if (existsSync(processPath())) {
    const rp = validate('process.schema.json', readJson(processPath()));
    if (!rp.valid) problems.push(`process.json: ${rp.errors.join('; ')}`);
  }
  if (existsSync(statePath())) {
    const rs = validate('process-state.schema.json', readJson(statePath()));
    if (!rs.valid) problems.push(`process-state.json: ${rs.errors.join('; ')}`);
  }
  if (problems.length) {
    if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: false, code: 'EVALIDATE', problems }) + '\n');
    process.stderr.write('✗ 校验失败:\n  - ' + problems.join('\n  - ') + '\n');
    process.exit(1);
  }
  ok('✔ 所有状态文件校验通过', { checked: listTaskIds().length });
};

// hook install：给已装项目单独补装 git hook（对齐升级路径）。
commands.hook = ({ positional }) => {
  const sub = positional[0] || 'install';
  if (sub !== 'install') throw Object.assign(new Error('用法：hook install（装 git post-commit 自动刷新看板）'), { code: 'EINPUT' });
  const msg = installBoardHook();
  ok(`✔ ${msg}`, { hook: 'post-commit', message: msg });
};

// 移植落地：建运行时目录+.gitkeep、生成 PROJECT.md、幂等追加 .gitignore。可反复跑。
const GITIGNORE_MARK = '# .agent 任务记忆运行时（自动追加）';
const GITIGNORE_BLOCK = [
  '',
  GITIGNORE_MARK,
  '.agent/ACTIVE_TASK.json',
  '.agent/tasks/*',
  '.agent/journal/*',
  '.agent/decisions/*',
  '.agent/evidence/*',
  '.agent/checkpoints/*',
  '.agent/process-state.json',
  '.agent/process-bugfix-state.json',
  '.agent/ACTIVE_BUGFIX_TASK.json',
  '.agent/board-bugfix.html',
  '.agent/board.html',
  '.agent/retrospective/*.lock',
  '!.agent/tasks/.gitkeep',
  '!.agent/journal/.gitkeep',
  '!.agent/decisions/.gitkeep',
  '!.agent/evidence/.gitkeep',
  '!.agent/checkpoints/.gitkeep',
  '',
].join('\n');

commands.install = ({ flags }) => {
  const done = [installAgentPolicy(feedbackProjectRoot())];
  initKnowledge(feedbackProjectRoot());
  done.push('项目知识索引：docs/knowledge/index.json');
  ensureDirs();
  for (const d of ['tasks', 'journal', 'decisions', 'evidence', 'checkpoints']) {
    const gk = join(paths.root(), d, '.gitkeep');
    if (!existsSync(gk)) { writeFileSync(gk, ''); done.push(`建 ${d}/.gitkeep`); }
  }
  // PROJECT.md（身份来源）：无则从模板生成，不覆盖已存在的
  const projectMd = join(paths.root(), 'PROJECT.md');
  const tpl = join(paths.root(), 'PROJECT.md.template');
  if (!existsSync(projectMd)) {
    if (existsSync(tpl)) { copyFileSync(tpl, projectMd); done.push('由模板生成 .agent/PROJECT.md（请按新项目填写）'); }
    else done.push('⚠ 缺 PROJECT.md.template，跳过；请手写 .agent/PROJECT.md');
  } else done.push('.agent/PROJECT.md 已存在，保留不覆盖');
  // process.json（方法论定义）：无则从模板生成，不覆盖已存在的
  if (!processExists()) {
    initProcessFile(flags.workflow);
    done.push(`由模板生成 ${processPath()}`);
  } else done.push(`${processPath()} 已存在，保留不覆盖`);
  // .gitignore 幂等追加
  const gi = join(process.cwd(), '.gitignore');
  const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (!cur.includes(GITIGNORE_MARK)) {
    appendFileSync(gi, (cur && !cur.endsWith('\n') ? '\n' : '') + GITIGNORE_BLOCK);
    done.push('追加 .agent 运行时规则到 .gitignore');
  } else {
    // 升级场景：标记已存在但块可能过时（如缺 process-state.json/board.html）——幂等补缺失行
    const want = GITIGNORE_BLOCK.split('\n').filter((l) => l.startsWith('.agent/') || l.startsWith('!.agent/'));
    const have = cur.split('\n');
    const missing = want.filter((l) => !have.includes(l));
    if (missing.length) { appendFileSync(gi, (cur.endsWith('\n') ? '' : '\n') + missing.join('\n') + '\n'); done.push(`补充 .gitignore 缺失运行时规则：${missing.join(' ')}`); }
    else done.push('.gitignore 已含 .agent 规则，跳过');
  }
  // 探测 process.json 引用的 skill 是否已装（skill 本体不随模板打包，见 process/SKILLS.md）
  let missingSkills = [];
  if (processExists()) {
    try {
      const p = loadProcess();
      const names = [...new Set((p.phases || []).flatMap((ph) => ph.skills || []))];
      missingSkills = names.filter((n) => detectSkill(n) !== 'installed');
      if (missingSkills.length) done.push(`⚠ 方法论引用了 ${names.length} 个 skill，其中 ${missingSkills.length} 个未检测到：${missingSkills.join(', ')}（见 .agent/process/SKILLS.md）`);
      else if (names.length) done.push(`方法论引用的 ${names.length} 个 skill 均已检测到 ✓`);
    } catch { /* process.json 异常不阻塞 install */ }
  }
  const evolver = join(dirname(paths.root()), 'harness_evolver', 'context_injector.py');
  done.push(existsSync(evolver)
    ? 'Harness Evolver 已安装：阶段命令会动态注入历史交付规则'
    : '⚠ 未检测到 harness_evolver/，外循环规则注入未启用（主 Harness 仍可运行）');
  // git post-commit hook：提交后自动刷新看板
  done.push(installBoardHook());
  ok(
    ['✔ 安装完成：', ...done.map((s) => '  - ' + s), '',
      '下一步：',
      '  1) 编辑 .agent/PROJECT.md 填本项目身份/不可违反规则/真源',
      '  2) 提交已注册 Harness 协议的 AGENTS.md；不需要手工粘贴规则',
      '  3) 单任务用法：node .agent/scripts/agent.mjs init --objective "..." --dod "..."',
      '  4) 方法论脚手架用法：node .agent/scripts/agent.mjs process init && node .agent/scripts/agent.mjs next（skill 清单见 .agent/process/SKILLS.md）',
      '  5) node .agent/scripts/agent.mjs resume（会自动生成/刷新看板并打印其地址）',
    ].join('\n') + boardLine({ generate: true }),
    { done, board: processExists() ? defaultBoardOut() : null },
  );
};

// ========== 方法论脚手架层 ==========

// process init / status
commands.process = ({ positional }) => {
  const sub = positional[0] || 'status';
  if (sub === 'init') {
    const { created } = initProcessFile();
    const p = loadProcess();
    if (!existsSync(statePath())) saveState(freshState(p));
    ok(withNext(
      created
        ? `✔ 已生成 ${processPath()}（方法论：${p.name}，${p.phases.length} 阶段）+ ${statePath()}`
        : `${processPath()} 已存在（方法论：${p.name}），保留不覆盖；已确保 ${statePath()} 存在`,
    ), { created, phases: p.phases.length });
    return;
  }
  if (sub === 'status') {
    const p = loadProcess();
    const st = loadState(p);
    const lines = [`方法论：${p.name}  当前阶段：${st.current_phase || '(未开始)'}`];
    for (const ph of p.phases) {
      const v = computePhaseView(ph, st);
      const done = v.artifacts.filter((a) => a.on_disk).length;
      const req = v.artifacts.filter((a) => a.required).length;
      const cur = st.current_phase === ph.id ? ' ←' : '';
      lines.push(`  [${v.status}] ${ph.no || ''} ${ph.name}  产物 ${done}/${v.artifacts.length}（required ${req}）${v.advanceable ? ' 可推进' : ''}${cur}`);
      for (const s of ph.skills || []) lines.push(`        skill ${s} ${skillBadge(detectSkill(s))}`);
    }
    ok(withNext(lines.join('\n')), { current_phase: st.current_phase, phases: p.phases.map((ph) => ({ id: ph.id, status: phaseStatus(st, ph.id) })) });
    return;
  }
  throw Object.assign(new Error('用法：process init | process status'), { code: 'EINPUT' });
};

// next：随时问「现在干啥」
commands.next = ({ flags }) => {
  const p = loadProcess();
  const st = loadState(p);
  const n = computeNext(p, st);
  const evolution = evolutionForNext(n);
  const knowledge = taskKnowledge(activeTask(), n, asArray(flags.feature));
  ok(n.hint + (evolution ? `\n\n${evolution}` : '') + knowledge.text + boardLine(), {
    done: n.done,
    phase_id: n.phase_id,
    action: n.action,
    skills: n.skills,
    worklist_task: n.worklist_task || null,
    target_path: n.target_path || null,
    evolution_context: evolution,
    knowledge: knowledge.rows,
    knowledge_missing: knowledge.missing,
    board: defaultBoardOut(),
  });
};

// phase start <id>：惰性 seed 阶段 task 并切为活动任务
commands.phase = ({ positional, flags }) => {
  const sub = positional[0];
  if (sub !== 'start') throw Object.assign(new Error('用法：phase start <phase-id>'), { code: 'EINPUT' });
  const phaseId = positional[1];
  if (!phaseId) throw Object.assign(new Error('缺少 phase-id（用 `process status` 看阶段列表）'), { code: 'EINPUT' });
  const p = loadProcess();
  const st = loadState(p);
  if (!findPhase(p, phaseId)) throw Object.assign(new Error(`阶段不存在：${phaseId}`), { code: 'ENOPHASE' });
  const features = asArray(flags.feature).map(featureId);
  const { taskId, created } = seedPhaseTask(p, phaseId, st);
  saveState(st);
  if (created) appendEvent(taskId, 'task_created', { taskVersion: loadTask(taskId).version, payload: { objective: loadTask(taskId).objective } });
  if (features.length) updateTask(taskId, (task) => { task.references = [...new Set([...task.references, ...features.map((id) => `feature:${id}`)])]; });
  setActive(taskId);
  const next = computeNext(p, st);
  const evolution = buildEvolutionContext({
    phaseId,
    action: next.action,
    worklistTask: next.worklist_task || '',
    targetPath: next.target_path || '',
    techStack: (findPhase(p, phaseId)?.skills || []).join(','),
  });
  const knowledge = taskKnowledge(loadTask(taskId), next);
  ok(withNext(`✔ 进入阶段 ${phaseId}（task=${taskId}${created ? '，新建' : '，已存在'}），已设为活动任务`) + (evolution ? `\n\n${evolution}` : '') + knowledge.text + boardLine({ generate: true }), {
    phase_id: phaseId, task_id: taskId, created, worklist_task: next.worklist_task || null, evolution_context: evolution,
    knowledge: knowledge.rows, knowledge_missing: knowledge.missing,
  });
};

commands.knowledge = ({ positional, flags }) => {
  const [action = 'list', target] = positional;
  const root = feedbackProjectRoot();
  if (action === 'capture' || action === 'confirm') {
    const entry = action === 'capture' ? captureKnowledge(root, flags) : confirmKnowledge(root, target, Number(flags.revision));
    ok(`知识索引：${entry.feature}@${entry.revision} ${entry.status}` + boardLine({ generate: true }), { entry });
    return;
  }
  if (action === 'use') {
    const ids = [...new Set([...positional.slice(1), ...asArray(flags.feature)].map(featureId))];
    if (!ids.length) throw Object.assign(new Error('用法：knowledge use <功能 ID>'), { code: 'EKNOWLEDGE' });
    const known = new Set(readKnowledge(root).entries.map((entry) => entry.feature));
    if (ids.some((id) => !known.has(id))) throw Object.assign(new Error('请先登记该功能的需求来源'), { code: 'EKNOWLEDGE' });
    const task = updateTask(requireActiveId(), (task) => {
      task.references = [...task.references.filter((ref) => !ref.startsWith('feature:')), ...ids.map((id) => `feature:${id}`)];
    });
    const knowledge = taskKnowledge(task);
    ok(`已关联功能：${ids.join(', ')}${knowledge.text}`, { features: ids, ...knowledge });
    return;
  }
  if (action === 'find') {
    const result = retrieveKnowledge(root, { features: [...(target ? [target] : []), ...asArray(flags.feature)], paths: asArray(flags.path), module: flags.module });
    ok(result.text || '没有匹配的现行知识', result);
    return;
  }
  if (action === 'check') {
    const issues = checkKnowledge(root);
    if (issues.length) throw Object.assign(new Error(issues.join('\n')), { code: 'EKNOWLEDGE' });
    ok('知识索引引用与当前文件一致', { issues });
    return;
  }
  if (action === 'list') {
    const { entries } = readKnowledge(root);
    ok(entries.map((entry) => `${entry.feature}@${entry.revision} ${entry.status} ${entry.title}`).join('\n') || '知识索引为空', { entries });
    return;
  }
  throw Object.assign(new Error('用法：knowledge capture|confirm|use|find|list|check'), { code: 'EKNOWLEDGE' });
};

// artifact add / list
commands.artifact = ({ positional, flags }) => {
  const sub = positional[0];
  const p = loadProcess();
  const st = loadState(p);
  if (sub === 'add') {
    const phaseId = flags.phase && String(flags.phase);
    const key = flags.key && String(flags.key);
    const path = flags.path && String(flags.path);
    if (!phaseId || !key || !path) throw Object.assign(new Error('用法：artifact add --phase <id> --key <k> --path <p> [--name ..] [--status draft|done]'), { code: 'EINPUT' });
    const phase = findPhase(p, phaseId);
    if (!phase) throw Object.assign(new Error(`阶段不存在：${phaseId}`), { code: 'ENOPHASE' });
    const expected = (phase.artifacts || []).find((a) => a.key === key);
    const name = flags.name ? String(flags.name) : (expected?.name || key);
    const status = flags.status === 'done' ? 'done' : (flags.status === 'draft' ? 'draft' : 'done');
    const rec = { phase_id: phaseId, key, name, path, status, registered_at: nowIso() };
    st.artifacts = (st.artifacts || []).filter((a) => !(a.phase_id === phaseId && a.key === key));
    st.artifacts.push(rec);
    saveState(st);
    const onDisk = existsSync(path);
    // 对该阶段 task（若有）打 artifact_written 事件；否则退回活动任务
    const targetTask = phaseTaskId(st, phaseId) || (loadActive().active_task_id);
    if (targetTask && taskExists(targetTask))
      appendEvent(targetTask, 'artifact_written', { taskVersion: loadTask(targetTask).version, references: [`artifact:${phaseId}/${key}`], payload: { phase_id: phaseId, key, path, status } });
    const mark = onDisk ? '✓ 磁盘已存在' : '✗ 磁盘尚未找到（产物真源是磁盘，缺失如实标红）';
    ok(withNext(`✔ 已登记产物 ${phaseId}/${key} → ${path}（${mark}）`), { phase_id: phaseId, key, path, on_disk: onDisk });
    return;
  }
  if (sub === 'list') {
    const only = flags.phase && String(flags.phase);
    const lines = [];
    for (const ph of p.phases) {
      if (only && ph.id !== only) continue;
      const v = computePhaseView(ph, st);
      lines.push(`${ph.no || ''} ${ph.name}：`);
      for (const a of v.artifacts) {
        const mark = a.on_disk ? '✓' : (a.registered ? '✗(登记但缺失)' : '—(未产出)');
        lines.push(`  [${mark}] ${a.name}${a.required ? '' : '(可选)'} → ${a.target_path}`);
      }
    }
    ok(lines.join('\n') || '(无阶段)', { artifacts: st.artifacts });
    return;
  }
  throw Object.assign(new Error('用法：artifact add ... | artifact list [--phase <id>]'), { code: 'EINPUT' });
};

const WORKLIST_STATUS = ['not_started', 'planned', 'in_progress', 'verifying', 'blocked', 'completed', 'cancelled'];

// system：登记/查看业务系统（按 worklist 模板铺开标准开发任务）
commands.system = ({ positional, flags }) => {
  const sub = positional[0];
  const p = loadProcess();
  const st = loadState(p);
  if (sub === 'add') {
    const key = positional[1] || (flags.key ? String(flags.key) : '');
    if (!key) throw Object.assign(new Error('用法：system add <key> --name <名>'), { code: 'EINPUT' });
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw Object.assign(new Error(`系统 key 非法：${key}（只允许字母/数字/._-）`), { code: 'EINPUT' });
    const { created, count } = addSystem(p, st, key, flags.name ? String(flags.name) : key);
    if (!created) { ok(`系统 ${key} 已登记，跳过（当前 ${st.systems.length} 个系统）`, { created: false, key }); return; }
    saveState(st);
    ok(withNext(`✔ 登记系统 ${flags.name || key}（${key}）并铺开 ${count} 个开发任务`) + boardLine({ generate: true }),
      { created: true, key, tasks: count, board: defaultBoardOut() });
    return;
  }
  if (sub === 'list') {
    const wl = worklistDef(p);
    const rows = (st.systems || []).map((s) => {
      const done = (s.tasks || []).filter((t) => t.status === 'completed').length;
      return `  ${s.name}（${s.key}）：${done}/${wl.length} 完成`;
    });
    ok(rows.length ? `已登记系统：\n${rows.join('\n')}` : '（还没登记系统；跑 `system add <key> --name <名>`）', { systems: st.systems || [] });
    return;
  }
  throw Object.assign(new Error('用法：system add <key> --name <名> | system list'), { code: 'EINPUT' });
};

// worklist：推进某系统某开发任务的状态
commands.worklist = ({ positional, flags }) => {
  const sub = positional[0];
  if (sub !== 'set') throw Object.assign(new Error('用法：worklist set --system <key> --task <taskKey> --status <状态>'), { code: 'EINPUT' });
  const sysKey = flags.system ? String(flags.system) : '';
  const taskKey = flags.task ? String(flags.task) : '';
  const status = flags.status ? String(flags.status) : '';
  if (!sysKey || !taskKey || !status) throw Object.assign(new Error('用法：worklist set --system <key> --task <taskKey> --status <状态>'), { code: 'EINPUT' });
  if (!WORKLIST_STATUS.includes(status)) throw Object.assign(new Error(`状态非法：${status}（合法：${WORKLIST_STATUS.join('/')}）`), { code: 'EINPUT' });
  const p = loadProcess();
  const st = loadState(p);
  const sys = setWorklistStatus(p, st, sysKey, taskKey, status);
  saveState(st);
  ok(withNext(`✔ ${sys.name} · ${taskKey} → ${status}`) + boardLine({ generate: true }),
    { system: sysKey, task: taskKey, status, board: defaultBoardOut() });
};

// board：生成自包含 HTML 看板
commands.board = ({ flags }) => {
  const p = loadProcess();
  const st = loadState(p);
  const out = flags.out ? String(flags.out) : defaultBoardOut();
  const html = buildBoardHtml(p, st, { cwd: process.cwd(), outDir: dirname(out) });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  if (flags.open) { try { spawnSync(process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start' : 'xdg-open'), [out]); } catch {} }
  ok(withNext(`✔ 看板已生成 ${out}（浏览器打开看：当前站高亮 + 产出物总账 + skillband）`), { out });
};

// doctor：一屏自检——记忆机制装好没 + 是否真被调用（journal 活动）
commands.doctor = () => {
  const root = paths.root();
  const dirs = ['tasks', 'journal', 'decisions', 'evidence', 'checkpoints'];
  const dirOk = dirs.every((d) => existsSync(join(root, d)));
  const schemasOk = ['task.schema.json', 'journal-event.schema.json'].every((f) => existsSync(join(root, 'schemas', f)));
  const projectProfile = projectProfileStatus();
  const projectOk = projectProfile.adapted;
  const procOn = processExists();
  let problems = 0;
  for (const id of listTaskIds()) { try { assertValidTask(loadTask(id)); } catch { problems++; } }
  const m = memoryStats();
  let feedback = [];
  let feedbackError = '';
  try { feedback = loadFeedback(feedbackProjectRoot()); }
  catch (e) { feedbackError = e.message; }
  const openFeedback = feedback.filter((record) => ['待定位', '处理中', '已修复待验证', '已验证待归档'].includes(record.status));
  const evolutionPath = feedbackPaths(feedbackProjectRoot()).evolution;
  let evolutionPending = false;
  if (existsSync(evolutionPath)) {
    try { evolutionPending = readJson(evolutionPath).pending === true; } catch { evolutionPending = true; }
  }
  const L = [];
  L.push('🩺 记忆自检');
  L.push(`装配：运行时目录${dirOk ? '✓' : '✗'}  schemas${schemasOk ? '✓' : '✗'}  PROJECT.md${projectOk ? '✓' : `✗（${projectProfile.reason}）`}  process.json${procOn ? '✓' : '（未启用脚手架层）'}`);
  L.push(`合法：${problems === 0 ? '✓ 状态文件全部合法' : `✗ ${problems} 个任务快照不合法（跑 validate 看详情）`}`);
  L.push(`任务：${m.taskCount} 个    中断步骤：${m.interruptedCount}`);
  L.push(`记忆活动：journal 共 ${m.eventCount} 事件；最后写入 ${m.lastAt ? `${m.lastAt}（${relTime(m.lastAt)}）` : '（无）'}`);
  L.push(feedbackError
    ? `反馈闭环：✗ 账本非法（${feedbackError}）`
    : `反馈闭环：共 ${feedback.length} 条；未闭环 ${openFeedback.length} 条；Evolver ${evolutionPending ? '✗ pending' : '✓ 无待处理失败'}`);
  if (m.recent.length) {
    L.push('最近调用（谁在什么时候记了啥）：');
    for (const e of m.recent) L.push(`  #${e.seq} ${e.timestamp.slice(11, 19)} ${e.event}${e.step_id ? ` ${e.step_id}` : ''} @${e.task_id}${e.summary ? ` — ${e.summary}` : ''}`);
  }
  L.push(m.invoked
    ? '判断：✅ 记忆在被调用（journal 有事件在累积）。'
    : '判断：⚠️ 机制已装好，但 journal 还是空的 —— 说明还没有人/AI 真正调用记忆（走 start-step / commit-step / artifact add 才会记）。');
  ok(L.join('\n'), {
    assembled: dirOk && schemasOk && projectOk,
    project_profile_adapted: projectOk,
    legal: problems === 0,
    process_enabled: procOn,
    feedback_count: feedback.length,
    open_feedback_count: openFeedback.length,
    feedback_error: feedbackError,
    evolution_pending: evolutionPending,
    ...m,
  });
};

// ---------- Bugfix Extension ----------
commands['repo-map'] = ({ flags }) => {
  const root = flags.root ? resolve(String(flags.root)) : process.cwd();
  const { markdown, stats } = buildRepoMap(root);
  const out = join(paths.root(), 'arch-map.md');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, markdown);
  ok(withNext(`✔ 架构图谱骨架 → ${out}`), { out, ...stats });
};

function loadBugs() {
  const file = join(paths.root(), 'bugs.json');
  return existsSync(file) ? readJson(file) : [];
}

commands['impact-check'] = ({ flags }) => {
  const id = String(flags.bug || '');
  const bug = loadBugs().find((item) => item.id === id);
  if (!bug) throw Object.assign(new Error('用法：impact-check --bug <已登记的 ID> [--base <git ref>]'), { code: 'EINPUT' });
  const directory = bugDirectory(paths.root(), id);
  const root = feedbackProjectRoot();
  const base = String(flags.base || 'HEAD');
  const revision = spawnSync('git', ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { cwd: root, encoding: 'utf8' });
  if (revision.status !== 0) throw Object.assign(new Error(`Git 基线不可读：${base}`), { code: 'EINPUT' });
  const diff = spawnSync('git', ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', revision.stdout.trim(), '--'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (diff.status !== 0 || !diff.stdout.trim()) throw Object.assign(new Error('没有可读取的 Git diff；先暂存新增文件或指定修复前的基线'), { code: 'ENODIFF' });
  const readRequired = (name) => readFileSync(join(directory, name), 'utf8');
  const { markdown, stats } = buildImpactCheck({ root, diffText: diff.stdout, planText: readRequired('fix-plan.md'), impactText: readRequired('impact.md'), bugId: id, base });
  const out = join(directory, 'impact-check.md');
  atomicWriteFile(out, markdown);
  ok(withNext(`影响面复核：${out}。计划外改动 ${stats.outOfScope}，疑似漏测调用方 ${stats.uncoveredCallers}。`), { out, ...stats });
};

commands.bug = ({ positional, flags }) => {
  const action = positional[0] || 'list';
  const ledgerPath = join(paths.root(), 'bugs.json');
  if (action === 'add') {
    const bugs = loadBugs();
    const bug = recordBug(bugs, { title: flags.title, symptom: flags.symptom });
    writeJsonAtomic(ledgerPath, bugs);
    ok(`已记录 Bug：${bug.id}`, { bug });
    return;
  }
  if (action === 'close') {
    const bugs = loadBugs();
    const bug = bugs.find((item) => item.id === positional[1]);
    if (!bug) throw Object.assign(new Error('Bug 不存在；先运行 bug list'), { code: 'EINPUT' });
    const root = feedbackProjectRoot();
    const feedback = archiveBug({ root, agentRoot: paths.root(), bug, status: flags.status,
      resolution: flags.resolution, scaffoldCandidate: flags['scaffold-candidate'] });
    if (bug.verification_status !== feedback.status || bug.feedback_id !== feedback.id) {
      Object.assign(bug, { verification_status: feedback.status, feedback_id: feedback.id, closed_at: nowIso() });
      writeJsonAtomic(ledgerPath, bugs);
    }
    const evolution = feedback.status === '已归档' ? runFeedbackEvolution({ root, reason: `bug-close:${bug.id}` }) : null;
    ok(`已记录处置：${bug.id} → ${feedback.status}（复盘 ${feedback.id}）`, { bug, feedback, evolution: evolution?.state });
    return;
  }
  if (action === 'list') {
    const bugs = existsSync(ledgerPath) ? readJson(ledgerPath) : [];
    const items = bugs.map((bug) => ({
      id: bug.id,
      title: bug.title,
      source_status: bug.source_status || bug.status || '',
      verification_status: bug.verification_status || '待验证',
      in_scope: bug.in_scope !== false,
    }));
    const lines = items.map((item) => (
      `${item.id}  源=${item.source_status}  验证=${item.verification_status}  ${item.title}`
    ));
    ok(lines.join('\n') || '（Bug 台账为空）', { items });
    return;
  }
  if (!['import', 'sync'].includes(action)) {
    throw Object.assign(
      new Error('用法：bug add|close|import|sync|list'),
      { code: 'EINPUT' },
    );
  }
  const file = flags.file ? String(flags.file) : positional[1];
  if (!file) throw Object.assign(new Error('缺少 --file'), { code: 'EINPUT' });
  const sourceId = flags.source ? String(flags.source) : resolve(file);
  const statuses = parseTargets(flags.status);
  const scopeStatuses = statuses.length ? statuses : ['待修复', '待开发'];
  const existing = existsSync(ledgerPath) ? readJson(ledgerPath) : [];
  const { bugs: incoming, warnings } = importBugs(file, { sourceId });
  const bugs = mergeBugLedger(existing, incoming, { scopeStatuses, sourceId });
  for (const bug of bugs) {
    const result = validate('bug.schema.json', bug);
    if (!result.valid) {
      throw Object.assign(
        new Error(`Bug ${bug.id} 不符合 schema：${result.errors.join('；')}`),
        { code: 'ESCHEMA' },
      );
    }
  }
  writeJsonAtomic(ledgerPath, bugs);
  ok(withNext(`✔ 同步 ${bugs.length} 条 Bug → ${ledgerPath}`), {
    out: ledgerPath,
    count: bugs.length,
    in_scope: bugs.filter((bug) => bug.in_scope).length,
    warnings,
  });
};

commands.report = ({ positional, flags }) => {
  const out = flags.out ? resolve(String(flags.out)) : join(paths.root(), 'reports', 'index.html');
  if (positional[0] === 'check') {
    const result = checkBugReport(paths.root(), out);
    if (!result.fresh) {
      throw Object.assign(
        new Error(`Bug 报告已过期：${result.reasons.join('；')}`),
        { code: 'ESTALE_REPORT' },
      );
    }
    ok('REPORT_FRESH', { report: out, fresh: true, reasons: [] });
    return;
  }
  const written = writeBugReport(paths.root(), out);
  if (flags.open) {
    try {
      spawnSync(
        process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start' : 'xdg-open'),
        [out],
      );
    } catch { /* report is still generated */ }
  }
  ok(withNext(`✔ Bug 报告 → ${out}`), { out, manifest: written.manifestPath });
};

commands.help = () => {
  ok([
    '外部任务记忆 CLI — 命令：',
    '  install [--workflow default|bugfix]                  （安装开发或 Bugfix 流程）',
    '  init --objective ".." [--id ..] [--phase ..] [--next ..] [--dod ..]* [--constraint ..]* [--no-activate]',
    '  switch <id> | status | context | resume',
    '  start-step --intent ".." [--step ..] [--idem ..] [--focus ..] [--effect external-write --target ..]* [--force]',
    '  verify [--fail] [--evidence ev:..]* [--note ..]   （in_progress→verifying + 记录验证）',
    '  commit-step [--step ..] [--idem ..] [--summary ..] [--evidence ev:..]*   （幂等）',
    '  fail-step [--step ..] --reason ".."',
    '  evidence add --kind .. --ref .. [--target ..] [--data ..]',
    '  decision add --title .. --why .. [--scope ..]',
    '  dod set --index N [--met|--unmet] [--evidence ev:..]*',
    '  checkpoint [--auto] | recover [--reconcile <step> --evidence ..|--fail <step> --reason ..]',
    '  block --blocker ".." | complete | validate',
    '  doctor                                              （记忆自检：装好没 + 是否真被调用/journal 活动）',
    '',
    '方法论脚手架层（阶段编排 + 强引导 + 看板）：',
    '  process init | process status                       （从模板生成 process.json / 看各阶段进度）',
    '  next                                                （打印唯一的下一步该干什么）',
    '  phase start <phase-id>                              （进入某阶段，惰性建 task 并切为活动）',
    '  artifact add --phase <id> --key <k> --path <p> [--name ..] [--status draft|done]',
    '  artifact list [--phase <id>]                        （产物磁盘回读 ✓✗）',
    '  system add <key> --name <名> | system list          （按 worklist 铺开逐系统开发任务）',
    '  worklist set --system <k> --task <t> --status <s>   （推进某系统某开发任务状态）',
    '  board [--out .agent/board.html] [--open]            （生成 HTML 看板；产物路径可点跳转）',
    '  hook install                                        （装 git post-commit：每次提交自动刷新看板）',
    '',
    'Bugfix Extension：',
    '  repo-map [--root ..]                                （生成 .agent/arch-map.md）',
    '  bug import|sync --file .. [--source ..] [--status ..]；bug list',
    '  bug add --title .. --symptom ..；bug close <id> [--status 已归档|延后] [--resolution ..] [--scaffold-candidate ..]',
    '  impact-check --bug <id> [--base <git ref>]',
    '  knowledge capture|confirm|use|find|list|check        （功能、需求和验收索引）',
    '  report [--out ..] [--open] | report check [--out ..]',
    '',
    'Harness Evolver 外循环：',
    '  python3 -m harness_evolver.evolve --input-docs <反馈.md|目录>  （增量归因并更新规则）',
    '  next/context/resume/phase start 会按阶段自动注入最新规则',
    '  feedback detect|add|import|update|close|list|evolve  （自动复盘账本 + 交付门禁）',
    '  全命令支持 --json（机读输出）',
  ].join('\n'));
};

// ---------- 分发 ----------
function main() {
  const argv = process.argv.slice(2);
  JSON_MODE = argv.includes('--json');
  const cmd = argv[0];
  const rest = argv.slice(1).filter((a) => a !== '--json');
  const handler = commands[cmd];
  if (!cmd || cmd === '--help' || cmd === '-h') { commands.help({ positional: [], flags: {} }); return; }
  if (!handler) { fail(Object.assign(new Error(`未知命令：${cmd}（跑 help 看用法）`), { code: 'ECMD' })); return; }
  ensureDirs();
  try {
    const parsed = parseArgs(rest);
    const workflow = parsed.flags.workflow;
    if (workflow !== undefined && !['default', 'bugfix'].includes(workflow)) {
      throw Object.assign(new Error('--workflow 必须是 default 或 bugfix'), { code: 'EINPUT' });
    }
    if (workflow === 'bugfix' && (processExists() ? loadProcess().workflow !== 'bugfix' : cmd !== 'install')) useBugfixSidecar();
    handler(parsed);
  } catch (e) {
    fail(e);
  }
}
main();
