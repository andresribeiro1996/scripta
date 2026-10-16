# Codex second review, verify gate and round log

2026-10-16

## Why

Opus writes every spec and plan, and Claude agents implement and review them. One vendor grades its own work at every step, so a blind spot shared by Claude models passes all of them. The user has a Codex subscription and wants it used for **independence, not savings**: a second vendor reviewing at the two points where a wrong call is most expensive — the plan before coding, and the branch before merge.

Two smaller problems ride along, both taken from the devpipe write-up (João, 2026-10-16):

- Each task's verify commands run up to three times: the implementer runs them, `spec-reviewer` may, `quality-reviewer` must. Their output lands in three contexts.
- Scope creep is caught only by `spec-reviewer` reading the diff, although every plan task already lists its files.

Jev is out of scope: its only devpipe role is light/heavy routing, which the main session already decides.

## What changes

### 1. `scripts/gate.mjs` — one verify run, a scope check

```
node scripts/gate.mjs [--plan <plan.md> --task <N>]
```

Run from the worktree root, before committing. It looks at uncommitted and untracked changes against `HEAD` (`git diff --name-only HEAD` plus `git ls-files --others --exclude-standard`).

**Checks.** Each changed file maps to the `AGENTS.md` that governs it: `backend/`, `frontend/`, `mobile/`, `packages/` → that directory's `AGENTS.md`; `scripts/` → the root `AGENTS.md`; a root `package.json` or `package-lock.json` → every package. Other paths (`docs/`, `.claude/`, `exporter/`, `viewer/`) add no checks. The gate runs each mapped file's Verify lines — any line starting `- Verify` and ending in a backticked command, which includes mobile's `- Verify Expo configuration: \`cd mobile && npx expo-doctor\`` — in file order, deduplicated across files, so `npm run build --workspace @scripta/shared` runs once and first. A Verify line whose command starts with `cd <dir> &&` runs in that directory.

The root `AGENTS.md` gets `- Verify: \`npm run test:scripts\``, so script changes are checked from the same source of truth as packages. `npm run check:agents` must still pass.

**Scope.** With `--plan` and `--task N`, the gate reads task N's `**Files:**` list from the plan (`### Task N` heading through the next `### Task`; every backticked path on a `- Create:`, `- Modify:` or `- Test:` line, with any `:lines` suffix dropped). Every changed file must be on the list. Without `--plan`, no scope check runs and the report says so.

**Output.** Round N is one more than the existing `gate-r*.md` files in `.superpowers/runs/<branch>/` (gitignored). The gate writes:

- `gate-rN.md`: the `HEAD` SHA, one line per command (`PASS`/`FAIL`, seconds), the last 40 lines of each failing command, the scope result (listing out-of-scope files), and a final line `RESULT: PASS` or `RESULT: FAIL`.
- `gate-rN-<k>.log`: each command's full output, for humans.

It exits 0 on pass, 1 on fail. A command that cannot be spawned counts as a failure. It never stops early: every command runs, so a report shows everything that is broken.

### 2. `scripts/codex-review.mjs` — the second vendor

```
node scripts/codex-review.mjs plan <spec.md> <plan.md>
node scripts/codex-review.mjs branch <spec.md> [plan.md]
```

The main session runs it with Bash `run_in_background`, so no Claude subagent is involved and a notification arrives when it exits.

It runs `codex exec -s read-only -C <worktree> --json --output-schema scripts/codex/findings.schema.json -o <tmp> -` with a prompt built from `scripts/codex/plan-review.md` or `scripts/codex/branch-review.md` plus the given file paths. Codex loads the repo's `AGENTS.md` files on its own. The model and effort come from the user's `~/.codex/config.toml`.

- **plan** mode: does the plan deliver every requirement of the spec; do its file paths, line numbers, function names and interfaces match the real code; are tasks ordered so each one builds and tests on its own; does it miss tests, `@scripta/shared` reuse, deploy steps (`*_DB_PATH`, Railway variables, migrations)?
- **branch** mode: `git diff origin/main...HEAD` judged against the spec first and then the plan — missing requirements, correctness and security bugs, swallowed errors, web/mobile divergence, deploy impact.

The schema is `{ verdict: "pass" | "fail", findings: [{ severity: "blocking" | "should-fix" | "follow-up", file, line, summary, scenario }] }`. Every finding needs a concrete scenario; the brief tells Codex to drop what it cannot make concrete.

The script renders that JSON into `.superpowers/runs/<branch>/codex-<mode>-rN.md`, findings grouped by severity, ending in `CODEX: PASS` or `CODEX: FAIL — <n> blocking`. As a backstop to the sandbox, it records `git status --porcelain` before and after, and fails if they differ.

A non-zero Codex exit, output that doesn't match the schema, or a changed working tree writes a report ending `CODEX: ERROR — <reason>` and exits 2. The main session then tells the user that the second review did not run; it never reads an error as a pass.

### 3. Round log

`gate.mjs` and `codex-review.mjs` each append one JSON line per run to `<main checkout>/.superpowers/rounds.jsonl`. The main checkout is `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`, so the log survives worktree cleanup.

```json
{"at":"2026-10-16T14:02:11Z","branch":"claude/x","kind":"gate|codex-plan|codex-branch","round":1,"model":"gpt-6.1-sol","exit":0,"seconds":412,"tokens":{"input":0,"cached":0,"output":0}}
```

Gate lines have `model` and `tokens` set to `null`. Codex tokens are summed from the usage events in its `--json` stream; the model comes from that stream if it reports one, otherwise `null`. Claude subagent tokens are not logged.

### 4. Agents, CLAUDE.md and the ship skill

- **`implementer.md`**: the "Verify before committing" paragraph becomes "run `node scripts/gate.mjs --plan <plan> --task <N>` (without the flags when there is no plan) and commit only on `RESULT: PASS`". The report gets a fixed shape, in this order: **Deviations and doubts** (where the plan didn't match the code, or what it had to interpret), files changed, the gate report path and result, the commit SHA.
- **`spec-reviewer.md`, `quality-reviewer.md`**: read the latest `gate-rN.md` instead of running the Verify commands. If its SHA isn't the reviewed commit's parent, or its result isn't `PASS`, report that as blocking. They read **Deviations and doubts** first.
- **`branch-reviewer.md`**: takes the spec and the plan, and judges the branch against the spec first, since a plan can be wrong in a way per-task reviews will never catch.
- **CLAUDE.md table**:
  - Explore briefs ask for a report under ~600 words where every claim cites `path:line`, with **open technical questions** kept separate from **decisions only the user can make**.
  - After a plan is written, before the fresh-session handoff: run `codex-review plan` in the background, fix the plan from its findings, then commit.
  - Before merge: run `branch-reviewer` and `codex-review branch` in parallel. A finding raised by both is presumed real; a finding from only one is checked in the code before anyone acts on it.
  - Review loop cap: at most 3 implement → review rounds per task. After that the user chooses: rescope, re-plan or drop the task. This sits next to the existing "failed twice on Sonnet → Opus" rule.
- **`ship` skill, step 4**: "dispatch `branch-reviewer`" becomes "dispatch `branch-reviewer` and run `codex-review branch` in parallel".

## Testing

`node --test` files beside each script, run by `npm run test:scripts` (the quoted `scripts/**/*.test.mjs` glob):

- Verify-line parsing, including `cd <dir> &&`, and deduplication across files.
- Changed-file → `AGENTS.md` mapping, including root manifests and unmapped paths.
- The plan `Files:` parser, against a real plan in `docs/superpowers/plans/`, plus scope matching with `:lines` suffixes.
- Codex usage and model extraction from a JSONL fixture recorded in the spike.
- Report rendering for gate (pass, fail with tail, scope violation) and codex (pass, fail, error).

Process and git calls stay in thin functions that aren't unit-tested. One manual end-to-end run of each script is part of the plan.

## First task: spike

Before code: one real `codex exec -s read-only --json` run from this worktree, to record a JSONL sample (the usage and model event shapes) as the test fixture, and to confirm that `git diff origin/main...HEAD` works in the read-only sandbox, where the worktree's `.git` points outside the workspace. If git can't run there, the script passes the diff in the prompt instead, and the spec is updated before Task 2.

## Out of scope

- Codex as implementer (approach B). Revisit if review findings show Sonnet implementation is the weak point.
- Jev routing.
- Logging Claude subagent tokens.
- Changing `~/.codex/AGENTS.md`. It still imports `RTK.md`, though rtk was uninstalled on 2026-09-30; that's the user's global config to fix.
