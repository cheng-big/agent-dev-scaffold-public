import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = join(dirname(fileURLToPath(import.meta.url)), 'agent.mjs');

function freshHome(t) {
  const base = mkdtempSync(join(tmpdir(), 'external-effect-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return join(base, '.agent');
}

function run(home, args) {
  return spawnSync(process.execPath, [cli, ...args, '--json'], {
    env: { ...process.env, AGENT_HOME: home },
    encoding: 'utf8',
  });
}

function jsonLine(output) {
  const lines = String(output || '').trim().split('\n').filter(Boolean);
  return lines.length ? JSON.parse(lines.at(-1)) : {};
}

function init(home) {
  const result = run(home, [
    'init', '--id', 'external-task', '--objective', 'write external state',
    '--dod', 'external state persisted',
  ]);
  assert.equal(result.status, 0, result.stderr);
}

function startExternal(home, targets = ['feishu:sheet:I27']) {
  const args = [
    'start-step', '--step', 'write-results', '--idem', 'write-results-1',
    '--intent', 'write verification results', '--effect', 'external-write',
  ];
  for (const target of targets) args.push('--target', target);
  const result = run(home, args);
  assert.equal(result.status, 0, result.stderr);
}

function addEvidence(home, kind, target, data) {
  const result = run(home, [
    'evidence', 'add', '--kind', kind, '--target', target,
    '--ref', `${kind}:${target}`, '--data', JSON.stringify(data),
  ]);
  assert.equal(result.status, 0, result.stderr);
  return jsonLine(result.stdout).evidence_id;
}

function addAttempt(home, target, fingerprint = 'sha256:expected') {
  return addEvidence(home, 'external-write-attempt', target, {
    operation: 'set-cell',
    expected_fingerprint: fingerprint,
    result: 'attempted',
  });
}

function addReadback(home, target, over = {}) {
  return addEvidence(home, 'external-readback', target, {
    result: 'PASS',
    independent_context: true,
    readback_mode: 'fresh-tab',
    expected_fingerprint: 'sha256:expected',
    observed_fingerprint: 'sha256:expected',
    ...over,
  });
}

function taskSnapshot(home) {
  return JSON.parse(readFileSync(join(home, 'tasks', 'external-task.json'), 'utf8'));
}

function commit(home, evidence) {
  const args = ['commit-step', '--summary', 'external write persisted'];
  for (const ref of evidence) args.push('--evidence', ref);
  return run(home, args);
}

test('ordinary steps keep the existing commit behavior', (t) => {
  const home = freshHome(t);
  init(home);
  assert.equal(run(home, [
    'start-step', '--step', 'local-step', '--intent', 'write local file',
  ]).status, 0);
  const note = addEvidence(home, 'test', 'local:file', { result: 'PASS' });
  const result = commit(home, [note]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(taskSnapshot(home).open_step, null);
});

test('external write cannot commit with only an attempt', (t) => {
  const home = freshHome(t);
  init(home);
  startExternal(home);
  const attempt = addAttempt(home, 'feishu:sheet:I27');
  const result = commit(home, [attempt]);
  assert.notEqual(result.status, 0);
  assert.equal(jsonLine(result.stdout).code, 'EEXTERNALREADBACK');
  assert.equal(taskSnapshot(home).open_step.step_id, 'write-results');
});

test('external write rejects a failed independent readback', (t) => {
  const home = freshHome(t);
  init(home);
  startExternal(home);
  const attempt = addAttempt(home, 'feishu:sheet:I27');
  const readback = addReadback(home, 'feishu:sheet:I27', { result: 'FAIL' });
  const result = commit(home, [attempt, readback]);
  assert.notEqual(result.status, 0);
  assert.equal(jsonLine(result.stdout).code, 'EEXTERNALREADBACK');
});

test('external write rejects mismatched target, step binding, and fingerprint', (t) => {
  const cases = [
    { name: 'target', target: 'feishu:sheet:I30', over: {} },
    { name: 'fingerprint', target: 'feishu:sheet:I27', over: { observed_fingerprint: 'sha256:other' } },
    { name: 'context', target: 'feishu:sheet:I27', over: { independent_context: false } },
  ];

  for (const item of cases) {
    const home = freshHome(t);
    init(home);
    startExternal(home);
    const attempt = addAttempt(home, 'feishu:sheet:I27');
    const readback = addReadback(home, item.target, item.over);
    const result = commit(home, [attempt, readback]);
    assert.notEqual(result.status, 0, `${item.name} mismatch must be rejected`);
    assert.equal(jsonLine(result.stdout).code, 'EEXTERNALREADBACK');
  }

  const staleHome = freshHome(t);
  init(staleHome);
  const staleReadback = addReadback(staleHome, 'feishu:sheet:I27');
  startExternal(staleHome);
  const attempt = addAttempt(staleHome, 'feishu:sheet:I27');
  const staleResult = commit(staleHome, [attempt, staleReadback]);
  assert.notEqual(staleResult.status, 0, 'readback created outside the current step must be rejected');
  assert.equal(jsonLine(staleResult.stdout).code, 'EEXTERNALREADBACK');
});

test('every declared external target requires its own readback', (t) => {
  const home = freshHome(t);
  init(home);
  startExternal(home, ['feishu:sheet:I27', 'feishu:sheet:I30']);
  const attempt27 = addAttempt(home, 'feishu:sheet:I27');
  const attempt30 = addAttempt(home, 'feishu:sheet:I30');
  const readback27 = addReadback(home, 'feishu:sheet:I27');
  const result = commit(home, [attempt27, attempt30, readback27]);
  assert.notEqual(result.status, 0);
  assert.equal(jsonLine(result.stdout).code, 'EEXTERNALREADBACK');
});

test('external write commits after every target has a fresh independent PASS', (t) => {
  const home = freshHome(t);
  init(home);
  startExternal(home, ['feishu:sheet:I27', 'feishu:sheet:I30']);
  const refs = [
    addAttempt(home, 'feishu:sheet:I27'),
    addAttempt(home, 'feishu:sheet:I30'),
    addReadback(home, 'feishu:sheet:I27'),
    addReadback(home, 'feishu:sheet:I30'),
  ];
  const result = commit(home, refs);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(taskSnapshot(home).open_step, null);
});

test('recover reconcile cannot bypass the external readback gate', (t) => {
  const home = freshHome(t);
  init(home);
  startExternal(home);
  const attempt = addAttempt(home, 'feishu:sheet:I27');
  const result = run(home, [
    'recover', '--reconcile', 'write-results', '--evidence', attempt,
  ]);
  assert.notEqual(result.status, 0);
  assert.equal(jsonLine(result.stdout).code, 'EEXTERNALREADBACK');
  assert.equal(taskSnapshot(home).open_step.step_id, 'write-results');
});
