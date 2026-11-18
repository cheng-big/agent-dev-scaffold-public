# Harness Evolver Design

## Goal

Add an outer-loop evolution system to the scaffold so production feedback from delivered projects becomes reusable upstream guidance for later projects.

## Architecture

The source repository keeps two installable units:

- `dot-agent/`: task memory, process orchestration, evidence gates, and the CLI.
- `harness_evolver/`: feedback ingestion, root-cause mapping, stage knowledge, context retrieval, and evolution reports.

An installed project receives them as `.agent/` and `harness_evolver/`. The Python module owns evolution state and generated knowledge. The Node CLI calls it through `.agent/scripts/lib/evolver.mjs`; failure is visible as a warning but does not make the core harness unusable.

## Data Flow

1. `python -m harness_evolver.evolve --input-docs <path>` scans Markdown feedback documents.
2. `bug_analyzer.py` extracts stable bug records and maps each one to `REQUIREMENT`, `DATABASE`, `CODING`, or `TESTING`.
3. `pipeline_evolver.py` incrementally rebuilds deduplicated stage rules and writes a changelog.
4. `context_injector.py` selects bounded baseline rules and relevant cases for a phase, worklist task, target path, and technology stack.
5. `agent.mjs next|context|resume|phase start` injects that context into the next agent session.

## Root-Cause Mapping

- `REQUIREMENT`: missing flows, roles, states, permissions, content language, information priority, or cross-page behavior.
- `DATABASE`: model, key, index, constraint, audit field, versioning, and persistence defects.
- `CODING`: API/UI/runtime implementation, exception, idempotency, transaction, data-scope, and integration defects.
- `TESTING`: missing boundary, negative, dirty-data, cross-role, cross-device, and regression coverage.

An OpenAI-compatible LLM is explicit opt-in. The default is `never`; `auto|always` must be supplied on the command line. Deterministic heuristics remain the offline fallback, sensitive fields are redacted before persistence or transmission, and all persisted records include analyzer provenance.

## Knowledge And Growth Control

Each stage has one Markdown knowledge file with a stable baseline section and a generated managed section. Rules are grouped by normalized failure family, deduplicated by exact key and similarity, capped per stage, and rebuilt from state so repeated runs are idempotent. The first bundled history snapshot comes from the inspection project retrospective and serves as the initial cross-project seed.

## Safety And Compatibility

- No business source code is modified by evolution runs.
- Runtime state uses atomic writes and document hashes.
- Secrets are read only from environment variables and are never persisted.
- Context output is size bounded and contains source references.
- Existing `.agent` runtime files are preserved during upgrades.
- Missing Python, missing module, or analyzer failure cannot corrupt `dot-agent`; the CLI emits a concise warning and continues without injected context.

## Verification

After all implementation work is complete, run only affected checks: Python unit tests, Node harness tests, one clean-install simulation, one real feedback evolution, one repeat run proving zero incremental changes, and context output checks for both default and bugfix workflows.
