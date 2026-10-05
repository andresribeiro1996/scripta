---
name: retro
description: Retrospective on a coding session — finds where the agent setup (AGENTS.md files, agents, skills, checks, scripts) cost time or let a mistake through, and proposes fixes, most severe first. Use only when the user asks for a retro.
disable-model-invocation: true
---

# Retro

You are improving the agent's **environment** for future sessions, not the code from this one.

## 1. Read the session

Default to the current session. For another one, the user names it; transcripts are the `*.jsonl` files under `~/.claude/projects/<cwd-with-slashes-as-dashes>/`. Read what actually happened — tool calls, failures, retries, corrections from the user — not the summary.

## 2. Find candidates

Look in each category. Every candidate cites the moment in the session that shows it.

- **Navigation**: the agent spent many calls finding a file or fact. Fix with a pointer in the nearest `AGENTS.md` or `README.md`, or a better name.
- **Automated checks**: the agent made a mistake a check could catch. Read the existing guardrails first — each package's Verify commands, `npm run check:agents`, `.github/workflows/` — so a check that exists but isn't wired or is broken is the finding, not a reinvention.
- **Review rules**: a reviewer agent missed something. A mechanical rule (banned API, import shape, file location, a list that must stay in sync) becomes a check: an oxlint rule, a script under `scripts/` with a `*.test.mjs`, or a CI step. Only a judgement call goes into `.claude/agents/quality-reviewer.md` or `spec-reviewer.md` — reviewers have the least context pressure, so rules belong there, not in `AGENTS.md`.
- **Steering files**: `AGENTS.md` lines that should move into a reviewer, a check, or a skill; lines that duplicate what `package.json`, config or `--help` already says; and **no-ops** — instructions the model already follows by default.
- **Dispatch**: work done in the main session that a `.claude/agents/` agent should have taken, or an agent given a prompt that was missing what it needed.
- **Tool economy**: expensive or repeated calls a script or a sharper command would replace — `scripts/dev-status.mjs` is the model.
- **Information access**: a fact the agent needed and couldn't get — server logs, prod state, emulator output.

## 3. Present

List candidates most severe first: what happened, the proposed change, and the file it touches. Apply nothing until the user picks. Edits to an `AGENTS.md` are followed by `node scripts/sync-agent-table.mjs` when its table row changed, and `npm run check:agents`.

## Writing for agents

Apply these when drafting any change to an `AGENTS.md`, agent or skill:

- **Every always-loaded line costs on every turn.** A skill description or `AGENTS.md` line is a pointer: say what the material is and the distinct cases that should reach it. Collapse synonyms into one trigger.
- **The environment is the source of truth.** Don't restate what one file read or one command answers; write the unwritten — the convention, the reason, the gotcha.
- **One meaning, one place.** Duplication goes stale in one of its copies.
- **Every step ends on a checkable completion criterion.** "Done when X" beats "understand Y".
- **State the target behaviour.** A prohibition makes the forbidden thing more salient; use one only as a hard guardrail, paired with what to do instead.
- **A strong word beats a sentence.** _Tight_, _red_, _relentless_ carry behaviour the model already knows.
- **Delete no-ops whole.** If removing a sentence wouldn't change behaviour, remove it.
