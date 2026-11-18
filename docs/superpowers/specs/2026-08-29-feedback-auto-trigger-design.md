# Feedback Auto-Trigger Design

## Goal

Automatically capture real project problems into a durable retrospective document, then automatically run Harness Evolver when feedback is closed or a delivery/report phase attempts completion.

## Trigger Model

The system has two distinct triggers:

1. **Capture trigger:** a user message or verified engineering result describes a concrete problem in the current project.
2. **Evolution trigger:** a captured problem has enough root-cause information to be archived, or the project reaches its delivery/report completion gate.

Capture must not run Evolver immediately. A symptom without a confirmed root cause would create low-quality upstream rules.

## Automatic Capture

### User Feedback

The Agent protocol treats the following as candidate signals: `问题`, `bug`, `报错`, `异常`, `失败`, `不对`, `不应该`, `打不开`, `不能`, `缺失`, `遗漏`, `不好用`, `需要修复`.

A signal is recorded only when the message asserts a concrete current-project defect or unmet expectation. Hypothetical discussion, quoted documentation, negation, generic questions about Bug handling, and issues outside the scoped project are not recorded automatically.

“Automatic” means the installed `AGENTS.md`/`CLAUDE.md` protocol requires the active coding Agent to classify each incoming user message and invoke the capture command before continuing. The CLI cannot observe conversations outside an active Agent session and does not claim to be a background chat monitor.

Before implementation work continues, the Agent invokes:

```bash
node .agent/scripts/agent.mjs feedback add \
  --source user \
  --title "<concise problem>" \
  --symptom "<source-backed description>"
```

### Engineering Feedback

A failing test, runtime error, deployment failure, data mismatch, or browser acceptance failure is recorded only after it is reproduced or supported by evidence:

```bash
node .agent/scripts/agent.mjs feedback add \
  --source engineering \
  --title "<failure>" \
  --symptom "<observed behavior>" \
  --evidence "<reference>"
```

User feedback receives `U-*`; engineering feedback receives `E-*`. A normalized fingerprint prevents duplicate open records for the same source/title/symptom. If the matching record is already `已归档|延后`, a new occurrence reopens that record as `待定位`, clears unconfirmed current root-cause fields, increments `reopened_count`, and retains the previous closure snapshot in `previous_closures`.

## Facts And Documents

The committed structured source of truth is `docs/retrospective/feedback.jsonl`. Every record contains:

- `id`, `source`, `title`, `symptom`
- `root_cause`, `resolution`, `impact`
- `status`: `待定位 | 处理中 | 已修复待验证 | 已验证待归档 | 已归档 | 延后`
- `phase_id`, `task_id`, `evidence[]`
- `created_at`, `updated_at`, `fingerprint`

After each mutation, the CLI atomically regenerates `docs/retrospective/项目复盘待办.md`. The Markdown is a human-readable projection, not a second editable truth source.

Existing projects that already maintain this Markdown run `feedback import --file docs/retrospective/项目复盘待办.md` once before switching to the structured ledger. The renderer preserves a clearly marked manually maintained notes section.

## Closing Feedback

Root cause and disposition must be explicit before archive:

```bash
node .agent/scripts/agent.mjs feedback close U-01 \
  --root-cause "<confirmed cause>" \
  --resolution "<implemented or accepted disposition>" \
  --status 已归档
```

`feedback close` automatically renders `docs/retrospective/已归档反馈.md` from records in `已归档|延后`, runs offline Evolver against that closed-only input, and writes the returned report path, document fingerprint, and rule delta into `docs/retrospective/evolution.json`. Open symptoms remain visible in the main retrospective but cannot generate rules before root cause and disposition are known. If Evolver fails, the feedback record remains updated while evolution state is marked `pending=true`; the failure is visible and the delivery gate remains closed.

## Delivery Completion Gate

Before `complete` mutates a phase task, the CLI identifies its phase. For phase IDs `delivery` and `report`:

1. Regenerate the retrospective Markdown.
2. Reject completion when any feedback remains `待定位`, `处理中`, `已修复待验证`, or `已验证待归档`.
3. Compare the retrospective fingerprint with the last successful evolution run.
4. If dirty, automatically run `python3 -m harness_evolver.evolve --input-docs docs/retrospective/已归档反馈.md` using the default offline mode.
5. Require a successful evolution result and a readable difference report before allowing the existing verification/DoD completion gates to proceed.

`延后` is allowed only with a non-empty resolution explaining the disposition. The gate never enables external LLM use automatically.
Terminal statuses can only be set through `feedback close`; `feedback update --status 已归档|延后` is rejected so callers cannot bypass automatic evolution.

## Explicit Keywords

The Agent protocol recognizes these user commands:

| Keyword | Action |
|---|---|
| `记入复盘` | Capture the current concrete issue immediately. |
| `生成规则差异` | Render the document and run project-local Evolver now. |
| `进化脚手架` | Run project-local Evolver and prepare the reusable-rule promotion summary. |
| `同步脚手架` | Promote reviewed reusable rules to the canonical scaffold; this remains an explicit global-write boundary. |

Explicit keywords override automatic classification but do not bypass required fields, redaction, locking, or promotion review.

## Interfaces

New Node commands:

```text
feedback add --source user|engineering --title .. --symptom .. [--evidence ..]*
feedback import --file <existing-retrospective.md>
feedback update <id> [--root-cause ..] [--resolution ..] [--impact ..] [--status ..]
feedback close <id> --root-cause .. --resolution .. [--status 已归档|延后]  # default: 已归档
feedback list [--status ..]
feedback evolve
```

New Node modules:

- `scripts/lib/feedback.mjs`: lock, IDs, fingerprinting, JSONL persistence, status transitions, Markdown rendering.
- `scripts/lib/evolution-gate.mjs`: invoke Evolver, track document/report fingerprints, enforce delivery/report gate.

Runtime/state paths:

- `docs/retrospective/feedback.jsonl` (committed source of truth)
- `docs/retrospective/已归档反馈.md` (closed-only Evolver input)
- `docs/retrospective/evolution.json` (committed last-successful evolution fingerprint/report)
- `.agent/retrospective/feedback.lock`
- `docs/retrospective/项目复盘待办.md`

## Safety

- Apply the same credential and phone redaction policy used by Harness Evolver before writing feedback.
- Use an exclusive lock and atomic replacement for the JSONL ledger, rendered Markdown, and evolution state.
- A stale lock may be replaced only when its owner PID is gone, and release only removes the caller's own lock token.
- Never infer root cause or mark feedback archived from keywords alone.
- Never send feedback to an external LLM from an automatic trigger.
- Accept an evolution report only when it is a readable, non-empty regular file inside the project root.
- Never promote project rules into the canonical scaffold without the explicit `同步脚手架` boundary.

## Verification

Affected tests must cover:

- user and engineering ID allocation;
- duplicate suppression;
- false-positive keyword examples in the Agent protocol;
- status transition and required root-cause/resolution fields;
- Markdown regeneration and manual-notes preservation;
- automatic Evolver invocation on close;
- delivery/report completion blocked by open feedback;
- delivery/report completion runs Evolver when dirty and skips it when unchanged;
- Evolver failure leaves `evolution_pending` and blocks completion;
- existing external-write, Bugfix, task-memory, and process tests remain green.
