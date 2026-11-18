import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  addFeedback,
  classifyFeedbackSignal,
  closeFeedback,
  feedbackPaths,
  importFeedbackMarkdown,
  loadFeedback,
  updateFeedback,
} from './lib/feedback.mjs';
import {
  assertFeedbackCompletionGate,
  runFeedbackEvolution,
} from './lib/evolution-gate.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), 'agent.mjs');
const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function freshRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'feedback-test-'));
  mkdirSync(join(root, '.agent'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    env: { ...process.env, AGENT_HOME: join(root, '.agent') },
    encoding: 'utf8',
  });
}

function jsonOutput(result) {
  const lines = String(result.stdout || '').trim().split('\n').filter(Boolean);
  return lines.length ? JSON.parse(lines.at(-1)) : {};
}

test('feedback signal classifier captures concrete defects but rejects generic or negated discussion', () => {
  assert.equal(classifyFeedbackSignal('这个页面有问题，保存一直失败').capture, true);
  assert.equal(classifyFeedbackSignal('记入复盘：地图打不开').explicit, true);
  assert.equal(classifyFeedbackSignal('请介绍一下 Bug 管理流程').capture, false);
  assert.equal(classifyFeedbackSignal('现在没有问题，先讨论后续方案').capture, false);
  assert.equal(classifyFeedbackSignal('这不是 Bug，是正常行为').capture, false);
  assert.equal(classifyFeedbackSignal('如果以后报错应该怎么处理').capture, false);
  assert.equal(classifyFeedbackSignal('我们先讨论一下，如果以后页面报错应该怎么处理').capture, false);
  assert.equal(classifyFeedbackSignal('需求文档里写着“页面有问题时要反馈”，请解释这条规则').capture, false);
});

test('feedback ledger allocates U/E ids, redacts sensitive values, renders Markdown, and suppresses duplicates', (t) => {
  const root = freshRoot(t);
  const first = addFeedback({
    root,
    source: 'user',
    title: '登录页面报错',
    symptom: 'sk-liveabcdefghijklmnop AKIAABCDEFGHIJKLMNOP AIzaabcdefghijklmnopqrstuvwxyz github_pat_abcdefghijklmnopqrstuvwxyz，手机号 13800138000 无法登录',
    phaseId: 'build-systems',
    taskId: 'phase-build-systems',
    evidence: ['browser:screenshot-1'],
  });
  assert.equal(first.record.id, 'U-001');
  assert.equal(first.duplicate, false);
  assert.doesNotMatch(first.record.symptom, /sk-liveabcdefghijklmnop/);
  assert.doesNotMatch(first.record.symptom, /AKIAABCDEFGHIJKLMNOP|AIzaabcdefghijklmnopqrstuvwxyz|github_pat_abcdefghijklmnopqrstuvwxyz/);
  assert.match(first.record.symptom, /\[REDACTED\]/);
  assert.match(first.record.symptom, /138\*\*\*\*8000/);

  const duplicate = addFeedback({
    root,
    source: 'user',
    title: '登录页面报错',
    symptom: 'sk-liveabcdefghijklmnop AKIAABCDEFGHIJKLMNOP AIzaabcdefghijklmnopqrstuvwxyz github_pat_abcdefghijklmnopqrstuvwxyz，手机号 13800138000 无法登录',
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.record.id, 'U-001');

  closeFeedback({
    root, id: 'U-001', rootCause: '登录态过期', resolution: '刷新登录态', status: '已归档',
  });
  const recurrence = addFeedback({
    root,
    source: 'user',
    title: '登录页面报错',
    symptom: 'sk-liveabcdefghijklmnop AKIAABCDEFGHIJKLMNOP AIzaabcdefghijklmnopqrstuvwxyz github_pat_abcdefghijklmnopqrstuvwxyz，手机号 13800138000 无法登录',
    evidence: ['browser:screenshot-2'],
  });
  assert.equal(recurrence.duplicate, true);
  assert.equal(recurrence.reopened, true);
  assert.equal(recurrence.record.status, '待定位');
  assert.equal(recurrence.record.reopened_count, 1);
  assert.equal(recurrence.record.previous_closures.length, 1);
  assert.equal(recurrence.record.root_cause, '');

  const engineering = addFeedback({
    root,
    source: 'engineering',
    title: '构建失败',
    symptom: 'Vite 编译退出码 1',
  });
  assert.equal(engineering.record.id, 'E-001');
  assert.equal(loadFeedback(root).length, 2);

  const paths = feedbackPaths(root);
  assert.equal(existsSync(paths.ledger), true);
  assert.equal(existsSync(paths.markdown), true);
  const markdown = readFileSync(paths.markdown, 'utf8');
  assert.match(markdown, /\| U-001 \| 登录页面报错/);
  assert.match(markdown, /\| E-001 \| 构建失败/);
  assert.match(markdown, /FEEDBACK:GENERATED-START/);
});

test('existing retrospective must be imported before mutation and import preserves a legacy backup', (t) => {
  const root = freshRoot(t);
  const paths = feedbackPaths(root);
  mkdirSync(join(root, 'docs', 'retrospective'), { recursive: true });
  const legacy = [
    '# 项目复盘待办',
    '',
    '| 编号 | 用户反馈 / 现象 | 根因 | 本轮处置 | 状态 |',
    '|---|---|---|---|---|',
    '| U-01 | 字典显示英文 | 页面未映射 | 增加中文映射 | 已验证待复盘 |',
    '',
    '| 编号 | 现象 | 定位结果 | 影响 | 状态 |',
    '|---|---|---|---|---|',
    '| E-01 | 构建报错 | 缺少 Sass | H5 无法构建 | 已修复待复盘 |',
    '',
    '## 手工补充',
    '- 这段说明必须保留。',
  ].join('\n');
  writeFileSync(paths.markdown, legacy);

  const other = join(root, 'other-retrospective.md');
  writeFileSync(other, legacy.replace('这段说明必须保留', '旁路文件不应覆盖主复盘'));
  assert.throws(
    () => importFeedbackMarkdown({ root, file: other }),
    /必须先导入它以防覆盖/,
  );
  assert.match(readFileSync(paths.markdown, 'utf8'), /这段说明必须保留/);

  assert.throws(
    () => addFeedback({ root, source: 'user', title: '新问题', symptom: '页面打不开' }),
    /feedback import/,
  );
  assert.throws(
    () => assertFeedbackCompletionGate({ root, phaseId: 'delivery' }),
    /feedback import/,
  );

  const result = importFeedbackMarkdown({ root, file: paths.markdown });
  assert.equal(result.imported, 2);
  assert.equal(existsSync(result.backupPath), true);
  assert.equal(loadFeedback(root).length, 2);
  assert.match(readFileSync(paths.markdown, 'utf8'), /这段说明必须保留/);
});

test('archiving feedback requires confirmed root cause and resolution', (t) => {
  const root = freshRoot(t);
  addFeedback({ root, source: 'user', title: '详情打不开', symptom: '点击查看后空白' });

  assert.throws(
    () => updateFeedback({ root, id: 'U-001', status: '已归档' }),
    /终态只能通过 feedback close/,
  );
  assert.throws(
    () => updateFeedback({ root, id: 'U-001', status: '随便写的状态' }),
    /状态非法/,
  );
  assert.throws(
    () => updateFeedback({ root, id: 'U-001', rootCause: '原因', resolution: '处置', status: '已归档' }),
    /终态只能通过 feedback close/,
  );
  assert.throws(
    () => closeFeedback({ root, id: 'U-001', status: '已归档' }),
    /root cause|根因/,
  );

  const updated = closeFeedback({
    root,
    id: 'U-001',
    rootCause: '详情接口 ID 精度丢失',
    resolution: 'ID 统一使用字符串传输',
    status: '已归档',
    evidence: ['test:detail-id'],
  });
  assert.equal(updated.status, '已归档');
  assert.equal(updated.root_cause, '详情接口 ID 精度丢失');
  assert.deepEqual(updated.evidence, ['test:detail-id']);
});

test('feedback evolution is offline, persists a relative report, and skips an unchanged fingerprint', (t) => {
  const root = freshRoot(t);
  addFeedback({ root, source: 'user', title: '详情打不开', symptom: '点击查看后空白' });
  closeFeedback({
    root, id: 'U-001', rootCause: 'ID 精度丢失', resolution: '统一字符串 ID', status: '已归档',
  });
  const report = join(root, 'harness_evolver', 'reports', 'run.md');
  mkdirSync(join(root, 'harness_evolver', 'reports'), { recursive: true });
  writeFileSync(report, '# report\n');
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return {
      status: 0,
      stdout: `${JSON.stringify({
        report_path: report,
        added_rule_ids: ['EVR-REQ-1'],
        removed_rule_ids: [],
      })}\n`,
      stderr: '',
    };
  };

  const first = runFeedbackEvolution({ root, reason: 'feedback-close', spawn });
  assert.equal(first.skipped, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].args.join(' '), /--use-llm never/);
  assert.match(calls[0].args.join(' '), /docs\/retrospective\/已归档反馈\.md/);
  assert.equal(first.state.report_path, 'harness_evolver/reports/run.md');
  assert.equal(first.state.pending, false);

  const second = runFeedbackEvolution({ root, reason: 'delivery-gate', spawn });
  assert.equal(second.skipped, true);
  assert.equal(calls.length, 1);
});

test('delivery and report phases block open feedback while unrelated phases pass', (t) => {
  const root = freshRoot(t);
  addFeedback({ root, source: 'engineering', title: '构建失败', symptom: '编译退出码 1' });

  const explicit = runFeedbackEvolution({ root, reason: 'explicit-keyword', spawn: () => assert.fail('open feedback must not evolve') });
  assert.equal(explicit.skipped, true);
  assert.equal(explicit.reason, 'no-archived-feedback');

  assert.throws(
    () => assertFeedbackCompletionGate({ root, phaseId: 'delivery', spawn: () => assert.fail('must not evolve') }),
    /未闭环反馈.*E-001/,
  );
  assert.throws(
    () => assertFeedbackCompletionGate({ root, phaseId: 'report', spawn: () => assert.fail('must not evolve') }),
    /未闭环反馈.*E-001/,
  );
  assert.deepEqual(assertFeedbackCompletionGate({ root, phaseId: 'build-systems' }), {
    gated: false,
    skipped: true,
    reason: 'phase-not-gated',
  });

  writeFileSync(feedbackPaths(root).ledger, `${JSON.stringify({
    id: 'E-001', source: 'engineering', title: '构建失败', symptom: '编译退出码 1',
    root_cause: '', resolution: '', impact: '', status: 'UNKNOWN', phase_id: '', task_id: '',
    evidence: [], fingerprint: 'a'.repeat(64), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  })}\n`);
  assert.throws(
    () => assertFeedbackCompletionGate({ root, phaseId: 'delivery' }),
    /状态非法/,
  );
});

test('failed evolution records pending state and does not lose archived feedback', (t) => {
  const root = freshRoot(t);
  addFeedback({ root, source: 'user', title: '地图异常', symptom: '地图无法加载' });
  closeFeedback({
    root, id: 'U-001', rootCause: 'SDK 加载失败', resolution: '失败后清理 loader', status: '已归档',
  });

  const outsideReport = join(dirname(root), `${basename(root)}-outside-report.md`);
  writeFileSync(outsideReport, '# not a project report\n');
  t.after(() => rmSync(outsideReport, { force: true }));
  assert.throws(
    () => runFeedbackEvolution({
      root,
      reason: 'feedback-close',
      spawn: () => ({ status: 0, stdout: `${JSON.stringify({ report_path: root })}\n`, stderr: '' }),
    }),
    /不是非空文件/,
  );
  assert.throws(
    () => runFeedbackEvolution({
      root,
      reason: 'feedback-close',
      spawn: () => ({
        status: 0,
        stdout: `${JSON.stringify({ report_path: outsideReport })}\n`,
        stderr: '',
      }),
    }),
    /越出项目根/,
  );

  assert.throws(
    () => runFeedbackEvolution({
      root,
      reason: 'feedback-close',
      spawn: () => ({ status: 2, stdout: '', stderr: 'python failed' }),
    }),
    /python failed/,
  );
  const state = JSON.parse(readFileSync(feedbackPaths(root).evolution, 'utf8'));
  assert.equal(state.pending, true);
  assert.match(state.error, /python failed/);
  assert.equal(loadFeedback(root)[0].status, '已归档');
});

test('feedback CLI detects, records, updates, closes, evolves, and lists feedback', (t) => {
  const root = freshRoot(t);
  cpSync(join(repoRoot, 'harness_evolver'), join(root, 'harness_evolver'), { recursive: true });

  let result = runCli(root, ['feedback', 'detect', '--text', '这个详情有问题，点击后打不开']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(jsonOutput(result).capture, true);

  result = runCli(root, ['feedback', 'add', '--source', 'user', '--title', '详情打不开', '--symptom', '点击后页面空白']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(jsonOutput(result).feedback.id, 'U-001');

  result = runCli(root, ['feedback', 'close', 'U-001', '--status', '处理中', '--root-cause', '临时原因', '--resolution', '临时处置']);
  assert.equal(result.status, 1);
  assert.equal(jsonOutput(result).code, 'EINPUT');
  assert.equal(loadFeedback(root)[0].status, '待定位');

  result = runCli(root, ['feedback', 'update', 'U-001', '--status', '处理中', '--root-cause', 'ID 精度待确认']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(jsonOutput(result).feedback.status, '处理中');

  result = runCli(root, ['feedback', 'close', 'U-001', '--root-cause', 'ID 精度丢失', '--resolution', '统一字符串 ID']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const closed = jsonOutput(result);
  assert.equal(closed.feedback.status, '已归档');
  assert.equal(closed.evolution.pending, false);
  assert.equal(existsSync(join(root, closed.evolution.report_path)), true);

  result = runCli(root, ['feedback', 'evolve']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(jsonOutput(result).skipped, true);

  result = runCli(root, ['feedback', 'list']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(jsonOutput(result).items.length, 1);
  assert.equal(jsonOutput(result).items[0].id, 'U-001');
});

test('complete returns EOPEN_FEEDBACK for delivery with unresolved feedback', (t) => {
  const root = freshRoot(t);
  rmSync(join(root, '.agent'), { recursive: true, force: true });
  cpSync(join(repoRoot, 'dot-agent'), join(root, '.agent'), { recursive: true });
  cpSync(join(repoRoot, 'harness_evolver'), join(root, 'harness_evolver'), { recursive: true });

  let result = runCli(root, ['install']);
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(root, '.agent', 'process.json'), JSON.stringify({
    process_version: 1,
    workflow: 'default',
    name: '反馈门禁测试',
    phases: [{
      id: 'delivery', no: '07', name: '交付', intent: '交付', skills: [], inputs: [],
      depends_on: [], gates: [], dod: ['反馈已闭环'], artifacts: [],
    }],
    rails: [],
  }, null, 2));
  result = runCli(root, ['phase', 'start', 'delivery']);
  assert.equal(result.status, 0, result.stderr);
  result = runCli(root, ['feedback', 'add', '--source', 'engineering', '--title', '构建失败', '--symptom', '退出码 1']);
  assert.equal(result.status, 0, result.stderr);

  result = runCli(root, ['complete']);
  assert.equal(result.status, 1);
  assert.equal(jsonOutput(result).code, 'EOPEN_FEEDBACK');
  assert.match(jsonOutput(result).error, /E-001/);

  const manualRoot = freshRoot(t);
  rmSync(join(manualRoot, '.agent'), { recursive: true, force: true });
  cpSync(join(repoRoot, 'dot-agent'), join(manualRoot, '.agent'), { recursive: true });
  cpSync(join(repoRoot, 'harness_evolver'), join(manualRoot, 'harness_evolver'), { recursive: true });
  result = runCli(manualRoot, ['install']);
  assert.equal(result.status, 0, result.stderr);
  result = runCli(manualRoot, ['init', '--id', 'manual-delivery', '--objective', 'manual delivery', '--phase', 'delivery', '--dod', 'done']);
  assert.equal(result.status, 0, result.stderr);
  result = runCli(manualRoot, ['feedback', 'add', '--source', 'user', '--title', '手工任务问题', '--symptom', '交付前仍未解决']);
  assert.equal(result.status, 0, result.stderr);
  result = runCli(manualRoot, ['complete']);
  assert.equal(result.status, 1);
  assert.equal(jsonOutput(result).code, 'EOPEN_FEEDBACK');
  assert.match(jsonOutput(result).error, /U-001/);
});
