# Harness Evolver Implementation Plan

> **For agentic workers:** Execute inline in this session. Tests are authored before integration but, per the target project `AGENTS.md`, are run only after all implementation work is complete.

**Goal:** Ship an installable outer-loop evolution module that turns real project feedback into deduplicated, stage-specific guidance automatically injected by the scaffold.

**Architecture:** Keep analysis and knowledge state in a zero-dependency Python package, and keep the existing Node CLI integration to a small optional bridge. Bundle the inspection retrospective as the first historical seed and preserve it across new project installs.

**Tech Stack:** Python 3 standard library, Node.js ESM standard library, Markdown/JSON state.

**Spec:** `docs/superpowers/specs/2026-08-28-harness-evolver-design.md`

## Global Constraints

- Preserve all existing task-memory, external-write, and bugfix behavior.
- Never overwrite installed project runtime data during upgrade.
- Keep LLM use optional and provide an offline deterministic fallback.
- Finish implementation before running affected tests.

### Task 1: Package The Evolution Engine

**Files:** Create `harness_evolver/` code, tests, configuration, knowledge base, state, reports, and bundled history.

**Interfaces:** Produce `python -m harness_evolver.evolve` and `python -m harness_evolver.context_injector` JSON/text CLIs.

- [x] Copy the already developed analyzer, models, mapper, pipeline, injector, and tests from the inspection delivery project.
- [x] Replace project-local generated data with a canonical history snapshot and regenerate canonical state.
- [x] Extend phase mapping for both the default lifecycle and bugfix workflow.

### Task 2: Integrate Dynamic Context Into Dot-Agent

**Files:** Create `dot-agent/scripts/lib/evolver.mjs`, create `dot-agent/scripts/evolver.test.mjs`, modify `agent.mjs`, `lib/context.mjs`, and `lib/process.mjs`.

**Interfaces:** `buildEvolutionContext(options): string`; `computeNext()` exposes `worklist_task` when relevant.

- [x] Add a timeout-bounded Python subprocess bridge.
- [x] Inject stage guidance in `next`, `context`, `resume`, and `phase start` without removing existing behavior.
- [x] Preserve JSON output fields and add `evolution_context` and `worklist_task` additively.

### Task 3: Make Installation And Upgrade Complete

**Files:** Modify root and `dot-agent` README, install prompt, upgrade prompt, porting guide, and process guide.

**Interfaces:** A new install copies both `dot-agent` and `harness_evolver`; an upgrade preserves both `.agent` runtime state and `harness_evolver/state`.

- [x] Document environment variables and offline fallback.
- [x] Document feedback ingestion and the automatic phase injection path.
- [x] Update expected test counts after adding Evolver tests.

### Task 4: Verify The Closed Loop

**Files:** No production edits unless a verification failure exposes a defect.

**Interfaces:** Fresh install, incremental evolve, and injected context must work from a clean temporary project.

- [x] Run Python tests and all Node tests.
- [x] Evolve the bundled inspection history twice and verify the second run changes zero documents/rules.
- [x] Simulate installation into a temporary project and verify `install`, `next`, `resume`, and context injection.
- [x] Review `git diff` and ensure no product-specific secrets or absolute paths were persisted.
