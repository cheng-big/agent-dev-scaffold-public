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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { importBugs, mergeBugLedger } from './lib/bugimport.mjs';
import { buildRepoMap } from './lib/repomap.mjs';
import {
  buildBugReportBundle,
  checkBugReport,
  writeBugReport,
} from './lib/report.mjs';
import { validate } from './lib/schema.mjs';
import commentsPlugin from './lib/no-comments.mjs';
import { verifyBugLint } from './lib/buglint.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), 'agent.mjs');

function freshDir(t, prefix = 'bugfix-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runCli(home, args, cwd) {
  return spawnSync(process.execPath, [cli, ...args, '--json'], {
    cwd,
    env: { ...process.env, AGENT_HOME: home },
    encoding: 'utf8',
  });
}

function jsonLine(output) {
  const lines = String(output || '').trim().split('\n').filter(Boolean);
  return lines.length ? JSON.parse(lines.at(-1)) : {};
}

test('bug import preserves accepted and closed source rows with stable source keys', (t) => {
  const dir = freshDir(t);
  const csv = join(dir, 'bugs.csv');
  writeFileSync(csv, [
    '状态,模块,描述',
    '待修复,H5,邀请海报首次保存失败',
    '已验收,后台,城市筛选已验收',
    '已关闭,H5,历史反馈已关闭',
  ].join('\n'));

  const { bugs, warnings } = importBugs(csv, { sourceId: 'feishu:sheet-1' });

  assert.deepEqual(warnings, []);
  assert.equal(bugs.length, 3);
  assert.deepEqual(bugs.map((bug) => bug.source_status), ['待修复', '已验收', '已关闭']);
  assert.deepEqual(bugs.map((bug) => bug.source_row), [2, 3, 4]);
  assert.deepEqual(bugs.map((bug) => bug.source_key), [
    'feishu:sheet-1#row-2',
    'feishu:sheet-1#row-3',
    'feishu:sheet-1#row-4',
  ]);
});

test('bug sync updates source fields but preserves verification history and missing rows', () => {
  const existing = [
    {
      id: 'BUG-001',
      source_key: 'feishu:sheet-1#row-2',
      title: '旧标题',
      status: '待修复',
      source_status: '待修复',
      verification_status: '已验证',
      verification_scope: '正式环境浏览器',
      verification_note: '已有真实回读',
      verified_at: '2026-08-26T10:00:00+08:00',
      evidence_refs: ['ev:old'],
    },
    {
      id: 'BUG-OLD',
      source_key: 'feishu:sheet-1#row-9',
      title: '源表已删除的历史项',
      status: '待修复',
      source_status: '待修复',
      verification_status: '部分验证',
      evidence_refs: ['ev:history'],
    },
  ];
  const incoming = [
    {
      id: 'BUG-001',
      source_key: 'feishu:sheet-1#row-2',
      title: '源表更新标题',
      status: '已验收',
      source_status: '已验收',
    },
    {
      id: 'BUG-002',
      source_key: 'feishu:sheet-1#row-3',
      title: '新的待开发项',
      status: '待开发',
      source_status: '待开发',
    },
  ];

  const merged = mergeBugLedger(existing, incoming, {
    scopeStatuses: ['待修复', '待开发'],
  });

  const accepted = merged.find((bug) => bug.id === 'BUG-001');
  assert.equal(accepted.title, '源表更新标题');
  assert.equal(accepted.source_status, '已验收');
  assert.equal(accepted.verification_status, '已验证');
  assert.equal(accepted.verification_scope, '正式环境浏览器');
  assert.equal(accepted.verification_note, '已有真实回读');
  assert.equal(accepted.verified_at, '2026-08-26T10:00:00+08:00');
  assert.deepEqual(accepted.evidence_refs, ['ev:old']);
  assert.equal(accepted.in_scope, false);
  assert.equal(accepted.source_presence, 'present');

  const pending = merged.find((bug) => bug.id === 'BUG-002');
  assert.equal(pending.in_scope, true);
  assert.equal(pending.verification_status, '待验证');

  const missing = merged.find((bug) => bug.id === 'BUG-OLD');
  assert.equal(missing.source_presence, 'missing');
  assert.equal(missing.in_scope, false);
  assert.equal(missing.verification_status, '部分验证');
  assert.deepEqual(missing.evidence_refs, ['ev:history']);
});

test('repo map deterministically lists application pages and service files', (t) => {
  const root = freshDir(t, 'repo-map-test-');
  mkdirSync(join(root, 'services'), { recursive: true });
  mkdirSync(join(root, 'pages', 'home'), { recursive: true });
  writeFileSync(join(root, 'app.json'), JSON.stringify({ pages: ['pages/home/index'] }));
  writeFileSync(join(root, 'services', 'hotel.js'), 'export function listHotels() { return []; }\n');
  writeFileSync(join(root, 'pages', 'home', 'index.js'), "import { listHotels } from '../../services/hotel.js';\nlistHotels();\n");

  const { markdown, stats } = buildRepoMap(root);

  assert.equal(stats.pages, 1);
  assert.equal(stats.services, 1);
  assert.match(markdown, /pages\/home\/index/);
  assert.match(markdown, /services\/hotel\.js/);
});

function reportFixture(t, { evidenceRef = 'ev:probe123' } = {}) {
  const base = freshDir(t, 'bug-report-test-');
  const root = join(base, '.agent');
  mkdirSync(join(root, 'bugs', 'BUG-001', 'evidence'), { recursive: true });
  mkdirSync(join(root, 'evidence', 'task-1'), { recursive: true });
  const bugs = [{
    id: 'BUG-001',
    title: '报价未聚合',
    module: '后台管理',
    status: '待修复',
    source_status: '待修复',
    verification_status: '已验证',
    verification_scope: '正式环境浏览器',
    verified_at: '2026-08-27',
    verification_note: '自营与渠道报价同时可见。',
    evidence_refs: [evidenceRef],
  }];
  writeFileSync(join(root, 'bugs.json'), JSON.stringify(bugs, null, 2));
  writeFileSync(
    join(root, 'bugs', 'BUG-001', 'evidence', 'verification.md'),
    '# 浏览器证据\n- 控制台错误：0\n',
  );
  if (evidenceRef === 'ev:probe123') {
    writeFileSync(
      join(root, 'evidence', 'task-1', 'ev_probe123.json'),
      JSON.stringify({ id: evidenceRef, kind: 'browser', data: { result: 'PASS', offers: 5 } }, null, 2),
    );
  }
  return {
    root,
    output: join(root, 'reports', 'index.html'),
    bugsPath: join(root, 'bugs.json'),
    evidencePath: join(root, 'evidence', 'task-1', 'ev_probe123.json'),
  };
}

test('bug report renders dual statuses plus local and harness evidence', (t) => {
  const { root } = reportFixture(t);
  const { html, manifest } = buildBugReportBundle(root);

  assert.match(html, /本轮：已验证/);
  assert.match(html, /源状态：待修复/);
  assert.match(html, /正式环境浏览器/);
  assert.match(html, /自营与渠道报价同时可见/);
  assert.match(html, /控制台错误：0/);
  assert.match(html, /ev:probe123/);
  assert.match(html, /&quot;offers&quot;: 5/);
  assert.equal(manifest.schema_version, 1);
  assert.ok(manifest.inputs.some((item) => item.path === 'bugs.json'));
  assert.ok(manifest.inputs.some((item) => item.ref === 'ev:probe123'));
});

test('missing harness evidence is visible and makes the report non-fresh', (t) => {
  const { root, output } = reportFixture(t, { evidenceRef: 'ev:missing' });
  const { html } = buildBugReportBundle(root);
  assert.match(html, /证据引用缺失：ev:missing/);

  writeBugReport(root, output);
  const result = checkBugReport(root, output);
  assert.equal(result.fresh, false);
  assert.deepEqual(result.reasons, ['missing evidence: ev:missing']);
});

test('report freshness detects a changed ledger', (t) => {
  const { root, output, bugsPath } = reportFixture(t);
  writeBugReport(root, output);
  assert.deepEqual(checkBugReport(root, output), { fresh: true, reasons: [] });

  const changed = JSON.parse(readFileSync(bugsPath, 'utf8'));
  changed[0].verification_note = '结论已经改变';
  writeFileSync(bugsPath, JSON.stringify(changed, null, 2));

  assert.deepEqual(checkBugReport(root, output), {
    fresh: false,
    reasons: ['input changed: bugs.json'],
  });
});

test('report freshness detects changed evidence and changed output', (t) => {
  const { root, output, evidencePath } = reportFixture(t);
  writeBugReport(root, output);

  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  evidence.data.offers = 6;
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  assert.deepEqual(checkBugReport(root, output), {
    fresh: false,
    reasons: ['input changed: ev:probe123'],
  });

  writeBugReport(root, output);
  writeFileSync(output, '<!doctype html><title>tampered</title>');
  assert.deepEqual(checkBugReport(root, output), {
    fresh: false,
    reasons: ['output changed: reports/index.html'],
  });
});

test('bugfix CLI imports, lists, reports, and returns ESTALE_REPORT after source change', (t) => {
  const base = freshDir(t, 'bugfix-cli-test-');
  const home = join(base, '.agent');
  const csv = join(base, 'bugs.csv');
  writeFileSync(csv, [
    '状态,模块,描述',
    '待修复,H5,海报保存失败',
    '待开发,后台,补录订单供应商',
    '已验收,后台,城市筛选',
  ].join('\n'));

  const imported = runCli(home, [
    'bug', 'import', '--file', csv, '--source', 'feishu:sheet-1',
    '--status', '待修复,待开发',
  ]);
  assert.equal(imported.status, 0, imported.stderr);
  const ledger = JSON.parse(readFileSync(join(home, 'bugs.json'), 'utf8'));
  assert.equal(ledger.length, 3);
  assert.deepEqual(ledger.map((bug) => bug.in_scope), [true, true, false]);

  const listed = runCli(home, ['bug', 'list']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(jsonLine(listed.stdout).items[0].source_status, /待修复/);

  assert.equal(runCli(home, ['report']).status, 0);
  assert.equal(runCli(home, ['report', 'check']).status, 0);

  ledger[0].verification_note = 'source changed after report';
  writeFileSync(join(home, 'bugs.json'), JSON.stringify(ledger, null, 2));
  const stale = runCli(home, ['report', 'check']);
  assert.notEqual(stale.status, 0);
  assert.equal(jsonLine(stale.stdout).code, 'ESTALE_REPORT');
});

test('bugfix report phase cannot complete with a stale report', (t) => {
  const { root, output, bugsPath } = reportFixture(t);
  writeBugReport(root, output);
  writeFileSync(join(root, 'process.json'), JSON.stringify({
    process_version: 1,
    workflow: 'bugfix',
    name: 'Bug 修复流程',
    phases: [{ id: 'report', name: '报告归档', artifacts: [] }],
  }, null, 2));
  writeFileSync(join(root, 'process-state.json'), JSON.stringify({
    process_version: 1,
    current_phase: 'report',
    phase_tasks: { report: 'phase-report' },
    artifacts: [],
    updated_at: '2026-08-27T00:00:00.000Z',
  }, null, 2));

  assert.equal(runCli(root, [
    'init', '--id', 'phase-report', '--objective', 'archive fresh report',
    '--dod', 'report is fresh',
  ]).status, 0);
  assert.equal(runCli(root, [
    'start-step', '--step', 'report-step', '--intent', 'verify report',
  ]).status, 0);
  const evidenceResult = runCli(root, [
    'evidence', 'add', '--kind', 'report', '--ref', 'reports/index.html',
    '--data', JSON.stringify({ result: 'PASS' }),
  ]);
  assert.equal(evidenceResult.status, 0);
  const evidence = jsonLine(evidenceResult.stdout).evidence_id;
  assert.equal(runCli(root, ['verify', '--evidence', evidence]).status, 0);
  assert.equal(runCli(root, ['commit-step', '--evidence', evidence]).status, 0);
  assert.equal(runCli(root, ['dod', 'set', '--index', '0', '--met', '--evidence', evidence]).status, 0);

  const changed = JSON.parse(readFileSync(bugsPath, 'utf8'));
  changed[0].verification_note = 'stale after verification';
  writeFileSync(bugsPath, JSON.stringify(changed, null, 2));
  const completed = runCli(root, ['complete']);
  assert.notEqual(completed.status, 0);
  assert.equal(jsonLine(completed.stdout).code, 'ESTALE_REPORT');
});

test('built-in bugfix workflow template passes the process schema', () => {
  const templatePath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'process',
    'bugfix.template.json',
  );
  const template = JSON.parse(readFileSync(templatePath, 'utf8'));
  const result = validate('process.schema.json', template);
  assert.deepEqual(result, { valid: true, errors: [] });
  assert.equal(template.workflow, 'bugfix');
  assert.equal(template.phases.length, 10);
  assert.deepEqual(template.phases.find((phase) => phase.id === 'verify').depends_on, ['reconcile']);
  assert.equal(template.phases.at(-1).id, 'report');
});

test('install selects Bugfix without replacing an active development workflow', (t) => {
  const root = freshDir(t);
  const home = join(root, '.agent');
  const source = join(dirname(cli), '..');
  mkdirSync(home);
  cpSync(join(source, 'PROJECT.md.template'), join(home, 'PROJECT.md.template'));
  const run = (...args) => runCli(home, args, root);
  assert.equal(run('install').status, 0);
  const processFile = join(home, 'process.json');
  const development = readFileSync(processFile, 'utf8');
  const start = run('phase', 'start', JSON.parse(development).phases[0].id);
  assert.equal(start.status, 0, start.stdout);
  const active = readFileSync(join(home, 'ACTIVE_TASK.json'), 'utf8');
  assert.equal(run('install', '--workflow', 'bugfix').status, 0);
  assert.equal(readFileSync(processFile, 'utf8'), development);
  assert.equal(JSON.parse(readFileSync(join(home, 'process-bugfix.json'), 'utf8')).phases.length, 10);
  const orient = run('phase', 'start', 'orient', '--workflow', 'bugfix');
  assert.equal(orient.status, 0, orient.stdout);
  assert.equal(readFileSync(join(home, 'ACTIVE_TASK.json'), 'utf8'), active);
  assert.ok(existsSync(join(home, 'ACTIVE_BUGFIX_TASK.json')));
  assert.ok(existsSync(join(home, 'process-bugfix-state.json')));
  const bugOnlyRoot = freshDir(t);
  const bugOnlyHome = join(bugOnlyRoot, '.agent');
  assert.equal(runCli(bugOnlyHome, ['install', '--workflow', 'bugfix'], bugOnlyRoot).status, 0);
  assert.equal(JSON.parse(readFileSync(join(bugOnlyHome, 'process.json'), 'utf8')).workflow, 'bugfix');
  assert.match(readFileSync(join(bugOnlyRoot, 'AGENTS.md'), 'utf8'), /bug list/);
});

test('install updates only the managed AGENTS.md block and rejects a damaged marker', (t) => {
  const root = freshDir(t);
  const home = join(root, '.agent');
  const policyPath = join(root, 'AGENTS.md');
  const original = '# Team rules\r\n\r\nPreserve existing project rules.\r\n';
  const tail = '\r\n# Rules after the managed block\r\n';
  const start = '<!-- agent-dev-scaffold:harness:start -->';
  const end = '<!-- agent-dev-scaffold:harness:end -->';
  const run = () => runCli(home, ['install'], root);
  writeFileSync(policyPath, original);
  assert.equal(run().status, 0);
  const installed = readFileSync(policyPath, 'utf8');
  assert.ok(installed.startsWith(original));
  assert.match(installed, /bug add/);
  assert.match(installed, /bug close/);
  assert.ok(!installed.replaceAll('\r\n', '').includes('\n'));
  writeFileSync(policyPath, `${original}\r\n${start}\r\nOld policy\r\n${end}\r\n${tail}`);
  assert.equal(run().status, 0);
  assert.equal(readFileSync(policyPath, 'utf8'), installed + tail);
  assert.equal(run().status, 0);
  assert.equal(readFileSync(policyPath, 'utf8'), installed + tail);
  const broken = original + start;
  writeFileSync(policyPath, broken);
  assert.equal(jsonLine(run().stdout).code, 'EAGENT_POLICY');
  assert.equal(readFileSync(policyPath, 'utf8'), broken);
});

test('project knowledge changes context and the same board only after confirmation and verified delivery', (t) => {
  const root = freshDir(t, 'knowledge-test-');
  const home = join(root, '.agent');
  const cliResult = (...args) => runCli(home, args, root);
  const run = (...args) => {
    const result = cliResult(...args);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    return jsonLine(result.stdout);
  };
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  writeFileSync(join(root, 'claim-v1.md'), 'Claim once.');
  writeFileSync(join(root, 'claim-v2.md'), 'Claim once, then show confirmation.');
  git('add', 'claim-v1.md');
  git('update-ref', 'HEAD', git('commit-tree', git('write-tree'), '-m', 'Fixture baseline'));
  run('install');
  run('knowledge', 'capture', '--feature', 'member.claim', '--title', 'Claim benefit', '--source', 'claim-v1.md');
  const phase = JSON.parse(readFileSync(join(home, 'process.json'), 'utf8')).phases[0].id;
  assert.deepEqual(run('phase', 'start', phase, '--feature', 'member.claim').knowledge, []);
  assert.deepEqual(run('next').knowledge_missing, ['member.claim']);
  run('knowledge', 'confirm', 'member.claim', '--revision', '1');
  assert.equal(run('next').knowledge[0].source, 'Claim once.');
  assert.equal(run('resume').knowledge[0].revision, 1);
  run('knowledge', 'capture', '--feature', 'member.claim', '--title', 'Claim benefit', '--source', 'claim-v2.md');
  assert.equal(run('next').knowledge[0].revision, 1);
  run('knowledge', 'confirm', 'member.claim', '--revision', '2');
  assert.equal(run('next').knowledge[0].revision, 2);
  assert.equal(run('context').knowledge[0].revision, 2);
  run('install');
  assert.equal(run('knowledge', 'find', 'member.claim').rows[0].revision, 2);
  run('init', '--id', 'claim-delivery', '--objective', 'Accept claim flow', '--dod', 'Confirmation shown');
  run('knowledge', 'use', 'member.claim');
  writeFileSync(join(root, 'acceptance.txt'), 'PASS: confirmed claim shown once');
  run('start-step', '--step', 'accept', '--intent', 'verify claim confirmation');
  const { evidence_id: evidence } = run('evidence', 'add', '--kind', 'report', '--ref', 'acceptance.txt', '--data', '{"result":"PASS"}');
  run('verify', '--evidence', evidence);
  run('commit-step', '--evidence', evidence);
  run('dod', 'set', '--index', '0', '--met', '--evidence', evidence);
  assert.equal(jsonLine(cliResult('complete', '--proof', 'claim-v1.md').stdout).code, 'EKNOWLEDGE');
  assert.equal(run('complete', '--proof', 'acceptance.txt').knowledge_delivery[0].delivery.proof[0].path, 'acceptance.txt');
  run('knowledge', 'check');
  const board = readFileSync(join(home, 'board.html'), 'utf8');
  assert.match(board, /下一步/);
  assert.match(board, /data-t="knowledge"/);
  assert.match(board, /acceptance\.txt/);
  writeFileSync(join(root, 'claim-v2.md'), 'Unconfirmed change.');
  assert.equal(run('knowledge', 'find', 'member.claim').rows[0].source, '');
  assert.equal(jsonLine(cliResult('knowledge', 'check').stdout).code, 'EKNOWLEDGE');
});

test('runtime regression must reject the bad sample and pass on the current implementation', (t) => {
  const root = freshDir(t);
  const agentRoot = join(root, '.agent');
  const directory = join(agentRoot, 'bugs', 'retry');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'regression.json'), '{"case":"retry.once"}');
  writeFileSync(join(root, 'comment-bad.json'), '["project/no-comments"]');
  writeFileSync(join(root, 'comment-good.json'), '[]');
  writeFileSync(join(root, 'runner.mjs'), `import { readFileSync } from 'node:fs';
const [mode, first, sample] = process.argv.slice(2);
if (mode === 'inspect') console.log(readFileSync(first, 'utf8'));
if (mode === 'regression') console.log(JSON.stringify({case:first,sample,result:Number(readFileSync(sample + '.txt', 'utf8')) === 1 ? 'PASS' : 'FAIL'}));`);
  writeFileSync(join(agentRoot, 'bug-lint.json'), JSON.stringify({
    inspect: [process.execPath, 'runner.mjs', 'inspect'],
    project: [process.execPath, 'runner.mjs', 'project'],
    regression: [process.execPath, 'runner.mjs', 'regression'],
    comments: { rule: 'project/no-comments', bad: 'comment-bad.json', good: 'comment-good.json' },
  }));
  writeFileSync(join(root, 'bad.txt'), '2');
  writeFileSync(join(root, 'good.txt'), '1');
  writeFileSync(join(root, 'current.txt'), '2');
  const verify = () => verifyBugLint({ root, agentRoot, directory });
  assert.throws(verify, /current.*PASS/);
  writeFileSync(join(root, 'current.txt'), '1');
  assert.equal(verify().mode, 'runtime');
  writeFileSync(join(root, 'bad.txt'), '1');
  assert.throws(verify, /bad.*FAIL/);
});

test('local Bug survives sync and archives evidence into project rules and a separate scaffold proposal', (t) => {
  const root = freshDir(t);
  const home = join(root, '.agent');
  cpSync(join(dirname(cli), '..', '..', 'harness_evolver'), join(root, 'harness_evolver'), { recursive: true });
  const run = (...args) => runCli(home, args, root);
  const first = run('bug', 'add', '--title', 'ID 精度丢失', '--symptom', '数字转换导致查询失败');
  assert.equal(first.status, 0, first.stdout);
  const { id } = jsonLine(first.stdout).bug;
  assert.equal(jsonLine(run('bug', 'add', '--title', 'ID 精度丢失', '--symptom', '数字转换导致查询失败').stdout).bug.id, id);
  const csv = join(root, 'bugs.csv');
  writeFileSync(csv, '状态,模块,描述\n待修复,后台,筛选失效\n');
  assert.equal(run('bug', 'sync', '--file', csv, '--source', 'test-sheet').status, 0);
  const ledgerFile = join(home, 'bugs.json');
  const readBug = () => JSON.parse(readFileSync(ledgerFile, 'utf8')).find((bug) => bug.id === id);
  assert.equal(readBug().in_scope, true);
  assert.equal(jsonLine(run('bug', 'close', id).stdout).code, 'EMISSING_BUG_EVIDENCE');
  const directory = join(home, 'bugs', id);
  mkdirSync(join(directory, 'evidence'), { recursive: true });
  writeFileSync(join(directory, 'root-cause.md'), 'JavaScript Number 转换使大整数 ID 精度丢失。');
  writeFileSync(join(directory, 'impact.md'), '列表筛选和详情查询受影响。\nservice.mjs');
  writeFileSync(join(directory, 'change.md'), '保持字符串 ID，无需数值转换。');
  writeFileSync(join(directory, 'fix-plan.md'), '修改 service.mjs');
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  writeFileSync(join(root, 'service.mjs'), 'export function queryId(value) { return Number(value); }\n');
  git('add', 'service.mjs');
  const baseline = git('commit-tree', git('write-tree'), '-m', 'Fixture baseline');
  writeFileSync(join(root, 'service.mjs'), 'export function queryId(value) { return String(value); }\n');
  writeFileSync(join(root, 'caller.mjs'), 'import { queryId } from "./service.mjs";\n');
  const impact = run('impact-check', '--bug', id, '--base', baseline);
  assert.equal(impact.status, 0, impact.stdout);
  assert.equal(jsonLine(impact.stdout).changedFiles, 1);
  assert.equal(jsonLine(impact.stdout).uncoveredCallers, 1);
  writeFileSync(join(directory, 'evidence', 'verification.md'), '复现路径 PASS；详情和筛选回归 PASS。');
  assert.equal(jsonLine(run('bug', 'close', id).stdout).code, 'EMISSING_BUG_MEDIA');
  const screenshot = join(directory, 'evidence', 'verification.png');
  writeFileSync(screenshot, 'This is a text file with a PNG suffix.');
  assert.equal(jsonLine(run('bug', 'close', id).stdout).code, 'EMISSING_BUG_MEDIA');
  writeFileSync(screenshot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'));
  assert.equal(jsonLine(run('bug', 'close', id).stdout).code, 'EBUG_LINT');
  writeFileSync(join(root, 'lint-fixture.mjs'), `import { readFileSync, existsSync } from 'node:fs';
const [mode, file] = process.argv.slice(2);
if (mode === 'project') process.exit(existsSync('lint-failure') ? 1 : 0);
console.log(readFileSync(file, 'utf8'));`);
  const inspect = [process.execPath, 'lint-fixture.mjs', 'inspect'];
  const project = [process.execPath, 'lint-fixture.mjs', 'project'];
  writeFileSync(join(home, 'bug-lint.json'), JSON.stringify({
    inspect, project, comments: { rule: 'project/no-comments', bad: 'comment-bad.json', good: 'comment-good.json' },
  }));
  writeFileSync(join(root, 'comment-bad.json'), '["project/no-comments"]');
  writeFileSync(join(root, 'comment-good.json'), '[]');
  writeFileSync(join(directory, 'lint.json'), JSON.stringify({ rule: 'project/no-number-id', bad: 'bad.json', good: 'good.json' }));
  writeFileSync(join(directory, 'good.json'), '[]');
  writeFileSync(join(directory, 'bad.json'), '[]');
  assert.equal(jsonLine(run('bug', 'close', id).stdout).code, 'EBUG_LINT');
  writeFileSync(join(directory, 'bad.json'), '["project/no-number-id"]');
  writeFileSync(join(root, 'lint-failure'), 'FAIL');
  assert.equal(jsonLine(run('bug', 'close', id).stdout).code, 'EBUG_LINT');
  assert.equal(readBug().verification_status, '待验证');
  rmSync(join(root, 'lint-failure'));
  const proposal = '在通用契约加入长 ID 字符串约束';
  const closed = run('bug', 'close', id, '--scaffold-candidate', proposal);
  assert.equal(closed.status, 0, closed.stdout);
  assert.equal(readBug().verification_status, '已归档');
  const proof = JSON.parse(readFileSync(join(directory, 'evidence', 'lint-proof.json'), 'utf8'));
  assert.deepEqual(proof.rules.map(({ rule }) => rule), ['project/no-number-id', 'project/no-comments']);
  const docs = join(root, 'docs', 'retrospective');
  const state = JSON.parse(readFileSync(join(docs, 'evolution.json'), 'utf8'));
  assert.equal(state.pending, false);
  assert.ok(existsSync(join(root, state.report_path)));
  assert.ok(readFileSync(join(docs, '项目复盘待办.md'), 'utf8').includes(proposal));
  assert.ok(!readFileSync(join(docs, '已归档反馈.md'), 'utf8').includes(proposal));
  const retry = run('bug', 'close', id);
  assert.equal(retry.status, 0, retry.stdout);
  assert.equal(jsonLine(retry.stdout).feedback.id, readBug().feedback_id);
  assert.equal(readFileSync(join(docs, 'feedback.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('no-comments rule rejects line and block comment tokens', () => {
  const reported = [];
  const firstLocation = { start: { line: 1, column: 0 }, end: { line: 1, column: 18 } };
  const secondLocation = { start: { line: 2, column: 0 }, end: { line: 2, column: 20 } };
  const context = {
    sourceCode: { getAllComments: () => [
      { type: 'Line', loc: firstLocation },
      { type: 'Block', loc: secondLocation },
    ] },
    report: (finding) => reported.push(finding),
  };
  commentsPlugin.rules['no-comments'].create(context).Program();
  assert.deepEqual(reported, [firstLocation, secondLocation].map((loc) => ({ loc, messageId: 'forbidden' })));
});
