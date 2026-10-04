# Agent office view

Date: 2026-10-04
Status: approved in conversation (option A, office view without the
breaker); spec awaiting review

## Problem

Subagent spend is invisible while it happens. The two-week replay behind the
shelved breaker (`2026-10-04-agent-circuit-breaker-design.md`) found device
passes costing 2–8M weighted tokens each, and nobody saw it until a transcript
was read afterwards. We want a live view of each session's agents, what each
is doing, and what each has cost, drawn as a pixel office like Munder Difflin's.

## Decisions

1. **A viewer only.** It never denies, steers or stops anything. The breaker
   stays shelved.
2. **A Claude Code mod** in the repo at `.claude/skills/office/`, a project
   plugin Claude Code auto-loads, so every worktree gets it. It uses no model
   tokens.
3. **Every live session on the machine, as floors.** The session's own floor
   is drawn in full; other sessions are compact floors below it, shared
   through one snapshot file per session (see Floors).
4. **Office on desktop, plain tree in the terminal.** The desktop pane is SVG;
   the terminal draws the same data as text.
5. **Sprites adapted from Munder Difflin's `portraitArt.ts`** (MIT, notice
   kept): its recipe composer and drawing primitives, with our own 9 recipes.
   No Office cast names or likenesses. Floor, desks and props are drawn by us;
   LimeZu tiles are not used (their licence forbids redistribution).
6. **"Heavy" is a display mark, not an action.** A dispatch past 1.3M weighted
   tokens (the p95 of the replay) is marked heavy.

## Verified facts (spike, 2026-10-04, Claude Code 2.1.286, desktop app)

- `tool.call` input carries `agentId` on every subagent call and none on the
  main loop; concurrent subagents have distinct ids.
- A failed Bash call resolves with `isError: true`; a successful one has no
  `isError`.
- `turn.step` (an async-generator hook: `yield* next(e)`) resolves to
  `{ turnId, index, answer, toolUses, stopReason, usage }`; `usage` has
  `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens` and `model`, and the input carries `agentId`.
- `agent.spawn` input has `tool_use_id`, `prompt`, `description`,
  `subagentType`; its result gives the new `agentId` and `model`.
- `claude plugin validate` requires helpers that receive `$` to be top-level
  function declarations.
- `portraitArt.ts` builds sprites as RGBA buffers with no canvas:
  `sceneFrameBufs()` returns 18×32 front and back frames (stand, step-L,
  step-R). Only `paintPortrait` touches a canvas; we drop it.

To confirm first in the plan: that a plugin under `.claude/skills/<name>/`
loads without a `SKILL.md`, that the desktop surface has `Svg`, and the
`turn.complete` input for a subagent (`agentId`, how an error ends it), that
`$.fs` may write and list under `~/.claude/office/`, and what
`$.session.root()` returns in a worktree session.

## What it tracks

One record per agent: `main`, plus each subagent from its `agent.spawn`.

| Field | Source |
|---|---|
| description, type, model | `agent.spawn` input and result |
| last call | latest `tool.call`: tool name plus command or file, cut to 40 chars |
| state | below |
| weighted tokens | sum over its `turn.step` usage |
| started, finished | `agent.spawn`, `turn.complete` |

**States**

- `working`: has a tool call or model step in flight.
- `retrying`: its last two calls were the same tool and input (without
  `description`) and both failed. Display only. Cleared by the next
  successful call.
- `idle` (main only): the main loop is waiting for the user.
- `done`: its `turn.complete` arrived. Done agents dim and leave the floor 10
  minutes later.

**Weighting**: `(input + 1.25·cache_creation + 0.1·cache_read + R·output) × M`,
with `R` the output/input price ratio and `M` the model's input price over
Opus's, from current API pricing at plan time. The same formula as the replay,
so the heavy mark means the same thing.

## UI

**Desktop pane**, opened by `/office`:

- Header: the session's weighted tokens so far and per minute over the last 5
  minutes.
- Floor: the main session at a boss desk on top; one desk per subagent
  dispatch below, in spawn order, wrapping to the pane's `bodyColumns`.
- Each desk shows the agent's sprite, a text state label, the description,
  `type · model`, the last call, and a token bar that fills to the heavy mark
  (1.3M) and shows **heavy** past it.
- Poses: working = typing (front frames alternating on a timer), retrying =
  ↻ bubble, idle = seated still, done = empty chair with ✓. Every pose has a
  text label, so nothing relies on colour.

**Sprites**: 9 recipes, one each for the boss (main), `implementer`,
`spec-reviewer`, `quality-reviewer`, `branch-reviewer`, `ci-fixer`,
`deploy-ops`, `device-checker`, and a generic one for every other type. Each
18×32 frame becomes SVG `rect`s with horizontal runs of one colour merged, and
frames are built once and cached.

**Other floors**, below the session's own: one strip per other live session,
newest activity first. Each strip shows the worktree name, the main session's
state, and one small sprite per subagent with its state label and weighted
tokens, plus **heavy** where it applies. Strips are read-only.

**Terminal**: the same rows as a text tree, no sprites; other sessions are
indented groups under their worktree name.

**Status line**: `office: 3 agents · 1 heavy` while any subagent is not done;
cleared when all are.

## Floors

Sessions share state through files, not `$.store`: the store is one JSON
file with no change notification, and its behaviour under concurrent writers
from several processes is not documented. One file per session has a single
writer, so nothing can be overwritten.

- **Write**: each session writes `~/.claude/office/<sessionId>.json`, holding
  `{ sessionId, worktree, updatedAt, ended, agents }`, where `worktree` is the
  basename of `$.session.root()` and `agents` holds the rows from "What it
  tracks". Written on change, at most once a second, and once a minute
  while nothing changes, so a live session's file stays fresh.
- **End**: `$.fs` has no delete. At `session.end` the session writes its
  snapshot with `ended: true`.
- **Read**: every 2 seconds the pane lists the folder and reads only files
  with `mtimeMs` under 3 minutes old. It skips its own session and any
  snapshot with `ended: true`. A crashed session stops refreshing and drops
  off within 3 minutes.
- **Growth**: ended files stay on disk, about one small file per session
  (~70 in the replay's two weeks). Readers skip them by `mtimeMs` without
  reading them. Nothing prunes them; revisit only if the folder gets slow to
  list.
- A file that fails to parse is skipped for that read and logged once to the
  debug log; it is never treated as an empty session.

## Files

```
.claude/skills/office/
  .claude-plugin/plugin.json   name, version, "types": "./types/index.d.ts"
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           events → model; pane, status line, /office
  hooks/model.ts               pure: event in, agent records out; weighting
  hooks/sprites.ts             adapted composer, our recipes, floor/desk/props
  hooks/svg.ts                 pure: RGBA frame → merged rect list
  hooks/floors.ts              pure: snapshot out; listed files → live floors
  types/index.d.ts             $.state contract
  LICENSE-portraitArt          Munder Difflin's MIT notice
  *.test.ts                    claude plugin test
```

## Testing

- **`model.ts`** (`claude plugin test`): spawn creates a record; tool calls
  update the last call; two identical failures set retrying and a success
  clears it; usage adds weighted tokens per agent; turn.complete sets done;
  done agents drop after 10 minutes on the mocked clock; main never gets a
  spawn record and is `idle` between turns.
- **`floors.ts`**: a snapshot round-trips; files older than 3 minutes,
  `ended` ones and the session's own are excluded; an unparseable file is
  skipped without dropping the others; floors sort by `updatedAt`.
- **Snapshot writes** (mocked clock): at most one write a second while
  changing, a refresh every minute while quiet, and `ended: true` on
  `session.end`.
- **`svg.ts`**: a known buffer gives the expected merged rects; transparent
  pixels produce none.
- **Sprites**: every recipe composes without throwing at 18×32, and the
  generic recipe covers an unknown type.
- **UI**: mount the pane on `desktop` and `terminal`; each state's label is
  present, heavy appears past the mark, and the done agent is gone after 10
  minutes.
- **Live check**: open `/office`, dispatch two subagents (one runs a failing
  command twice); see two desks, retrying, then done, with token bars moving.
  Then start a second session in another worktree, dispatch one subagent
  there, and see its floor appear in the first session's pane and disappear
  within 3 minutes of quitting it.
- **No CI job**: CI has no `claude` CLI. Tests run locally; the plugin's
  README says how.

## Out of scope

Any enforcement; interacting with another session's floor; pruning ended
snapshot files; the office in the terminal; clicking a
desk; LimeZu tiles; settings for thresholds.
