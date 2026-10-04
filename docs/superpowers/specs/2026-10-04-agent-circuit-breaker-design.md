# Agent circuit breaker, with an office view

Date: 2026-10-04
Status: **shelved** 2026-10-04: two weeks of transcripts show no retry loops,
and every no-progress trip was a legitimate device pass (see "Why shelved")

## Why shelved

Replaying the 543 subagent dispatches of 2026-09-20 → 2026-10-04 (every
worktree) against the rules below:

- **Retry loop**: 0 dispatches would have tripped.
- **No progress**: 9 would have tripped, all of them device passes reading
  screenshots, which is that job. Stopping them means re-dispatching, which
  costs more than it saves.
- **Where spend goes**: `general-purpose` took 163M of 195M weighted tokens
  (84%, 427 dispatches). The 18 device passes took 35M (18%), the largest
  7.9M, all as `general-purpose`; `device-checker` was dispatched zero times.

The cost is routing, not runaways. The fix taken instead: CLAUDE.md now says
device passes never go to `general-purpose`. Revisit this spec if a replay
ever shows real retry loops.

## Problem

Claude Code sessions in this repo dispatch subagents (`.claude/agents/`,
Explore, general-purpose) across several worktrees at once. Nothing watches
them. Three failure modes cost real time and subscription limit:

- **Retry loops**: an agent re-runs the same failing command or edit.
- **Burning the hourly limit**: subagents eat the subscription's usage while
  nobody is looking, and the main sessions stall.
- **No progress**: an agent keeps reading and searching without changing
  anything or finishing.

Munder Difflin (github.com/HarnessMD/munder-difflin) solves this for agents it
spawns itself, with a steer → constrain → stop breaker and a pixel-office UI.
It cannot see sessions it did not launch, so we build our own, inside Claude
Code.

## Decisions

1. **A Claude Code mod**, not settings hooks. Only the mods API gives token
   usage per agent, denies subagent tool calls with a reason the model reads,
   and draws a pane. It lives in the repo at `.claude/skills/breaker/`, a
   project plugin Claude Code auto-loads, so every worktree gets it.
2. **Two levels, steer and stop.** Munder Difflin's middle "constrain" level
   is dropped: for us it would be a softer steer with its own tests.
3. **The main session is only ever steered, never stopped.**
4. **A subagent cannot be killed mid-run.** "Stop" means every further tool
   call is denied with "stop and report to your caller", which ends the run.
5. **The hourly budget blocks new dispatches, not running agents.**
6. **Budgets are constants in code, not options.** Tuning means editing a
   number.
7. **Office UI on desktop, plain tree in the terminal.** The desktop pane is
   SVG; the terminal gets the text tree only.
8. **Sprites are adapted from Munder Difflin's `portraitArt.ts`** (MIT, notice
   kept), with our own character recipes: no Office cast names or likenesses.
   Floor and furniture are drawn by us; LimeZu's tiles are not used (their
   licence forbids redistribution).

## Verified facts (spike, 2026-10-04, Claude Code 2.1.286, desktop app)

A throwaway mod logged real events while subagents ran:

- `tool.call` input carries `agentId` on every subagent call and none on the
  main loop; two concurrent subagents had distinct ids.
- A failed Bash call resolves with `isError: true` and `text` starting
  `Exit code 1`; a successful one has no `isError`. Results carry `isReadOnly`.
- `turn.step` (an async-generator hook) resolves to `{ turnId, index, answer,
  toolUses, stopReason, usage }`; `usage` has `input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens` and `model`, and
  the input carries the same `agentId`.
- `agent.spawn` input has `tool_use_id`, `prompt`, `description`,
  `subagentType`; its result gives the new `agentId` and `model`.
- `claude plugin validate` requires helpers that receive `$` to be top-level
  function declarations.

## Signals

Tracked per agent: each subagent `agentId`, plus `main` for the main loop.

**Retry loop.** Key = tool name + stable JSON of its input without
`description`. Two consecutive failures (`isError`) of the same key put the
agent in **retrying**. A third call with that key is denied before it runs:
a trip. Any successful call clears the count for that key.

**No progress.** A call that succeeds with `isReadOnly: false` is progress
and zeroes the streak. 40 consecutive read-only calls put the agent in
**stalled** and the 41st is denied: a trip. Agent types that cannot write by
design never trip this signal: `Explore`, `Plan`, `claude-code-guide`,
`spec-reviewer`, `quality-reviewer`, `branch-reviewer`, `device-checker`. The
dispatch budget covers them.

**Dispatch budget.** Weighted tokens (below) summed per subagent dispatch.
Crossing the budget is a trip. Starting value: twice the 95th percentile of
real dispatches, measured from the last two weeks of transcripts while
writing the plan.

**Hourly budget.** Weighted tokens across every session on the machine over a
rolling 60 minutes. Over budget, `agent.spawn` is denied with a reason the
dispatching session reads, plus a toast. Starting value: the busiest real hour
in the same transcripts.

**Weighting.** `(input + 1.25·cache_creation + 0.1·cache_read + R·output) × M`,
where `R` is the output/input price ratio and `M` the model's input price over
Opus's, both taken from current API pricing while writing the plan.
Subscription limits are not exposed; this is the stand-in.

## Escalation

| Agent | First trip | Second trip in the same dispatch |
|---|---|---|
| Subagent | **steer**: the call is denied with what was seen and "change approach, or stop and report what is blocking you" | **stop**: every further call is denied with "Circuit breaker: stop and report to your caller" |
| Main session | **steer** | **steer** again; never stop |

Every steer and stop raises a toast. A dispatch that crosses its token budget
goes straight to **stop**. **Reset** (pane button) returns a stopped agent
to healthy with zeroed counters.

States: `working`, `retrying`, `stalled`, `steered`, `stopped`, `done`. A
steered agent shows `steered` until its next successful call, then `working`;
the trip still counts towards stop. An agent is `done` at its `turn.complete`; done agents dim and leave the pane
after 10 minutes.

## Shared state

`$.store` is shared by every session on the machine. Each session writes only
its own key, `usage:<sessionId>`: per-minute buckets of weighted tokens for
the last 60 minutes. Readers sum all `usage:*` keys. One writer per key means
no cross-session write races. Buckets older than 60 minutes are dropped on
write; a session's key is deleted at its `session.end`.

Per-agent state for the pane lives in `$.state` (this session only), declared
in `types/index.d.ts`.

## UI

**Desktop pane**, opened by a `/breaker` command:

- Header: weighted tokens per minute, number of sessions, and hourly use as a
  percentage of the hourly budget.
- Office floor: the main session at a boss desk on top; one desk per subagent
  dispatch below, with a sprite for its agent type: the 7 saved agents, the
  boss, and one generic sprite for everything else.
- Each state is the base sprite plus an overlay, always with a text label:
  working = typing (two front frames alternating), retrying = ↻ bubble,
  stalled = zzz, steered = speech bubble, stopped = red lamp, done = empty
  chair with ✓.
- Under each desk: the dispatch's token bar against its budget, and its last
  call or the trip reason.
- Below the floor: one row per stopped or steered agent, with **Reset** on
  stopped ones.

Sprites are pixel buffers (`sceneFrameBufs`-style, 18×32) turned into SVG
rects. The scene redraws on state changes and on a typing timer only; no
model tokens are used.

**Terminal**: the same information as a text tree.

**Everywhere**: a toast on every steer or stop; a status line such as
`breaker: 1 retrying · 1 stopped` while anything is not healthy, cleared when
all are healthy.

## Files

```
.claude/skills/breaker/
  .claude-plugin/plugin.json   name, version, "types": "./types/index.d.ts"
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           events → policy → deny/state; pane, toast, status
  hooks/policy.ts              pure: signals in, decision out
  hooks/sprites.ts             adapted portraitArt recipes + floor/desks → SVG
  types/index.d.ts             $.state contract
  LICENSE-portraitArt          Munder Difflin's MIT notice
  *.test.ts                    claude plugin test
```

To confirm first in the plan: that a plugin under `.claude/skills/<name>/`
needs no `SKILL.md` to load, that the desktop surface has `Svg`, and the
`$.store` call shapes.

## Testing

- **`policy.ts` unit tests** (`claude plugin test`): identical-failure
  counting and its reset on success, the read-only streak and its reset on
  progress, read-only agent types exempt, dispatch budget → stop, second trip
  → stop, main never stopped, Reset, hourly budget denying spawns, weighting.
- **UI tests**: mount the pane on `desktop` and `terminal`; each state's
  label is present, and Reset clears a stopped agent.
- **Live check**: a haiku subagent runs one failing command three times;
  expect the third denied, the pane showing retrying, then stopped after a
  second trip, and a toast.
- **No CI job**: CI has no `claude` CLI. Tests run locally; the plugin's
  README says how.

## Out of scope

A cross-session agent tree; the constrain level; the office in the terminal;
LimeZu tiles; configurable thresholds; anything outside Claude Code (Codex,
other CLIs).
