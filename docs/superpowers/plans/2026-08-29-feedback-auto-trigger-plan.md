# Feedback Auto-Trigger Implementation Plan

> **For agentic workers:** Execute inline in this session. Write behavior tests before production code and keep existing external-write, Bugfix, task-memory, and process contracts intact.

**Goal:** Automatically capture concrete project problems into a committed retrospective ledger and run offline Harness Evolver when feedback closes or delivery/report completion is attempted.

**Architecture:** Add a focused Node feedback ledger that owns IDs, deduplication, status transitions, import, and Markdown rendering. Add a separate evolution gate that invokes the existing Python Evolver and stores a document fingerprint. Wire both into `agent.mjs` and the installed Agent protocol without making the CLI pretend it can observe conversations outside an active Agent session.

**Tech Stack:** Node.js ESM standard library, existing Python `harness_evolver`, JSONL/Markdown/JSON.

**Spec:** `docs/superpowers/specs/2026-08-29-feedback-auto-trigger-design.md`

## Global Constraints

- Default evolution mode is offline `--use-llm never`.
- Never overwrite an unimported existing retrospective document.
- Feedback facts under `docs/retrospective/` are committed project knowledge; only the lock is runtime state.
- Automatic capture records symptoms only; it never invents a root cause or archives a record.
- Delivery/report completion preserves all existing verification, external-write, and Bugfix report gates.

---

### Task 1: Feedback Ledger And Markdown Projection

**Files:**
- Create: `dot-agent/scripts/lib/feedback.mjs`
- Create: `dot-agent/scripts/feedback.test.mjs`
- Modify: `dot-agent/scripts/lib/store.mjs`

**Interfaces:**
- `classifyFeedbackSignal(text): { capture: boolean, explicit: boolean, keywords: string[], reason: string }`
- `loadFeedback(root): FeedbackRecord[]`
- `addFeedback({ root, source, title, symptom, phaseId, taskId, evidence }): { record, duplicate }`
- `updateFeedback({ root, id, rootCause, resolution, impact, status, evidence }): FeedbackRecord`
- `importFeedbackMarkdown({ root, file }): { imported, backupPath }`
- `renderFeedbackDocument({ root, records }): string`

- [x] Write tests proving U/E ID allocation, sensitive-value redaction, duplicate suppression, and keyword false-positive handling.
- [x] Run `node --test dot-agent/scripts/feedback.test.mjs` and confirm failure because `lib/feedback.mjs` is absent.
- [x] Implement locked atomic JSONL persistence, normalized fingerprints, status validation, and project-root path resolution.
- [x] Write tests for existing-Markdown import, legacy backup, generated markers, and refusal to overwrite an unimported document.
- [x] Implement Markdown table parsing and deterministic human-readable rendering.
- [x] Run the focused test and confirm all ledger tests pass.

### Task 2: Offline Evolution And Completion Gate

**Files:**
- Create: `dot-agent/scripts/lib/evolution-gate.mjs`
- Extend: `dot-agent/scripts/feedback.test.mjs`

**Interfaces:**
- `runFeedbackEvolution({ root, reason, force, spawn }): EvolutionResult`
- `assertFeedbackCompletionGate({ root, phaseId, spawn }): EvolutionResult`
- State: `docs/retrospective/evolution.json` with `document_sha256`, `report_path`, `evolved_at`, `reason`, `pending`, and rule deltas.

- [x] Write tests proving close/evolve invokes Python with `--use-llm never`, unchanged fingerprints skip, and same-second reports remain distinct.
- [x] Write tests proving open feedback blocks `delivery|report`, non-gated phases pass, and failed Evolver writes `pending=true` without losing feedback facts.
- [x] Run the focused tests and confirm expected failures because `lib/evolution-gate.mjs` is absent.
- [x] Implement subprocess invocation, JSON parsing, relative report persistence, document fingerprinting, pending-state recovery, and phase gate enforcement.
- [x] Run the focused tests and confirm all gate tests pass.

### Task 3: CLI And Automatic Agent Protocol

**Files:**
- Modify: `dot-agent/scripts/agent.mjs`
- Modify: `dot-agent/PORTING.md`
- Modify: `dot-agent/PROJECT.md.template`
- Modify: `dot-agent/README.md`
- Modify: `dot-agent/INSTALL-PROMPT.md`
- Modify: `dot-agent/UPGRADE-PROMPT.md`
- Modify: `README.md`
- Extend: `dot-agent/scripts/feedback.test.mjs`

**Interfaces:**
- CLI: `feedback detect|add|import|update|close|list|evolve`
- `complete`: calls `assertFeedbackCompletionGate()` before task status mutation for `delivery|report`.
- Agent protocol: concrete defect keywords trigger `feedback add`; `生成规则差异|执行evolve|复盘归档|项目复盘` trigger `feedback evolve`.

- [x] Write CLI tests for add/list/update/close/import/evolve JSON output and completion-gate error codes.
- [x] Run the CLI tests and confirm failure because the commands are absent.
- [x] Integrate command parsing, active phase/task metadata, close-time evolution, and additive machine-readable fields.
- [x] Add the automatic-capture protocol and explicit keyword table to install/porting docs, including the non-background-monitor boundary.
- [x] Run the focused CLI tests and confirm they pass.

### Task 4: Full Verification And Clean Install

**Files:**
- Update: `docs/superpowers/plans/2026-08-29-feedback-auto-trigger-plan.md`

**Interfaces:** Existing install layout plus new feedback commands and delivery gate.

- [x] Run all Node tests and all Python Evolver tests.
- [x] Run compile/diff/credential scans.
- [x] Install both units into a fresh temporary project.
- [x] Verify a detected user issue creates `U-001`, renders Chinese Markdown, closing it runs Evolver, a terminal duplicate reopens, and `delivery` completion blocks while another issue remains open.
- [x] Re-run evolution with no changes and verify it skips by fingerprint.
- [x] Request focused code review and resolve all Critical/Important findings.
