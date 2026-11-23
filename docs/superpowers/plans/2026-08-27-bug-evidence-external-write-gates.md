# Bug Evidence and External Write Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the proven Bug workflow into `agent-dev-scaffold`, make reports freshness-aware, and prevent external-write steps from committing without independent persistent readback.

**Architecture:** Keep the existing task-memory state machine as the base. Add a generic external-effect gate that validates structured evidence before `commit-step` or recovery reconciliation, then add an optional Bugfix Extension that preserves source status separately from verification status and emits a content-addressed report manifest. Upgrade the installed Hotel Agent harness only after the source template is green and pushed.

**Tech Stack:** Node.js built-ins, JSON Schema draft-07 subset, JSON/JSONL runtime state, `node:test`, self-contained HTML.

**Spec:** `docs/superpowers/specs/2026-08-27-bug-evidence-external-write-gates-design.md`

## Global Constraints

- Preserve the existing dirty baseline in `<scaffold-root>`; do not reset, stash, or overwrite its 7-stage/worklist/viewer/board-hook work.
- Keep the source template dependency-free outside Node.js built-ins.
- Runtime tasks, journal, decisions, evidence, checkpoints, reports, and active pointers remain uncommitted project-local state.
- `status`/`source_status` describe the source system; `verification_status` describes this run and never overwrites source truth.
- External-write completion requires a fresh independent readback for every declared target; DOM visibility, HTTP 200, same-page formula-bar text, and an attempted write are insufficient.
- Do not claim or implement reliable Feishu Canvas automation inside the harness.
- When upgrading `<target-project>/.agent`, preserve `PROJECT.md`, `process.json`, `bugs.json`, and every runtime directory.
- In the Hotel Agent project, finish all harness sync edits before running only the affected harness/report tests.

---

## File Map

### Source template: existing baseline

- `README.md`: top-level feature and test-count documentation.
- `dot-agent/README.md`: installed CLI and workflow contract.
- `dot-agent/PORTING.md`: target-project protocol and copy boundaries.
- `dot-agent/INSTALL-PROMPT.md`: new-install instructions.
- `dot-agent/UPGRADE-PROMPT.md`: non-destructive upgrade instructions.
- `dot-agent/process/process.template.json`: default 7-stage product workflow.
- `dot-agent/scripts/agent.mjs`: CLI dispatcher and state transitions.
- `dot-agent/scripts/lib/{process,board,stats,hook}.mjs`: current dirty worklist/viewer/board-hook baseline.
- `dot-agent/scripts/process.test.mjs`: current dirty baseline tests.

### External Effect Gate

- Modify: `dot-agent/schemas/task.schema.json`
- Modify: `dot-agent/scripts/lib/journal.mjs`
- Create: `dot-agent/scripts/lib/effects.mjs`
- Modify: `dot-agent/scripts/agent.mjs`
- Create: `dot-agent/scripts/external-effects.test.mjs`

### Bugfix Extension

- Create: `dot-agent/schemas/bug.schema.json`
- Create: `dot-agent/scripts/lib/bugimport.mjs`
- Create: `dot-agent/scripts/lib/repomap.mjs`
- Create: `dot-agent/scripts/lib/report.mjs`
- Create: `dot-agent/scripts/bugfix.test.mjs`
- Create: `dot-agent/process/bugfix.template.json`
- Modify: `dot-agent/schemas/process.schema.json`
- Modify: `dot-agent/scripts/agent.mjs`

### Installed Hotel Agent harness

- Sync source files into: `<target-project>/.agent/scripts/`, `/schemas/`, and `/process/`
- Preserve: `<target-project>/.agent/{PROJECT.md,process.json,bugs.json,tasks,journal,decisions,evidence,checkpoints,ACTIVE_TASK.json,process-state.json}`
- Regenerate: `<target-project>/.agent/reports/index.html`
- Create: `<target-project>/.agent/reports/manifest.json`

---

### Task 1: Verify and Commit the Existing Dirty Baseline

**Files:**
- Review and commit the already-modified source files listed under “Source template: existing baseline”.
- Include existing new files: `dot-agent/scripts/build_viewer.mjs`, `dot-agent/scripts/lib/hook.mjs`, `gen-mock.mjs`, and `mock-board/`.

**Interfaces:**
- Consumes: repository state at design commit `5f795ed` plus the authorized uncommitted baseline.
- Produces: a clean committed baseline containing the 7-stage workflow, worklist, viewer, expanded board, and post-commit hook.

- [ ] **Step 1: Inspect the baseline for accidental or generated-only files**

Run:

```bash
git status --short
git diff --check
git diff --stat
find mock-board -maxdepth 3 -type f -print | sort
```

Expected: no conflict markers or whitespace errors; `mock-board/` contains only intentional demo artifacts. Remove `.DS_Store` from the commit scope without deleting unrelated user work.

- [ ] **Step 2: Run the current baseline tests**

Run:

```bash
node --test dot-agent/scripts/agent.test.mjs dot-agent/scripts/process.test.mjs
```

Expected: 29 tests pass, 0 fail.

- [ ] **Step 3: Smoke-build the viewer and board demo**

Run:

```bash
node gen-mock.mjs
viewer_tmp=$(mktemp -d)
mkdir -p "$viewer_tmp/.agent/scripts" "$viewer_tmp/docs/architecture"
cp dot-agent/scripts/build_viewer.mjs "$viewer_tmp/.agent/scripts/build_viewer.mjs"
printf '%s\n' '{"systems":["demo"]}' > "$viewer_tmp/docs/architecture/demo_arch.json"
node "$viewer_tmp/.agent/scripts/build_viewer.mjs"
test -s "$viewer_tmp/docs/viewer.html"
```

Expected: both commands exit 0 and regenerate only the documented mock artifacts.

- [ ] **Step 4: Commit the authorized baseline**

```bash
git add README.md dot-agent gen-mock.mjs mock-board
git diff --cached --check
git commit -m "feat: expand development workflow and progress board"
```

Expected: the design commit remains separate; working tree is clean before Task 2.

---

### Task 2: Add Structured Evidence and the External-Write Commit Gate

**Files:**
- Modify: `dot-agent/schemas/task.schema.json:75`
- Modify: `dot-agent/scripts/lib/journal.mjs:51`
- Create: `dot-agent/scripts/lib/effects.mjs`
- Modify: `dot-agent/scripts/agent.mjs:194-275`
- Modify: `dot-agent/scripts/agent.mjs:314-330`
- Modify: `gen-mock.mjs`
- Create: `dot-agent/scripts/external-effects.test.mjs`

**Interfaces:**
- Consumes: `paths.evidenceDir(taskId)`, `open_step`, and evidence refs passed to commit/recovery.
- Produces:
  - `parseTargets(value: string|string[]): string[]`
  - `loadEvidenceRecord(taskId: string, ref: string): object`
  - `assertExternalWriteEvidence({ taskId, step, evidenceRefs }): void`
  - `open_step.effect: "none"|"external-write"`
  - `open_step.targets: string[]`

- [ ] **Step 1: Write the CLI-level failing tests**

Create `dot-agent/scripts/external-effects.test.mjs` with a real CLI helper:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = join(dirname(fileURLToPath(import.meta.url)), 'agent.mjs');

function freshHome() {
  return join(mkdtempSync(join(tmpdir(), 'external-effect-test-')), '.agent');
}

function run(home, args) {
  return spawnSync(process.execPath, [cli, ...args, '--json'], {
    env: { ...process.env, AGENT_HOME: home },
    encoding: 'utf8',
  });
}

function jsonLine(output) {
  return JSON.parse(output.trim().split('\n').at(-1));
}
```

Add seven tests with literal expectations:

1. ordinary `effect=none` steps still commit;
2. external-write with only attempt evidence exits nonzero `EEXTERNALREADBACK`;
3. readback `result=FAIL` is rejected;
4. wrong task/step/target/timestamp/fingerprint cases are rejected in one table-driven test;
5. two declared targets require two PASS readbacks;
6. complete PASS evidence allows commit;
7. `recover --reconcile` applies the same gate.

The successful evidence payload must be created through the public CLI:

```js
const attempt = jsonLine(run(home, [
  'evidence', 'add', '--kind', 'external-write-attempt',
  '--target', 'feishu:sheet:I27',
  '--data', JSON.stringify({ operation: 'set-cell', expected_fingerprint: 'sha256:abc', result: 'attempted' }),
]).stdout).evidence_id;

const readback = jsonLine(run(home, [
  'evidence', 'add', '--kind', 'external-readback',
  '--target', 'feishu:sheet:I27',
  '--data', JSON.stringify({
    result: 'PASS', independent_context: true, readback_mode: 'fresh-tab',
    expected_fingerprint: 'sha256:abc', observed_fingerprint: 'sha256:abc',
  }),
]).stdout).evidence_id;
```

- [ ] **Step 2: Run the new tests and confirm RED**

Run:

```bash
node --test dot-agent/scripts/external-effects.test.mjs
```

Expected: failures show that `--effect`, structured evidence metadata, and `EEXTERNALREADBACK` do not exist yet.

- [ ] **Step 3: Extend the task schema and interrupted-step reconstruction**

Add to `open_step.properties` in `task.schema.json`:

```json
"effect": { "type": "string", "enum": ["none", "external-write"] },
"targets": {
  "type": "array",
  "maxItems": 20,
  "items": { "type": "string", "minLength": 1, "maxLength": 300 }
}
```

Require `effect` and `targets` for new snapshots while keeping `loadTask` backward compatible by normalizing missing fields in memory to `none` and `[]` before validation. Extend `findInterruptedSteps()` to retain `effect` and `targets` from `step_started.payload`.

- [ ] **Step 4: Implement `effects.mjs`**

Use only built-ins and exact evidence-file lookup:

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths, readJson } from './store.mjs';

export function parseTargets(value) {
  const values = value === undefined ? [] : [].concat(value);
  return [...new Set(values.flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean))];
}

export function loadEvidenceRecord(taskId, ref) {
  const file = join(paths.evidenceDir(taskId), `${String(ref).replace(':', '_')}.json`);
  if (!existsSync(file)) throw Object.assign(new Error(`证据不存在：${ref}`), { code: 'EEVIDENCE' });
  return readJson(file);
}

export function assertExternalWriteEvidence({ taskId, step, evidenceRefs }) {
  if ((step.effect || 'none') !== 'external-write') return;
  const records = evidenceRefs.map((ref) => loadEvidenceRecord(taskId, ref));
  const attempts = records.filter((r) => r.kind === 'external-write-attempt');
  if (!attempts.length) throw Object.assign(new Error('external-write 缺写入尝试证据'), { code: 'EEXTERNALREADBACK' });
  for (const target of step.targets || []) {
    const attempt = attempts.find((r) => r.target === target);
    const expected = attempt?.data?.expected_fingerprint;
    const pass = records.find((r) => r.kind === 'external-readback'
      && r.target === target
      && r.task_id === taskId
      && r.step_id === step.step_id
      && Date.parse(r.created_at) >= Date.parse(step.started_at)
      && r.data?.result === 'PASS'
      && r.data?.independent_context === true
      && r.data?.expected_fingerprint === expected
      && r.data?.observed_fingerprint === expected);
    if (!attempt || !expected || !pass)
      throw Object.assign(new Error(`外部目标缺独立持久化回读：${target}`), { code: 'EEXTERNALREADBACK' });
  }
}
```

- [ ] **Step 5: Integrate structured evidence and the gate into the CLI**

In `start-step`, set:

```js
const effect = flags.effect ? String(flags.effect) : 'none';
const targets = parseTargets(flags.target);
if (effect === 'external-write' && !targets.length)
  throw Object.assign(new Error('external-write 必须声明 --target'), { code: 'EINPUT' });
```

Write `effect`/`targets` into both `open_step` and `step_started.payload`.

Update the explicit `open_step` fixture in `gen-mock.mjs` to include `effect: 'none'` and `targets: []`; otherwise the stricter schema would break the board demo.

In `evidence add`, parse JSON data when valid and bind the current step:

```js
let data = flags.data ? String(flags.data) : '';
try { data = data ? JSON.parse(data) : {}; } catch { /* legacy text evidence */ }
const step = loadTask(id).open_step;
const record = redact({
  id: evId, kind, task_id: id, step_id: step?.step_id || null,
  target: flags.target ? String(flags.target) : '', data,
  created_at: nowIso(), at: nowIso(),
});
```

Call `assertExternalWriteEvidence()` before mutating task state in both `commit-step` and `recover --reconcile`.

- [ ] **Step 6: Run the external-effect tests and existing task-memory tests**

Run:

```bash
node --test dot-agent/scripts/external-effects.test.mjs dot-agent/scripts/agent.test.mjs
```

Expected: 20 tests pass, 0 fail.

- [ ] **Step 7: Commit the gate**

```bash
git add dot-agent/schemas/task.schema.json dot-agent/scripts/lib/journal.mjs dot-agent/scripts/lib/effects.mjs dot-agent/scripts/agent.mjs dot-agent/scripts/external-effects.test.mjs gen-mock.mjs
git diff --cached --check
git commit -m "feat: require independent external write readback"
```

---

### Task 3: Add the Dual-Status Bug Ledger and Non-Destructive Sync

**Files:**
- Create: `dot-agent/schemas/bug.schema.json`
- Create: `dot-agent/scripts/lib/bugimport.mjs`
- Create: `dot-agent/scripts/lib/repomap.mjs`
- Create: `dot-agent/scripts/bugfix.test.mjs`

**Interfaces:**
- Consumes: CSV/JSON/XLSX/DOCX source snapshots and an optional existing ledger.
- Produces:
- `importBugs(filePath, { sourceId }): { bugs, warnings }`
  - `mergeBugLedger(existing, incoming, { scopeStatuses }): Bug[]`
  - `buildRepoMap(root): { markdown, stats }`

- [ ] **Step 1: Write failing ledger tests**

In `bugfix.test.mjs`, create real temporary CSV and JSON fixtures. Assert:

```js
const merged = mergeBugLedger(existing, incoming, { scopeStatuses: ['待修复', '待开发'] });
assert.equal(merged.find((b) => b.id === 'BUG-001').source_status, '已验收');
assert.equal(merged.find((b) => b.id === 'BUG-001').verification_status, '已验证');
assert.deepEqual(merged.find((b) => b.id === 'BUG-001').evidence_refs, ['ev:old']);
assert.equal(merged.find((b) => b.id === 'BUG-001').in_scope, false);
assert.equal(merged.find((b) => b.id === 'BUG-002').in_scope, true);
assert.equal(merged.find((b) => b.id === 'BUG-OLD').source_presence, 'missing');
```

Also assert that accepted/closed rows are imported rather than discarded.

- [ ] **Step 2: Run the ledger tests and confirm RED**

Run:

```bash
node --test dot-agent/scripts/bugfix.test.mjs
```

Expected: module-not-found or missing exported functions.

- [ ] **Step 3: Define the Bug schema**

Use `additionalProperties: true` for source-specific columns and explicitly define the dual-status fields from the design. Require `id` and `title`; constrain `evidence_refs` to `^ev:[A-Za-z0-9_-]+$`.

- [ ] **Step 4: Port and correct `bugimport.mjs`**

Start from the Hotel Agent parser, remove the branch that drops accepted/closed rows, and normalize each row. For table formats, set `source_row` to the original one-based spreadsheet row and derive `source_key` from `sourceId`; the CLI passes `--source` when supplied and otherwise uses the absolute import path.

```js
export function sourceKey(bug) {
  if (bug.source_key) return bug.source_key;
  if (bug.source_url && bug.source_row != null) return `${bug.source_url}#row-${bug.source_row}`;
  return bug.id;
}

export function mergeBugLedger(existing, incoming, { scopeStatuses = ['待修复', '待开发'] } = {}) {
  const oldByKey = new Map(existing.map((b) => [sourceKey(b), b]));
  const seen = new Set();
  const merged = incoming.map((raw) => {
    const key = sourceKey(raw);
    seen.add(key);
    const old = oldByKey.get(key) || {};
    const sourceStatus = raw.source_status || raw.status || '';
    return {
      ...old, ...raw, source_key: key, status: sourceStatus,
      source_status: sourceStatus, source_presence: 'present',
      in_scope: scopeStatuses.includes(sourceStatus),
      verification_status: old.verification_status || raw.verification_status || '待验证',
      verification_scope: old.verification_scope || raw.verification_scope || '',
      verification_note: old.verification_note || raw.verification_note || '',
      verified_at: old.verified_at || raw.verified_at || '',
      evidence_refs: old.evidence_refs || raw.evidence_refs || [],
    };
  });
  for (const old of existing)
    if (!seen.has(sourceKey(old))) merged.push({ ...old, source_presence: 'missing', in_scope: false });
  return merged;
}
```

- [ ] **Step 5: Port `repomap.mjs` unchanged except generic wording**

Retain deterministic static scanning and zero dependencies. Replace project-specific comments with framework-neutral wording; do not expand scan depth or file types in this task.

- [ ] **Step 6: Run the ledger tests**

Run:

```bash
node --test dot-agent/scripts/bugfix.test.mjs
```

Expected: the first two Bugfix tests pass.

- [ ] **Step 7: Commit the ledger**

```bash
git add dot-agent/schemas/bug.schema.json dot-agent/scripts/lib/bugimport.mjs dot-agent/scripts/lib/repomap.mjs dot-agent/scripts/bugfix.test.mjs
git diff --cached --check
git commit -m "feat: add non-destructive bug ledger sync"
```

---

### Task 4: Add Evidence-Aware Reporting and Freshness Checks

**Files:**
- Create: `dot-agent/scripts/lib/report.mjs`
- Modify: `dot-agent/scripts/bugfix.test.mjs`

**Interfaces:**
- Consumes: `bugs.json`, Bug-local docs/evidence, and referenced harness evidence JSON.
- Produces:
  - `buildBugReportBundle(agentRoot): { html, manifest }`
  - `writeBugReport(agentRoot, outputPath): { outputPath, manifestPath }`
  - `checkBugReport(agentRoot, outputPath): { fresh, reasons }`

- [ ] **Step 1: Add four failing report tests**

Use a real temporary `.agent` tree. Cover:

1. dual source/verification tags plus Markdown and harness JSON;
2. missing evidence ref renders a warning;
3. fresh manifest passes, then ledger mutation returns `ESTALE_REPORT`;
4. evidence mutation and output mutation each return `ESTALE_REPORT`.

Use literal assertions:

```js
assert.match(bundle.html, /本轮：已验证/);
assert.match(bundle.html, /源状态：待修复/);
assert.match(bundle.html, /ev:probe123/);
assert.equal(checkBugReport(root, output).fresh, true);
writeFileSync(join(root, 'bugs.json'), changedLedger);
assert.deepEqual(checkBugReport(root, output), {
  fresh: false,
  reasons: ['input changed: bugs.json'],
});
```

- [ ] **Step 2: Run the report tests and confirm RED**

Run:

```bash
node --test dot-agent/scripts/bugfix.test.mjs
```

Expected: the four new report tests fail because bundle/manifest/check do not exist.

- [ ] **Step 3: Implement stable input collection and hashing**

Use `createHash('sha256')`, sorted relative paths, and file contents:

```js
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function inputRecord(agentRoot, absolutePath) {
  return {
    path: relative(agentRoot, absolutePath),
    sha256: sha256(readFileSync(absolutePath)),
  };
}
```

Collect `bugs.json`, every rendered Bug-stage/evidence file, and every resolved `evidence_refs` file. Sort by `path` or `ref` before serializing. Record unresolved refs as `{ ref, missing: true }`.

- [ ] **Step 4: Build the dual-status HTML and manifest**

Port the Hotel Agent report renderer, retaining text escaping and responsive HTML. Return:

```js
return {
  html,
  manifest: {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    inputs,
    output_sha256: sha256(Buffer.from(html)),
  },
};
```

`writeBugReport()` must use atomic file writes for both HTML and `manifest.json`.
The HTML must not embed `generated_at` or another volatile value; only the manifest carries generation time so an unchanged report has a stable output hash.

- [ ] **Step 5: Implement freshness checking**

`checkBugReport()` must read the saved manifest, recalculate the current bundle without trusting `generated_at`, compare sorted input records and output hash, and return deterministic reasons. Missing refs always make `fresh=false`.

- [ ] **Step 6: Run all Bugfix tests**

Run:

```bash
node --test dot-agent/scripts/bugfix.test.mjs
```

Expected: 6 Bugfix tests pass, 0 fail.

- [ ] **Step 7: Commit reporting**

```bash
git add dot-agent/scripts/lib/report.mjs dot-agent/scripts/bugfix.test.mjs
git diff --cached --check
git commit -m "feat: make bug reports evidence-aware and freshness-checked"
```

---

### Task 5: Integrate Bugfix Commands, Workflow Template, and Upgrade Docs

**Files:**
- Modify: `dot-agent/scripts/agent.mjs:1-28,365-375,707-735`
- Create: `dot-agent/process/bugfix.template.json`
- Modify: `dot-agent/schemas/process.schema.json`
- Modify: `README.md`
- Modify: `dot-agent/README.md`
- Modify: `dot-agent/PORTING.md`
- Modify: `dot-agent/INSTALL-PROMPT.md`
- Modify: `dot-agent/UPGRADE-PROMPT.md`
- Modify: `dot-agent/scripts/bugfix.test.mjs`

**Interfaces:**
- Consumes: ledger/import/report modules from Tasks 3-4.
- Produces CLI commands `repo-map`, `bug import`, `bug sync`, `bug list`, `report`, and `report check`.

- [ ] **Step 1: Add failing CLI integration tests**

Use the same real CLI helper pattern as Task 2. Assert:

```js
const imported = run(home, ['bug', 'import', '--file', csvFile, '--status', '待修复,待开发']);
assert.equal(imported.status, 0);
assert.equal(JSON.parse(readFileSync(join(home, 'bugs.json'), 'utf8')).length, 3);

assert.equal(run(home, ['report']).status, 0);
assert.equal(run(home, ['report', 'check']).status, 0);
writeFileSync(join(home, 'bugs.json'), changedLedger);
const stale = run(home, ['report', 'check']);
assert.notEqual(stale.status, 0);
assert.equal(jsonLine(stale.stdout).code, 'ESTALE_REPORT');
```

Also assert that a bugfix report-phase task cannot complete while `report check` is stale.

- [ ] **Step 2: Run CLI Bugfix tests and confirm RED**

Run:

```bash
node --test dot-agent/scripts/bugfix.test.mjs
```

Expected: missing command failures.

- [ ] **Step 3: Add CLI commands without duplicating storage logic**

Import the three modules in `agent.mjs`. `bug import` and `bug sync` must both merge with an existing ledger; `bug list` prints source and verification status. `report` calls `writeBugReport()`. `report check` throws `ESTALE_REPORT` with joined reasons when `fresh=false`.

- [ ] **Step 4: Enforce report freshness at Bugfix report-phase completion**

Add optional `workflow` to `process.schema.json` with enum `default|bugfix`. Before `commands.complete` mutates task state:

```js
if (processExists()) {
  const p = loadProcess();
  const st = loadState(p);
  const phaseId = Object.entries(st.phase_tasks || {}).find(([, taskId]) => taskId === id)?.[0];
  const legacyBugfix = existsSync(join(paths.root(), 'bugs.json'))
    && (p.phases || []).some((phase) => phase.id === 'report');
  if ((p.workflow === 'bugfix' || legacyBugfix) && phaseId === 'report') {
    const freshness = checkBugReport(paths.root(), join(paths.root(), 'reports', 'index.html'));
    if (!freshness.fresh)
      throw Object.assign(new Error(`Bug 报告已过期：${freshness.reasons.join('；')}`), { code: 'ESTALE_REPORT' });
  }
}
```

- [ ] **Step 5: Create `bugfix.template.json`**

Port the Hotel Agent eight-stage Bug workflow, but use `.agent/inbox/bugs.csv` as the default source path and framework-neutral skills. The report phase must explicitly require:

```json
"gates": [
  "报告必须运行 `node .agent/scripts/agent.mjs report check` 并返回 REPORT_FRESH",
  "外部写入类验收必须引用 independent external-readback PASS；DOM 可见不算持久化成功"
]
```

- [ ] **Step 6: Update installation and upgrade documentation**

Document:

- the optional Bugfix Extension and how to copy `bugfix.template.json` to `process.json`;
- dual source/verification statuses;
- `start-step --effect external-write --target "feishu:sheet:I27"`;
- structured attempt/readback evidence;
- `report check` and stale-report behavior;
- runtime files that upgrades must preserve;
- the final observed test count after Task 6.

- [ ] **Step 7: Run Bugfix CLI tests**

Run:

```bash
node --test dot-agent/scripts/bugfix.test.mjs
```

Expected: 6 Bugfix tests pass, 0 fail.

- [ ] **Step 8: Commit integration and docs**

```bash
git add README.md dot-agent/README.md dot-agent/PORTING.md dot-agent/INSTALL-PROMPT.md dot-agent/UPGRADE-PROMPT.md dot-agent/process/bugfix.template.json dot-agent/schemas/process.schema.json dot-agent/scripts/agent.mjs dot-agent/scripts/bugfix.test.mjs
git diff --cached --check
git commit -m "feat: ship the optional bugfix workflow"
```

---

### Task 6: Verify and Push the Source Template

**Files:**
- Verify all committed source-template files.
- Modify documentation test counts only if the actual final count differs from 42.

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: a green, pushed `origin/main` source template.

- [ ] **Step 1: Run the complete source-template suite**

Run:

```bash
node --test dot-agent/scripts/*.test.mjs
```

Expected: 42 tests pass, 0 fail. If the count differs because a named case was split, record the actual count consistently in all documentation before continuing.

- [ ] **Step 2: Exercise a clean temporary installation**

Run:

```bash
scaffold_tmp=$(mktemp -d)
cp -R dot-agent "$scaffold_tmp/.agent"
cd "$scaffold_tmp"
node .agent/scripts/agent.mjs install
node --test .agent/scripts/*.test.mjs
node .agent/scripts/agent.mjs validate
```

Expected: install is non-destructive, the same full suite passes, and `validate` exits 0.

- [ ] **Step 3: Run failure drills**

In the temporary installation:

1. create an external-write step with only attempt evidence and confirm `commit-step` exits `EEXTERNALREADBACK`;
2. add mismatched readback and confirm the same rejection;
3. add correct independent PASS and confirm commit succeeds;
4. generate a Bug report, mutate one referenced evidence file, and confirm `report check` exits `ESTALE_REPORT`.

- [ ] **Step 4: Inspect final Git scope**

Run:

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -8
```

Expected: no uncommitted source changes and the commit series is design, baseline, external gate, ledger, report, integration/docs.

- [ ] **Step 5: Push and verify remote main**

```bash
git push origin main
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: local and `origin/main` hashes match exactly.

---

### Task 7: Upgrade the Hotel Agent Harness Without Touching Runtime State

**Files:**
- Update committed template files under `<target-project>/.agent/scripts`, `/schemas`, and `/process`.
- Preserve project-specific and runtime paths listed in Global Constraints.
- Regenerate `<target-project>/.agent/reports/index.html` and `manifest.json`.

**Interfaces:**
- Consumes: pushed source template and the Hotel Agent dual-status ledger/evidence.
- Produces: an installed harness that can read existing tasks and enforce the new gates for future external writes.

- [ ] **Step 1: Snapshot protected Hotel Agent runtime identities**

Run from `<target-project>`:

```bash
node .agent/scripts/agent.mjs status --json
node .agent/scripts/agent.mjs doctor --json
shasum -a 256 .agent/PROJECT.md .agent/process.json .agent/bugs.json .agent/ACTIVE_TASK.json
find .agent/tasks .agent/journal .agent/evidence .agent/checkpoints -type f | wc -l
```

Save the hashes and file count in a harness evidence record before copying template files.

- [ ] **Step 2: Sync only template-owned files**

Copy exact source-template files without `--delete`:

```bash
cp -R <scaffold-root>/dot-agent/scripts <target-project>/.agent/
cp -R <scaffold-root>/dot-agent/schemas <target-project>/.agent/
cp -R <scaffold-root>/dot-agent/process <target-project>/.agent/
cp <scaffold-root>/dot-agent/README.md <target-project>/.agent/README.md
cp <scaffold-root>/dot-agent/PORTING.md <target-project>/.agent/PORTING.md
cp <scaffold-root>/dot-agent/UPGRADE-PROMPT.md <target-project>/.agent/UPGRADE-PROMPT.md
```

Do not copy `PROJECT.md.template` over `PROJECT.md`; do not copy a process template over `process.json`.

- [ ] **Step 3: Confirm protected runtime files are byte-identical**

Repeat the hashes and file count from Step 1. Expected: every protected hash and count is unchanged.

- [ ] **Step 4: Run only affected Hotel Agent harness tests after all sync edits**

Run:

```bash
node --test .agent/scripts/agent.test.mjs .agent/scripts/process.test.mjs .agent/scripts/external-effects.test.mjs .agent/scripts/bugfix.test.mjs .agent/scripts/report.test.mjs
node .agent/scripts/agent.mjs validate
node .agent/scripts/agent.mjs resume
```

Expected: all harness/report tests pass, validation exits 0, and resume restores `production-three-bug-remediation-20260826` with its final Feishu-I DoD still unmet.

- [ ] **Step 5: Regenerate and verify the Hotel Agent report**

Run:

```bash
node .agent/scripts/agent.mjs report --out .agent/reports/index.html
node .agent/scripts/agent.mjs report check --out .agent/reports/index.html
```

Expected: `REPORT_FRESH`, dual statuses remain intact, every referenced harness evidence resolves, row 34 remains partial, and row 35 remains pending real-device acceptance.

- [ ] **Step 6: Record the upgrade and leave external-write DoD honest**

Add harness evidence containing source commit, protected hashes, test output, and `REPORT_FRESH`. Do not mark the Feishu I-column DoD met; the previous independent readback proved the cells remained blank.

- [ ] **Step 7: Final cross-repository review**

Run:

```bash
git -C <scaffold-root> status --short --branch
git -C <scaffold-root> rev-parse HEAD
git --git-dir=<target-project>/.git worktree list --porcelain
node <target-project>/.agent/scripts/agent.mjs board
```

Expected: source scaffold is clean and pushed; Hotel Agent runtime is preserved; the board reflects completed probe/report work and the still-blocked external Feishu write.
