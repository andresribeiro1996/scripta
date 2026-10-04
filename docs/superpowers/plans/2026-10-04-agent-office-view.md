# Agent Office View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod that draws every live session's agents as a pixel office in a desktop pane, with each agent's state and API-equivalent spend.

**Architecture:** A project plugin at `.claude/skills/office/`. Pure modules (`model.ts`, `floors.ts`, `sprites.ts`, `svg.ts`) hold all logic and are unit-tested with `claude plugin test`; `register.tsx` only wires engine events into the model, writes and reads per-session snapshot files, and renders. Nothing calls a model.

**Tech Stack:** Claude Code mods API (Claude Code 2.1.286): `register(on)`, `$.state` atoms, `$.fs`, `$.clock`, `$.ui`; TSX against the global `h`; `claude plugin validate` / `claude plugin test` (`test`, `expect` from `claude-code/testing`).

**Spec:** `docs/superpowers/specs/2026-10-04-agent-office-view-design.md`

## Global Constraints

- Plugin root: `.claude/skills/office/`; plugin name `office`; `$.state` keys live under `office`.
- No model tokens: no `$.model`, `$.agent.spawn`, `$.session.send` or `$.session.append` anywhere.
- Viewer only: no hook returns `{ deny }` or changes an event; every hook passes `next(e)` through and returns its result.
- Snapshot folder: `${HOME}/.claude/office/`, with `HOME` from `$.env.get("HOME")`. Never a path starting with `~` (it is not expanded and creates a literal `~` folder in the cwd).
- Prices, USD per million tokens: opus 4 / 20 / 5 / 0.20, sonnet 2 / 10 / 2.5 / 0.20, haiku 1 / 5 / 1.25 / 0.10 (input / output / cache write / cache read). Family = `opus` or `haiku` if the model id contains it, else `sonnet`.
- Heavy mark: `HEAVY_USD = 4`. Done agents leave after `DONE_TTL_MS = 600000`. Per-minute spend over `SPEND_WINDOW_MS = 300000`.
- Floors: write at most once per `1000` ms while dirty, refresh every `60000` ms while quiet; read every `2000` ms; files older than `STALE_MS = 180000` by `mtimeMs` are ignored.
- `Svg` `source` must stay under 131072 characters.
- Helpers that receive `$` must be top-level `function` declarations (`claude plugin validate` rejects anything else).
- Repo rules: no comments in code (the MIT notice file is the only attribution); minimum code; catch only the specific failure expected.
- UI is tested through the pure `officeSvg` and `terminalRows` functions plus the Task 5 live check, not by mounting the pane in the test kit. The pane hook only picks one of the two by surface, and the kit's mount API isn't worth learning for that.
- Tests: `claude plugin test .claude/skills/office`. If it reports function hooks are switched off, prefix the command with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. CI does not run these.

## Review Focus

1. **Agent ids never spawned in view** (engine forks for compaction or memory, or subagents spawned before the mod loaded) send `tool.call`/`turn.step` events: they must not create phantom desks or crash. Pinned in Task 1.
2. **Descriptions and commands containing `<`, `>`, `&`, `"`** must render as text, not break the SVG. Pinned in Task 3.
3. **A snapshot read while another session is writing it** (truncated JSON) must be skipped for that read while the other floors still show. Pinned in Task 4.
4. **A busy machine** (12 desks on this floor, 6 other floors of 4 agents) must stay under the 131072-character `Svg` cap. Pinned in Task 3.
5. **Unknown or empty model ids and usage with missing fields** must price as sonnet and never produce `NaN`. Pinned in Task 1.

---

### Task 1: Plugin skeleton, types and the agent model

**Files:**
- Create: `.claude/skills/office/.claude-plugin/plugin.json`
- Create: `.claude/skills/office/hooks/hooks.json`
- Create: `.claude/skills/office/hooks/register.tsx` (placeholder pane; replaced in Task 5)
- Create: `.claude/skills/office/types/index.d.ts`
- Create: `.claude/skills/office/hooks/model.ts`
- Create: `.claude/skills/office/README.md`
- Test: `.claude/skills/office/tests/model.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`types/index.d.ts`): `AgentState`, `Agent`, `SpendSample`, `Office`, `Snapshot`, and the `PluginState['office']` contract `{ office: Office; floors: Snapshot[] }`.
- Produces (`hooks/model.ts`): `HEAVY_USD`, `DONE_TTL_MS`, `SPEND_WINDOW_MS`, `MAIN_ID`, `type Usage`, `type OfficeEvent`, `costUsd(model: string, usage: Usage): number`, `emptyOffice(at: number): Office`, `callLabel(tool, input): string`, `callKey(tool, input): string`, `reduce(office: Office, ev: OfficeEvent): Office`, `spendPerMinute(office: Office, at: number): number`, `isHeavy(agent: Agent): boolean`, `modelShort(model: string): string`, `statusText(office: Office): string | undefined`.

- [ ] **Step 1: Write the manifest, hook list and a placeholder module**

`.claude/skills/office/.claude-plugin/plugin.json`:

```json
{
  "name": "office",
  "version": "0.1.0",
  "description": "Shows every live Claude Code session's agents as a pixel office, with state and spend",
  "types": "./types/index.d.ts"
}
```

`.claude/skills/office/hooks/hooks.json`:

```json
{ "modules": ["./register.tsx"] }
```

`.claude/skills/office/hooks/register.tsx`:

```tsx
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: "Show this machine's agents as an office" })
    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    await $.ui.open({ id: 'office', title: 'Office' })
    return { text: 'Office opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: 'office' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Office: not wired yet.</Text>
  })
}
```

- [ ] **Step 2: Write the type contract**

`.claude/skills/office/types/index.d.ts`:

```ts
export type AgentState = 'working' | 'retrying' | 'idle' | 'done'

export type Agent = {
  id: string
  description: string
  type: string
  model: string
  state: AgentState
  lastCall: string
  costUsd: number
  startedAt: number
  finishedAt: number | null
  failKey: string | null
  failCount: number
}

export type SpendSample = { at: number; usd: number }

export type Office = { agents: Agent[]; spend: SpendSample[]; totalUsd: number }

export type Snapshot = {
  sessionId: string
  worktree: string
  updatedAt: number
  ended: boolean
  agents: Agent[]
}

declare module 'claude-code' {
  interface PluginState {
    office: { office: Office; floors: Snapshot[] }
  }
}
```

- [ ] **Step 3: Validate the skeleton**

Run: `claude plugin validate .claude/skills/office`
Expected: `✔ Validation passed` (an "author" warning is fine), listing hooks `session.start, command.run{command=office}, ui.render{component=Pane, requestId=office}`.

- [ ] **Step 4: Write the failing model tests**

`.claude/skills/office/tests/model.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import {
  callKey,
  callLabel,
  costUsd,
  DONE_TTL_MS,
  emptyOffice,
  isHeavy,
  MAIN_ID,
  modelShort,
  reduce,
  spendPerMinute,
  statusText,
} from '../hooks/model'

const round = (n: number) => Math.round(n * 1e6) / 1e6

function spawned(at = 0) {
  return reduce(emptyOffice(at), {
    kind: 'spawn', agentId: 'a1', description: 'Implement task 3', type: 'implementer', model: 'claude-sonnet-5-5', at,
  })
}

test('prices each family and treats unknown models as sonnet', () => {
  const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 }
  expect(round(costUsd('claude-opus-5-5', u))).toBe(29.2)
  expect(round(costUsd('claude-sonnet-5-5', u))).toBe(14.7)
  expect(round(costUsd('claude-haiku-4-5', u))).toBe(7.35)
  expect(round(costUsd('claude-fable-5-1', u))).toBe(14.7)
  expect(round(costUsd('', u))).toBe(14.7)
})

test('missing usage fields cost nothing rather than NaN', () => {
  expect(costUsd('claude-opus-5-5', {})).toBe(0)
  expect(costUsd('claude-opus-5-5', { output_tokens: 1000 })).toBe(0.02)
})

test('an empty office has only the idle main session', () => {
  const o = emptyOffice(5)
  expect(o.agents).toHaveLength(1)
  expect(o.agents[0]).toMatchObject({ id: MAIN_ID, type: 'main', state: 'idle', startedAt: 5, costUsd: 0 })
  expect(o.totalUsd).toBe(0)
})

test('spawn adds a working subagent once', () => {
  const o = spawned()
  expect(o.agents[1]).toMatchObject({ id: 'a1', description: 'Implement task 3', type: 'implementer', state: 'working' })
  const again = reduce(o, { kind: 'spawn', agentId: 'a1', description: 'x', type: 'x', model: 'x', at: 1 })
  expect(again.agents).toHaveLength(2)
})

test('events for agents never spawned are ignored', () => {
  const o = spawned()
  const after = [
    { kind: 'call' as const, agentId: 'fork-1', tool: 'Read', input: { file_path: '/x' }, isError: false, at: 1 },
    { kind: 'step' as const, agentId: 'fork-1', model: 'claude-opus-5-5', usage: { output_tokens: 1000 }, at: 1 },
    { kind: 'complete' as const, agentId: 'fork-1', at: 1 },
  ].reduce(reduce, o)
  expect(after.agents).toHaveLength(2)
  expect(after.totalUsd).toBe(0)
})

test('steps add cost to the agent, the total and the spend window', () => {
  const o = reduce(spawned(), { kind: 'step', agentId: 'a1', model: 'claude-sonnet-5-5', usage: { output_tokens: 100_000 }, at: 10 })
  expect(o.agents[1].costUsd).toBe(1)
  expect(o.agents[1].model).toBe('claude-sonnet-5-5')
  expect(o.totalUsd).toBe(1)
  expect(spendPerMinute(o, 10)).toBe(0.2)
})

test('a main-loop step wakes the idle main session', () => {
  const o = reduce(emptyOffice(0), { kind: 'step', agentId: null, model: 'claude-opus-5-5', usage: {}, at: 1 })
  expect(o.agents[0].state).toBe('working')
})

test('the last call is labelled with its most telling input', () => {
  expect(callLabel('Bash', { command: 'npm test', description: 'Run tests' })).toBe('Bash npm test')
  expect(callLabel('Read', { file_path: '/a/b.ts' })).toBe('Read /a/b.ts')
  expect(callLabel('TodoWrite', { todos: [] })).toBe('TodoWrite')
  expect(callLabel('Bash', { command: 'x'.repeat(80) })).toHaveLength(40)
})

test('call keys ignore description and key order', () => {
  expect(callKey('Bash', { command: 'ls', description: 'a' })).toBe(callKey('Bash', { description: 'b', command: 'ls' }))
  expect(callKey('Bash', { command: 'ls' })).not.toBe(callKey('Bash', { command: 'pwd' }))
})

test('two identical failures mark retrying and a success clears it', () => {
  const fail = { kind: 'call' as const, agentId: 'a1', tool: 'Bash', input: { command: 'npm test' }, isError: true, at: 1 }
  const once = reduce(spawned(), fail)
  expect(once.agents[1].state).toBe('working')
  const twice = reduce(once, fail)
  expect(twice.agents[1].state).toBe('retrying')
  const other = reduce(once, { ...fail, input: { command: 'npm run lint' } })
  expect(other.agents[1].state).toBe('working')
  const ok = reduce(twice, { ...fail, isError: false })
  expect(ok.agents[1]).toMatchObject({ state: 'working', failCount: 0, failKey: null })
})

test('completion marks a subagent done and returns main to idle', () => {
  const o = reduce(reduce(spawned(), { kind: 'complete', agentId: 'a1', at: 50 }), { kind: 'complete', agentId: null, at: 60 })
  expect(o.agents[1]).toMatchObject({ state: 'done', finishedAt: 50 })
  expect(o.agents[0].state).toBe('idle')
  const late = reduce(o, { kind: 'call', agentId: 'a1', tool: 'Read', input: {}, isError: false, at: 70 })
  expect(late.agents[1].state).toBe('done')
})

test('ticks drop done agents after ten minutes and keep the total', () => {
  let o = reduce(spawned(), { kind: 'step', agentId: 'a1', model: 'claude-sonnet-5-5', usage: { output_tokens: 100_000 }, at: 1 })
  o = reduce(o, { kind: 'complete', agentId: 'a1', at: 100 })
  expect(reduce(o, { kind: 'tick', at: 100 + DONE_TTL_MS - 1 }).agents).toHaveLength(2)
  const later = reduce(o, { kind: 'tick', at: 100 + DONE_TTL_MS })
  expect(later.agents).toHaveLength(1)
  expect(later.totalUsd).toBe(1)
  expect(spendPerMinute(later, 100 + DONE_TTL_MS)).toBe(0)
})

test('a tick that changes nothing returns the same office', () => {
  const o = spawned()
  expect(reduce(o, { kind: 'tick', at: 1 })).toBe(o)
})

test('heavy, short model names and the status line', () => {
  const o = reduce(spawned(), { kind: 'step', agentId: 'a1', model: 'claude-opus-5-5', usage: { output_tokens: 200_000 }, at: 1 })
  expect(isHeavy(o.agents[1])).toBe(true)
  expect(isHeavy(o.agents[0])).toBe(false)
  expect(modelShort('claude-opus-5-5')).toBe('opus')
  expect(modelShort('claude-haiku-4-5')).toBe('haiku')
  expect(modelShort('claude-fable-5-1')).toBe('claude-fable-5-1')
  expect(statusText(o)).toBe('office: 1 agent · 1 heavy')
  expect(statusText(emptyOffice(0))).toBeUndefined()
  expect(statusText(reduce(o, { kind: 'complete', agentId: 'a1', at: 2 }))).toBeUndefined()
})
```

- [ ] **Step 5: Run the tests to see them fail**

Run: `claude plugin test .claude/skills/office`
Expected: FAIL, `../hooks/model` cannot be resolved.

- [ ] **Step 6: Implement the model**

`.claude/skills/office/hooks/model.ts`:

```ts
import type { Agent, Office } from '../types'

export const HEAVY_USD = 4
export const DONE_TTL_MS = 10 * 60 * 1000
export const SPEND_WINDOW_MS = 5 * 60 * 1000
export const MAIN_ID = 'main'

export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export type OfficeEvent =
  | { kind: 'spawn'; agentId: string; description: string; type: string; model: string; at: number }
  | { kind: 'step'; agentId: string | null; model: string; usage: Usage; at: number }
  | { kind: 'call'; agentId: string | null; tool: string; input: Record<string, unknown>; isError: boolean; at: number }
  | { kind: 'complete'; agentId: string | null; at: number }
  | { kind: 'tick'; at: number }

const PRICES = {
  opus: [4, 20, 5, 0.2],
  sonnet: [2, 10, 2.5, 0.2],
  haiku: [1, 5, 1.25, 0.1],
} as const

const LABEL_KEYS = ['command', 'file_path', 'pattern', 'url', 'query', 'description']

export function modelShort(model: string): string {
  return model.includes('opus') ? 'opus' : model.includes('haiku') ? 'haiku' : model.includes('sonnet') ? 'sonnet' : model
}

export function costUsd(model: string, u: Usage): number {
  const family = model.includes('opus') ? 'opus' : model.includes('haiku') ? 'haiku' : 'sonnet'
  const [input, output, write, read] = PRICES[family]
  return (
    (u.input_tokens ?? 0) * input +
    (u.output_tokens ?? 0) * output +
    (u.cache_creation_input_tokens ?? 0) * write +
    (u.cache_read_input_tokens ?? 0) * read
  ) / 1e6
}

function newAgent(id: string, description: string, type: string, model: string, state: Agent['state'], at: number): Agent {
  return { id, description, type, model, state, lastCall: '', costUsd: 0, startedAt: at, finishedAt: null, failKey: null, failCount: 0 }
}

export function emptyOffice(at: number): Office {
  return { agents: [newAgent(MAIN_ID, 'main session', 'main', '', 'idle', at)], spend: [], totalUsd: 0 }
}

export function callLabel(tool: string, input: Record<string, unknown>): string {
  const detail = LABEL_KEYS.map(k => input[k]).find((v): v is string => typeof v === 'string')
  const label = detail ? `${tool} ${detail}` : tool
  return label.length > 40 ? `${label.slice(0, 39)}…` : label
}

export function callKey(tool: string, input: Record<string, unknown>): string {
  const keys = Object.keys(input).filter(k => k !== 'description').sort()
  return tool + JSON.stringify(keys.map(k => [k, input[k]]))
}

function patch(office: Office, id: string, fn: (a: Agent) => Agent): Office {
  return { ...office, agents: office.agents.map(a => (a.id === id ? fn(a) : a)) }
}

export function reduce(office: Office, ev: OfficeEvent): Office {
  if (ev.kind === 'tick') {
    const agents = office.agents.filter(a => a.finishedAt === null || ev.at - a.finishedAt < DONE_TTL_MS)
    const spend = office.spend.filter(s => ev.at - s.at < SPEND_WINDOW_MS)
    if (agents.length === office.agents.length && spend.length === office.spend.length) return office
    return { ...office, agents, spend }
  }
  if (ev.kind === 'spawn') {
    if (office.agents.some(a => a.id === ev.agentId)) return office
    return { ...office, agents: [...office.agents, newAgent(ev.agentId, ev.description, ev.type, ev.model, 'working', ev.at)] }
  }
  const id = ev.agentId ?? MAIN_ID
  const agent = office.agents.find(a => a.id === id)
  if (!agent || agent.state === 'done') return office
  if (ev.kind === 'step') {
    const usd = costUsd(ev.model, ev.usage)
    const next = patch(office, id, a => ({ ...a, model: ev.model, costUsd: a.costUsd + usd, state: a.state === 'idle' ? 'working' : a.state }))
    return { ...next, spend: [...next.spend, { at: ev.at, usd }], totalUsd: office.totalUsd + usd }
  }
  if (ev.kind === 'call') {
    const key = callKey(ev.tool, ev.input)
    return patch(office, id, a => {
      const failCount = ev.isError ? (a.failKey === key ? a.failCount + 1 : 1) : 0
      return { ...a, lastCall: callLabel(ev.tool, ev.input), failKey: ev.isError ? key : null, failCount, state: failCount >= 2 ? 'retrying' : 'working' }
    })
  }
  return patch(office, id, a => (id === MAIN_ID ? { ...a, state: 'idle' } : { ...a, state: 'done', finishedAt: ev.at }))
}

export function spendPerMinute(office: Office, at: number): number {
  const recent = office.spend.filter(s => at - s.at < SPEND_WINDOW_MS)
  return recent.reduce((sum, s) => sum + s.usd, 0) / (SPEND_WINDOW_MS / 60000)
}

export function isHeavy(agent: Agent): boolean {
  return agent.costUsd >= HEAVY_USD
}

export function statusText(office: Office): string | undefined {
  const live = office.agents.filter(a => a.id !== MAIN_ID && a.state !== 'done')
  if (live.length === 0) return undefined
  const heavy = live.filter(isHeavy).length
  const agents = `office: ${live.length} agent${live.length === 1 ? '' : 's'}`
  return heavy > 0 ? `${agents} · ${heavy} heavy` : agents
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `claude plugin test .claude/skills/office`
Expected: all `model.test.ts` tests PASS. Then `claude plugin validate .claude/skills/office` passes.

- [ ] **Step 8: Write the README**

`.claude/skills/office/README.md`:

```markdown
# office

A Claude Code mod that draws every live session on this machine as a pixel
office: one desk per agent, its state, its last call and its API-equivalent
spend. It only watches; it never blocks or changes anything, and it uses no
model tokens.

Open it with `/office` in any session in this repo.

Sessions share state through `$HOME/.claude/office/<sessionId>.json`. Ended
sessions' files are left there; they are ignored once three minutes old.

## Tests

    claude plugin validate .claude/skills/office
    claude plugin test .claude/skills/office

If `claude plugin test` reports function hooks are off, prefix it with
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. CI does not run these.

Spec: `docs/superpowers/specs/2026-10-04-agent-office-view-design.md`.
```

- [ ] **Step 9: Commit**

```bash
git add .claude/skills/office && git commit -m "Add the office mod's agent model and plugin skeleton" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Sprites, adapted from Munder Difflin

**Files:**
- Create: `.claude/skills/office/hooks/sprites.ts`
- Create: `.claude/skills/office/LICENSE-portraitArt`
- Test: `.claude/skills/office/tests/sprites.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `type Frame = { w: number; h: number; data: Uint8ClampedArray }`, `type SpriteKey = 'boss' | 'implementer' | 'spec-reviewer' | 'quality-reviewer' | 'branch-reviewer' | 'ci-fixer' | 'deploy-ops' | 'device-checker' | 'other'`, `SPRITE_KEYS: readonly SpriteKey[]`, `spriteKeyOf(agentType: string): SpriteKey`, `spriteFrame(key: SpriteKey): Frame` (18×32, front, standing, cached).

- [ ] **Step 1: Write the failing tests**

`.claude/skills/office/tests/sprites.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import { SPRITE_KEYS, spriteFrame, spriteKeyOf } from '../hooks/sprites'

test('every sprite composes an 18x32 frame with opaque pixels', () => {
  expect(SPRITE_KEYS).toHaveLength(9)
  for (const key of SPRITE_KEYS) {
    const f = spriteFrame(key)
    expect(f.w).toBe(18)
    expect(f.h).toBe(32)
    expect(f.data).toHaveLength(18 * 32 * 4)
    let opaque = 0
    for (let i = 3; i < f.data.length; i += 4) if (f.data[i] === 255) opaque++
    expect(opaque).toBeGreaterThan(100)
  }
})

test('sprites differ from one another', () => {
  const seen = new Set(SPRITE_KEYS.map(k => Array.from(spriteFrame(k).data).join(',')))
  expect(seen.size).toBe(9)
})

test('frames are cached', () => {
  expect(spriteFrame('implementer')).toBe(spriteFrame('implementer'))
})

test('agent types map to sprites, everything unknown to other', () => {
  expect(spriteKeyOf('main')).toBe('boss')
  expect(spriteKeyOf('implementer')).toBe('implementer')
  expect(spriteKeyOf('device-checker')).toBe('device-checker')
  expect(spriteKeyOf('Explore')).toBe('other')
  expect(spriteKeyOf('general-purpose')).toBe('other')
  expect(spriteKeyOf('')).toBe('other')
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test .claude/skills/office`
Expected: FAIL, `../hooks/sprites` cannot be resolved.

- [ ] **Step 3: Fetch the upstream file and its licence**

```bash
gh api 'repos/HarnessMD/munder-difflin/contents/src/renderer/src/scene/office/portraitArt.ts?ref=9e26ca5f692ba00d50334c79f4b6d36416e3bffa' -H 'Accept: application/vnd.github.raw' > .claude/skills/office/hooks/sprites.ts
gh api 'repos/HarnessMD/munder-difflin/contents/LICENSE?ref=9e26ca5f692ba00d50334c79f4b6d36416e3bffa' -H 'Accept: application/vnd.github.raw' > /tmp/md-license
```

Write `.claude/skills/office/LICENSE-portraitArt` as this line, a blank line, then the exact contents of `/tmp/md-license`:

```
hooks/sprites.ts is adapted from src/renderer/src/scene/office/portraitArt.ts in https://github.com/HarnessMD/munder-difflin at commit 9e26ca5f692ba00d50334c79f4b6d36416e3bffa, under this licence:
```

Then `rm /tmp/md-license`.

- [ ] **Step 4: Cut the upstream file down to the scene sprite**

Edit `.claude/skills/office/hooks/sprites.ts`:

1. Delete the `import type { OfficeCharacterName } from './cast';` line.
2. Delete `PORTRAIT_W`, `PORTRAIT_H`, `compose`, `getBuf`, `bufCache`, `sceneCache`, `SceneFrames`, `sceneFrameBufs` and `paintPortrait` (the only code that touches a canvas or `document`).
3. Delete the `RECIPES` constant (the Office cast) and replace it with the code in Step 5.
4. Delete every function and constant that no longer has a caller. Check each with `rg -n '<name>' .claude/skills/office/hooks/sprites.ts`. `collarNeck` is likely one, since only `compose` called it. Keep `composeScene` and everything it reaches.
5. Remove every comment (the repo allows no comments in code; attribution lives in `LICENSE-portraitArt`). Remove whole-line `//` comments and trailing `// …` comments, and check that no string literal contained `//` before removing anything on that line.
6. `CUR_W`/`CUR_H` are module-level `let`s that `composeScene` sets; keep them.

`rg -n 'document|canvas|Canvas|OfficeCharacterName|michael|dwight|jim|pam' .claude/skills/office/hooks/sprites.ts` must print nothing.

- [ ] **Step 5: Add our recipes and the exports**

Append to `.claude/skills/office/hooks/sprites.ts` (after the `Recipe` interface and every function `composeScene` uses):

```ts
export type Frame = { w: number; h: number; data: Uint8ClampedArray }

export type SpriteKey =
  | 'boss'
  | 'implementer'
  | 'spec-reviewer'
  | 'quality-reviewer'
  | 'branch-reviewer'
  | 'ci-fixer'
  | 'deploy-ops'
  | 'device-checker'
  | 'other'

const RECIPES: Record<SpriteKey, Recipe> = {
  'boss':             { skin: 'tan',   hairc: [40, 32, 26],    hair: 'styleShort',  hairargs: { part: 'R' }, cloth: 'suit', c1: [36, 48, 82], tie: [196, 160, 52], brow: 'flat', mouth: 'smile' },
  'implementer':      { skin: 'light', hairc: [150, 96, 52],   hair: 'styleMessy',  hairargs: { length: 14 }, cloth: 'polo', c1: [70, 150, 96], c2: [56, 124, 78], brow: 'soft', mouth: 'smile' },
  'spec-reviewer':    { skin: 'brown', hairc: [30, 24, 20],    hair: 'styleBun',    cloth: 'cardigan', c1: [126, 92, 170], c2: [238, 232, 218], glasses: true, brow: 'raised', mouth: 'neutral', lashes: true },
  'quality-reviewer': { skin: 'light', hairc: [120, 110, 100], hair: 'styleRecede', cloth: 'dressshirt', c1: [176, 206, 232], tie: [40, 56, 96], glasses: true, facial: 'mustacheSm', brow: 'flat', mouth: 'neutral' },
  'branch-reviewer':  { skin: 'dark',  hairc: [26, 22, 20],    hair: 'styleCurly',  cloth: 'sweater', c1: [136, 54, 60], brow: 'flat', mouth: 'neutral' },
  'ci-fixer':         { skin: 'tan',   hairc: [60, 40, 24],    hair: 'styleSpiky',  cloth: 'polo', c1: [226, 128, 48], c2: [196, 104, 36], brow: 'angry', mouth: 'grin' },
  'deploy-ops':       { skin: 'light', hairc: [168, 84, 40],   hair: 'styleFrame',  hairargs: { length: 18, vol: 1 }, cloth: 'blouse', c1: [44, 150, 150], brow: 'soft', mouth: 'smile', lashes: true },
  'device-checker':   { skin: 'brown', hairc: [48, 36, 28],    hair: 'styleFloppy', cloth: 'dressshirt', c1: [196, 178, 120], glasses: true, brow: 'raised', mouth: 'smile' },
  'other':            { skin: 'dark',  hairc: [50, 46, 44],    hair: 'styleBald',   cloth: 'sweater', c1: [128, 132, 140], facial: 'stubble', brow: 'flat', mouth: 'neutral' },
}

export const SPRITE_KEYS = Object.keys(RECIPES) as SpriteKey[]

const frames = new Map<SpriteKey, Frame>()

export function spriteKeyOf(agentType: string): SpriteKey {
  if (agentType === 'main') return 'boss'
  return (SPRITE_KEYS as string[]).includes(agentType) && agentType !== 'boss' && agentType !== 'other' ? (agentType as SpriteKey) : 'other'
}

export function spriteFrame(key: SpriteKey): Frame {
  let frame = frames.get(key)
  if (!frame) {
    frame = { w: SCENE_W, h: SCENE_H, data: composeScene(RECIPES[key], 0, false) }
    frames.set(key, frame)
  }
  return frame
}
```

If `Recipe`'s field names or the `HairStyle`, `Cloth`, `Brow`, `Mouth` or `Facial` unions in the fetched file differ from these recipes, keep the colours and change only the names to the upstream ones.

- [ ] **Step 6: Run the tests to see them pass**

Run: `claude plugin test .claude/skills/office`
Expected: `sprites.test.ts` and `model.test.ts` PASS. `claude plugin validate .claude/skills/office` passes.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/office && git commit -m "Add office sprites adapted from Munder Difflin's portrait art" -m "The composer and drawing primitives are MIT and kept with their notice; the Office cast recipes are replaced by one generic character per agent type, and the canvas-only portrait path is dropped because a mod has no DOM." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Drawing the office (SVG and terminal rows)

**Files:**
- Create: `.claude/skills/office/hooks/svg.ts`
- Test: `.claude/skills/office/tests/svg.test.ts`

**Interfaces:**
- Consumes: `Office`, `Agent`, `Snapshot` (types); `HEAVY_USD`, `MAIN_ID`, `isHeavy`, `modelShort`, `spendPerMinute` (`model.ts`); `Frame`, `SPRITE_KEYS`, `spriteFrame`, `spriteKeyOf` (`sprites.ts`).
- Produces: `type View = { own: Office; floors: Snapshot[]; cols: number; at: number }`, `SVG_LIMIT = 131072`, `escapeXml(text: string): string`, `framePaths(f: Frame): { fill: string; d: string }[]`, `officeSvg(view: View): string`, `terminalRows(view: View): string[]`.

- [ ] **Step 1: Write the failing tests**

`.claude/skills/office/tests/svg.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import type { Agent, Office, Snapshot } from '../types'
import { emptyOffice, reduce } from '../hooks/model'
import { escapeXml, framePaths, officeSvg, SVG_LIMIT, terminalRows } from '../hooks/svg'

function agent(id: string, over: Partial<Agent> = {}): Agent {
  return { id, description: `Task ${id}`, type: 'implementer', model: 'claude-sonnet-5-5', state: 'working', lastCall: 'Bash npm test', costUsd: 0.5, startedAt: 0, finishedAt: null, failKey: null, failCount: 0, ...over }
}

function office(agents: Agent[]): Office {
  return { ...emptyOffice(0), agents: [emptyOffice(0).agents[0], ...agents] }
}

function floor(n: number, count: number): Snapshot {
  return { sessionId: `s${n}`, worktree: `worktree-${n}`, updatedAt: n, ended: false, agents: [emptyOffice(0).agents[0], ...Array.from({ length: count }, (_, i) => agent(`f${n}-${i}`))] }
}

test('framePaths merges runs of one colour and skips transparent pixels', () => {
  const data = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255])
  expect(framePaths({ w: 4, h: 1, data })).toEqual([
    { fill: '#ff0000', d: 'M0 0h2v1h-2z' },
    { fill: '#0000ff', d: 'M3 0h1v1h-1z' },
  ])
  expect(framePaths({ w: 1, h: 1, data: new Uint8ClampedArray(4) })).toEqual([])
})

test('escapeXml escapes markup characters', () => {
  expect(escapeXml(`a<b>&"c'`)).toBe('a&lt;b&gt;&amp;&quot;c&apos;')
})

test('every state has a text label in the svg', () => {
  const svg = officeSvg({
    own: office([agent('a'), agent('b', { state: 'retrying' }), agent('c', { state: 'done', finishedAt: 1 })]),
    floors: [], cols: 4, at: 1,
  })
  for (const label of ['idle', 'working', 'retrying', 'done']) expect(svg).toContain(`>${label}<`)
  expect(svg).toStartWith('<svg')
  expect(svg).toContain('<animateTransform')
})

test('heavy shows past four dollars and not below', () => {
  expect(officeSvg({ own: office([agent('a', { costUsd: 4.5 })]), floors: [], cols: 4, at: 1 })).toContain('heavy')
  expect(officeSvg({ own: office([agent('a', { costUsd: 3.9 })]), floors: [], cols: 4, at: 1 })).not.toContain('heavy')
})

test('descriptions and calls with markup do not break the svg', () => {
  const svg = officeSvg({ own: office([agent('a', { description: 'Fix <Box> & "quotes"', lastCall: 'Bash echo <x>' })]), floors: [], cols: 4, at: 1 })
  expect(svg).toContain('Fix &lt;Box&gt; &amp; &quot;quotes&quot;')
  expect(svg).not.toContain('<Box>')
  expect(svg).not.toContain('<x>')
})

test('other floors appear with their worktree names', () => {
  const svg = officeSvg({ own: office([]), floors: [floor(1, 2)], cols: 4, at: 1 })
  expect(svg).toContain('worktree-1')
})

test('a busy machine stays under the svg cap', () => {
  const own = office(Array.from({ length: 12 }, (_, i) => agent(`a${i}`, { description: 'x'.repeat(60), lastCall: 'y'.repeat(40) })))
  const floors = Array.from({ length: 6 }, (_, i) => floor(i, 4))
  expect(officeSvg({ own, floors, cols: 4, at: 1 }).length).toBeLessThan(SVG_LIMIT)
})

test('terminal rows list this floor and the others', () => {
  const own = reduce(office([agent('a', { costUsd: 4.2 })]), { kind: 'tick', at: 1 })
  const rows = terminalRows({ own, floors: [floor(1, 1)], cols: 4, at: 1 })
  expect(rows[0]).toStartWith('Office · $')
  expect(rows.join('\n')).toContain('main session · idle')
  expect(rows.join('\n')).toContain('Task a · implementer · sonnet · working · $4.20 heavy · Bash npm test')
  expect(rows.join('\n')).toContain('worktree-1')
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test .claude/skills/office`
Expected: FAIL, `../hooks/svg` cannot be resolved.

- [ ] **Step 3: Implement the drawing**

`.claude/skills/office/hooks/svg.ts`:

```ts
import type { Agent, Office, Snapshot } from '../types'
import { HEAVY_USD, isHeavy, MAIN_ID, modelShort, spendPerMinute } from './model'
import { type Frame, SPRITE_KEYS, spriteFrame, spriteKeyOf } from './sprites'

export type View = { own: Office; floors: Snapshot[]; cols: number; at: number }

export const SVG_LIMIT = 131072

const PAD = 10
const CELL_W = 160
const CELL_H = 170
const HEADER_H = 30
const STRIP_H = 84
const MINI_W = 70
const INK = '#2b2b33'
const FLOOR = '#e6dcc6'
const GRID = '#d8ccb2'
const DESK = '#8b5a2b'
const DESK_TOP = '#a8703a'
const SCREEN = '#2b2f3a'
const GLOW = '#6fb7ff'
const OK = '#3f8f5a'
const HOT = '#c0392b'

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string)
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

export function framePaths(f: Frame): { fill: string; d: string }[] {
  const byFill = new Map<string, string>()
  const colorAt = (x: number, y: number) => {
    const i = (y * f.w + x) * 4
    return f.data[i + 3] === 0 ? null : hex(f.data[i], f.data[i + 1], f.data[i + 2])
  }
  for (let y = 0; y < f.h; y++) {
    let x = 0
    while (x < f.w) {
      const fill = colorAt(x, y)
      if (fill === null) {
        x++
        continue
      }
      let end = x + 1
      while (end < f.w && colorAt(end, y) === fill) end++
      byFill.set(fill, `${byFill.get(fill) ?? ''}M${x} ${y}h${end - x}v1h-${end - x}z`)
      x = end
    }
  }
  return [...byFill].map(([fill, d]) => ({ fill, d }))
}

function symbols(): string {
  return SPRITE_KEYS.map(key => {
    const paths = framePaths(spriteFrame(key)).map(p => `<path fill="${p.fill}" d="${p.d}"/>`).join('')
    return `<symbol id="s-${key}" viewBox="0 0 18 32">${paths}</symbol>`
  }).join('')
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`
}

function text(x: number, y: number, body: string, attrs = ''): string {
  return `<text x="${x}" y="${y}" ${attrs}>${escapeXml(body)}</text>`
}

function sprite(agent: Agent, x: number, y: number, w: number, h: number): string {
  const use = `<use href="#s-${spriteKeyOf(agent.type)}" x="${x}" y="${y}" width="${w}" height="${h}"/>`
  if (agent.state !== 'working') return use
  return `<g>${use}<animateTransform attributeName="transform" type="translate" values="0 0;0 1;0 0" dur="0.6s" repeatCount="indefinite"/></g>`
}

function spendBar(agent: Agent, x: number, y: number, w: number): string {
  const heavy = isHeavy(agent)
  const filled = Math.min(1, agent.costUsd / HEAVY_USD) * w
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="6" fill="${GRID}"/>`,
    `<rect x="${x}" y="${y}" width="${filled.toFixed(1)}" height="6" fill="${heavy ? HOT : OK}"/>`,
    text(x, y + 18, heavy ? `${usd(agent.costUsd)} heavy` : usd(agent.costUsd), `fill="${heavy ? HOT : INK}"`),
  ].join('')
}

function desk(agent: Agent, x: number, y: number): string {
  const parts: string[] = []
  if (agent.state === 'done') {
    parts.push(`<g opacity="0.5">`)
    parts.push(`<rect x="${x + 62}" y="${y + 52}" width="34" height="30" rx="4" fill="#6b6b78"/>`)
    parts.push(text(x + 72, y + 46, '✓', `fill="${OK}" font-size="18"`))
  } else {
    parts.push(sprite(agent, x + 61, y + 16, 36, 64))
  }
  parts.push(`<rect x="${x + 20}" y="${y + 70}" width="120" height="22" fill="${DESK}"/>`)
  parts.push(`<rect x="${x + 20}" y="${y + 70}" width="120" height="4" fill="${DESK_TOP}"/>`)
  parts.push(`<rect x="${x + 104}" y="${y + 46}" width="30" height="22" fill="${SCREEN}"/>`)
  parts.push(`<rect x="${x + 107}" y="${y + 49}" width="24" height="16" fill="${agent.state === 'working' ? GLOW : '#4a5568'}"/>`)
  if (agent.state === 'retrying') {
    parts.push(`<circle cx="${x + 40}" cy="${y + 26}" r="11" fill="#ffffff" stroke="${HOT}"/>`)
    parts.push(text(x + 34, y + 31, '↻', `fill="${HOT}" font-size="14"`))
  }
  parts.push(text(x + 8, y + 108, agent.state, `font-weight="bold" fill="${agent.state === 'retrying' ? HOT : INK}"`))
  parts.push(text(x + 8, y + 122, cut(agent.description, 24), `fill="${INK}"`))
  parts.push(text(x + 8, y + 136, agent.id === MAIN_ID ? `boss · ${modelShort(agent.model)}` : `${agent.type} · ${modelShort(agent.model)}`, `fill="#5b5b66"`))
  parts.push(text(x + 8, y + 150, cut(agent.lastCall, 26), `fill="#5b5b66"`))
  parts.push(spendBar(agent, x + 8, y + 156, 140))
  if (agent.state === 'done') parts.push('</g>')
  return parts.join('')
}

function strip(snap: Snapshot, y: number, width: number): string {
  const main = snap.agents.find(a => a.id === MAIN_ID)
  const subs = snap.agents.filter(a => a.id !== MAIN_ID)
  const parts = [
    `<rect x="${PAD}" y="${y}" width="${width - 2 * PAD}" height="${STRIP_H - 8}" rx="6" fill="#efe7d6" stroke="${GRID}"/>`,
    text(PAD + 8, y + 16, `${snap.worktree} · main ${main?.state ?? 'idle'}`, `font-weight="bold" fill="${INK}"`),
  ]
  subs.slice(0, Math.floor((width - 2 * PAD) / MINI_W)).forEach((a, i) => {
    const x = PAD + 8 + i * MINI_W
    parts.push(a.state === 'done' ? text(x + 4, y + 50, '✓', `fill="${OK}"`) : sprite(a, x, y + 22, 18, 32))
    parts.push(text(x + 22, y + 40, a.state, `fill="${a.state === 'retrying' ? HOT : INK}"`))
    parts.push(text(x + 22, y + 54, isHeavy(a) ? `${usd(a.costUsd)} heavy` : usd(a.costUsd), `fill="${isHeavy(a) ? HOT : INK}"`))
  })
  return parts.join('')
}

export function officeSvg(view: View): string {
  const cols = Math.max(1, view.cols)
  const width = PAD + cols * (CELL_W + PAD)
  const main = view.own.agents.find(a => a.id === MAIN_ID)
  const subs = view.own.agents.filter(a => a.id !== MAIN_ID)
  const rows = 1 + Math.ceil(subs.length / cols)
  const floorH = HEADER_H + rows * (CELL_H + PAD)
  const height = floorH + view.floors.length * STRIP_H + PAD
  const header = `Spend ${usd(view.own.totalUsd)} · ${usd(spendPerMinute(view.own, view.at))}/min`
  const cells: string[] = []
  if (main) cells.push(desk(main, (width - CELL_W) / 2, HEADER_H))
  subs.forEach((a, i) => {
    cells.push(desk(a, PAD + (i % cols) * (CELL_W + PAD), HEADER_H + (1 + Math.floor(i / cols)) * (CELL_H + PAD)))
  })
  const strips = view.floors.map((f, i) => strip(f, floorH + i * STRIP_H, width))
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="crispEdges" font-family="ui-monospace, monospace" font-size="11">`,
    `<defs>${symbols()}<pattern id="tiles" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="${FLOOR}"/><path d="M0 0h32v1h-32zM0 0h1v32h-1z" fill="${GRID}"/></pattern></defs>`,
    `<rect width="${width}" height="${floorH}" fill="url(#tiles)"/>`,
    text(PAD, 20, header, `font-weight="bold" fill="${INK}"`),
    ...cells,
    ...strips,
    '</svg>',
  ].join('')
}

function row(a: Agent): string {
  const spend = isHeavy(a) ? `${usd(a.costUsd)} heavy` : usd(a.costUsd)
  return [a.description, a.type, modelShort(a.model), a.state, spend, a.lastCall].filter(Boolean).join(' · ')
}

export function terminalRows(view: View): string[] {
  const main = view.own.agents.find(a => a.id === MAIN_ID)
  const lines = [
    `Office · ${usd(view.own.totalUsd)} spent · ${usd(spendPerMinute(view.own, view.at))}/min`,
    main ? `main session · ${main.state}` : 'main session',
    ...view.own.agents.filter(a => a.id !== MAIN_ID).map(a => `├ ${row(a)}`),
  ]
  for (const f of view.floors) {
    const fmain = f.agents.find(a => a.id === MAIN_ID)
    lines.push(`${f.worktree} · main ${fmain?.state ?? 'idle'}`)
    for (const a of f.agents.filter(a => a.id !== MAIN_ID)) lines.push(`  ├ ${row(a)}`)
  }
  return lines
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `claude plugin test .claude/skills/office`
Expected: `svg.test.ts`, `sprites.test.ts` and `model.test.ts` PASS.

- [ ] **Step 5: Look at it**

Create a throwaway test that writes a sample scene to disk. It is deleted in this same step and never committed.

`.claude/skills/office/tests/preview.test.ts`:

```ts
import { test } from 'claude-code/testing'
import type { Agent } from '../types'
import { emptyOffice } from '../hooks/model'
import { officeSvg } from '../hooks/svg'

const states: Agent['state'][] = ['working', 'retrying', 'working', 'done']
const types = ['implementer', 'spec-reviewer', 'device-checker', 'ci-fixer']

test('preview', async $ => {
  const main = { ...emptyOffice(0).agents[0], model: 'claude-opus-5-5', state: 'working' as const, costUsd: 1.2 }
  const agents: Agent[] = types.map((type, i) => ({
    ...main, id: `a${i}`, type, description: `Sample ${type} task`, model: 'claude-sonnet-5-5',
    state: states[i], costUsd: i * 1.6, lastCall: 'Bash npm test', finishedAt: states[i] === 'done' ? 1 : null,
  }))
  const floor = { sessionId: 'x', worktree: 'gallant-ellis-9e576e', updatedAt: 1, ended: false, agents: [main, ...agents.slice(0, 2)] }
  await $.fs.write('/tmp/office-preview.svg', officeSvg({ own: { agents: [main, ...agents], spend: [], totalUsd: 6.4 }, floors: [floor], cols: 4, at: 1 }))
})
```

Run `claude plugin test .claude/skills/office`, then `open /tmp/office-preview.svg` and look at it. Then delete both: `rm .claude/skills/office/tests/preview.test.ts /tmp/office-preview.svg`.

Report in the task summary what you saw: overlapping text, a sprite hidden by its desk, labels cut off at the right edge. Fix layout constants in `svg.ts` only, never test expectations, and re-run the tests after any fix.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/office && git commit -m "Draw the office as SVG, with a text fallback for the terminal" -m "Each sprite is one <symbol> of per-colour paths, placed with <use>, so a busy machine stays under the 131072-character Svg cap; typing is SMIL, so working desks animate without redraws." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Floors (snapshots shared between sessions)

**Files:**
- Create: `.claude/skills/office/hooks/floors.ts`
- Test: `.claude/skills/office/tests/floors.test.ts`

**Interfaces:**
- Consumes: `Office`, `Snapshot` (types).
- Produces: `STALE_MS = 180000`, `WRITE_MIN_MS = 1000`, `REFRESH_MS = 60000`, `snapshotOf(sessionId: string, root: string, office: Office, at: number, ended: boolean): Snapshot`, `shouldWrite(lastWriteAt: number, dirty: boolean, at: number): boolean`, `freshFiles(listed: { name: string; mtimeMs: number }[], selfId: string, at: number): string[]`, `parseFloors(files: { name: string; text: string }[]): { floors: Snapshot[]; bad: string[] }`.

- [ ] **Step 1: Write the failing tests**

`.claude/skills/office/tests/floors.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import { emptyOffice } from '../hooks/model'
import { freshFiles, parseFloors, REFRESH_MS, shouldWrite, snapshotOf, STALE_MS, WRITE_MIN_MS } from '../hooks/floors'

test('a snapshot names its worktree and round-trips', () => {
  const snap = snapshotOf('s1', '/Users/me/scripta/.claude/worktrees/gallant-ellis-9e576e', emptyOffice(0), 42, false)
  expect(snap).toMatchObject({ sessionId: 's1', worktree: 'gallant-ellis-9e576e', updatedAt: 42, ended: false })
  expect(parseFloors([{ name: 's1.json', text: JSON.stringify(snap) }]).floors).toEqual([snap])
  expect(snapshotOf('s1', '/repo/', emptyOffice(0), 0, false).worktree).toBe('repo')
})

test('writes are throttled while busy and refreshed while quiet', () => {
  expect(shouldWrite(0, true, WRITE_MIN_MS - 1)).toBe(false)
  expect(shouldWrite(0, true, WRITE_MIN_MS)).toBe(true)
  expect(shouldWrite(0, false, REFRESH_MS - 1)).toBe(false)
  expect(shouldWrite(0, false, REFRESH_MS)).toBe(true)
})

test('only fresh json files from other sessions are read', () => {
  const at = 1_000_000
  const listed = [
    { name: 'mine.json', mtimeMs: at },
    { name: 'fresh.json', mtimeMs: at - STALE_MS + 1 },
    { name: 'stale.json', mtimeMs: at - STALE_MS },
    { name: 'notes.txt', mtimeMs: at },
  ]
  expect(freshFiles(listed, 'mine', at)).toEqual(['fresh.json'])
})

test('ended sessions are skipped and floors sort by latest update', () => {
  const a = snapshotOf('a', '/w/a', emptyOffice(0), 10, false)
  const b = snapshotOf('b', '/w/b', emptyOffice(0), 20, false)
  const c = snapshotOf('c', '/w/c', emptyOffice(0), 30, true)
  const { floors, bad } = parseFloors([a, b, c].map(s => ({ name: `${s.sessionId}.json`, text: JSON.stringify(s) })))
  expect(floors.map(f => f.sessionId)).toEqual(['b', 'a'])
  expect(bad).toEqual([])
})

test('a half-written or foreign file is skipped without hiding the others', () => {
  const good = snapshotOf('good', '/w/good', emptyOffice(0), 10, false)
  const { floors, bad } = parseFloors([
    { name: 'partial.json', text: JSON.stringify(good).slice(0, 25) },
    { name: 'foreign.json', text: '{"hello":1}' },
    { name: 'good.json', text: JSON.stringify(good) },
  ])
  expect(floors.map(f => f.sessionId)).toEqual(['good'])
  expect(bad).toEqual(['partial.json', 'foreign.json'])
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test .claude/skills/office`
Expected: FAIL, `../hooks/floors` cannot be resolved.

- [ ] **Step 3: Implement floors**

`.claude/skills/office/hooks/floors.ts`:

```ts
import type { Office, Snapshot } from '../types'

export const STALE_MS = 3 * 60 * 1000
export const WRITE_MIN_MS = 1000
export const REFRESH_MS = 60 * 1000

export function snapshotOf(sessionId: string, root: string, office: Office, at: number, ended: boolean): Snapshot {
  const worktree = root.split('/').filter(Boolean).pop() ?? root
  return { sessionId, worktree, updatedAt: at, ended, agents: office.agents }
}

export function shouldWrite(lastWriteAt: number, dirty: boolean, at: number): boolean {
  return at - lastWriteAt >= (dirty ? WRITE_MIN_MS : REFRESH_MS)
}

export function freshFiles(listed: { name: string; mtimeMs: number }[], selfId: string, at: number): string[] {
  return listed
    .filter(f => f.name.endsWith('.json') && f.name !== `${selfId}.json` && at - f.mtimeMs < STALE_MS)
    .map(f => f.name)
}

function isSnapshot(v: unknown): v is Snapshot {
  const s = v as Snapshot
  return typeof s === 'object' && s !== null && typeof s.sessionId === 'string' && typeof s.worktree === 'string' &&
    typeof s.updatedAt === 'number' && typeof s.ended === 'boolean' && Array.isArray(s.agents)
}

export function parseFloors(files: { name: string; text: string }[]): { floors: Snapshot[]; bad: string[] } {
  const floors: Snapshot[] = []
  const bad: string[] = []
  for (const file of files) {
    let parsed: unknown
    try {
      parsed = JSON.parse(file.text)
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err
      bad.push(file.name)
      continue
    }
    if (!isSnapshot(parsed)) bad.push(file.name)
    else if (!parsed.ended) floors.push(parsed)
  }
  return { floors: floors.sort((a, b) => b.updatedAt - a.updatedAt), bad }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `claude plugin test .claude/skills/office`
Expected: all four test files PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/office && git commit -m "Share office floors between sessions through snapshot files" -m "One file per session has a single writer; the plugin store's behaviour under concurrent writers is undocumented. \$.fs cannot delete, so ended sessions are marked and aged out by mtime." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire the mod into Claude Code

**Files:**
- Modify: `.claude/skills/office/hooks/register.tsx` (replace the Task 1 placeholder entirely)

**Interfaces:**
- Consumes: `emptyOffice`, `reduce`, `statusText`, `type OfficeEvent` (`model.ts`); `freshFiles`, `parseFloors`, `shouldWrite`, `snapshotOf` (`floors.ts`); `officeSvg`, `terminalRows` (`svg.ts`); `Snapshot` (types); `atom`, `read`, `update` from `claude-code`.
- Produces: the `/office` command, the `office` pane, the status line, and `$HOME/.claude/office/<sessionId>.json`.

- [ ] **Step 1: Replace register.tsx**

`.claude/skills/office/hooks/register.tsx`:

```tsx
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Snapshot } from '../types'
import { emptyOffice, reduce, statusText, type OfficeEvent } from './model'
import { freshFiles, parseFloors, shouldWrite, snapshotOf } from './floors'
import { officeSvg, terminalRows } from './svg'

const PANE = 'office'
const officeAtom = atom({ plugin: 'office', key: 'office' } as const, emptyOffice(0))
const floorsAtom = atom({ plugin: 'office', key: 'floors' } as const, [] as Snapshot[])
const reported = new Set<string>()
let dirty = true
let lastWriteAt = 0

async function dirOf($: any): Promise<string> {
  const home = await $.env.get('HOME')
  if (!home) throw new Error('office: HOME is not set')
  return `${home}/.claude/office`
}

async function apply($: any, ev: OfficeEvent) {
  await update($, officeAtom, o => reduce(o, ev))
  dirty = true
  $.ui.status(statusText(await read($, officeAtom)))
}

async function writeSnapshot($: any, ended: boolean) {
  const at = await $.clock.now()
  const snap = snapshotOf(await $.session.id(), await $.session.root(), await read($, officeAtom), at, ended)
  await $.fs.write(`${await dirOf($)}/${snap.sessionId}.json`, JSON.stringify(snap))
  lastWriteAt = at
  dirty = false
}

async function beat($: any) {
  const at = await $.clock.now()
  await update($, officeAtom, o => reduce(o, { kind: 'tick', at }))
  if (shouldWrite(lastWriteAt, dirty, at)) await writeSnapshot($, false)
}

async function readFloors($: any) {
  const dir = await dirOf($)
  if (!(await $.fs.exists(dir))) return
  const names = freshFiles(await $.fs.list(dir), await $.session.id(), await $.clock.now())
  const files = await Promise.all(names.map(async name => ({ name, text: await $.fs.read(`${dir}/${name}`) })))
  const { floors, bad } = parseFloors(files)
  for (const name of bad) {
    if (reported.has(name)) continue
    reported.add(name)
    $.ui.log(`office: skipped unreadable snapshot ${name}`, { to: 'debug' })
  }
  await update($, floorsAtom, () => floors)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: "Show this machine's agents as an office" })
    const at = await $.clock.now()
    await update($, officeAtom, o => (o.agents[0].startedAt === 0 ? emptyOffice(at) : o))
    $.clock.every(1000, () => beat($))
    $.clock.every(2000, () => readFloors($))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await writeSnapshot($, true)
    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Office' })
    return { text: 'Office opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const r: any = await next(e)
    if (typeof r?.agentId === 'string') {
      await apply($, {
        kind: 'spawn',
        agentId: r.agentId,
        description: e.description ?? '',
        type: e.subagentType ?? 'general-purpose',
        model: r.model ?? '',
        at: await $.clock.now(),
      })
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const r: any = await next(e)
    const { tool, tool_use_id: _id, agentId, ...input } = e as any
    await apply($, {
      kind: 'call',
      agentId: agentId ?? null,
      tool,
      input,
      isError: r?.isError === true && r?.deny === undefined,
      at: await $.clock.now(),
    })
    return r
  })

  on('turn.step', async function* ($, e, next) {
    const r: any = yield* next(e)
    if (r?.usage) {
      await apply($, { kind: 'step', agentId: (e as any).agentId ?? null, model: r.usage.model ?? '', usage: r.usage, at: await $.clock.now() })
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await apply($, { kind: 'complete', agentId: e.agentId ?? null, at: await $.clock.now() })
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = {
      own: await read($, officeAtom),
      floors: await read($, floorsAtom),
      cols: Math.max(1, Math.min(6, Math.floor(((e.props as any)?.bodyColumns ?? 80) / 20))),
      at: await $.clock.now(),
    }
    const rows = terminalRows(view)
    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      return <Svg source={officeSvg(view)} alt={rows.join('\n')} isInteractive={true} />
    }
    const { Box, Text } = $.ui.resolve(e)
    return <Box flexDirection="column">{rows.map(line => <Text>{line}</Text>)}</Box>
  })
}
```

If `claude plugin validate` rejects a field name (for example `e.description`, `e.subagentType` or `e.agentId` on a typed event), look up the event's input type in the declaration file the plugin-authoring skill names, and use the declared name. The spike logged `agent.spawn` input keys `tool_use_id`, `prompt`, `description`, `subagentType`.

- [ ] **Step 2: Validate**

Run: `claude plugin validate .claude/skills/office`
Expected: `✔ Validation passed`; hooks listed: `session.start, session.end, command.run{command=office}, agent.spawn, tool.call, turn.step, turn.complete, ui.render{component=Pane, requestId=office}`; calls include `$.env.get`, `$.fs.write`, `$.fs.list`, `$.fs.read`, `$.fs.exists`, and none of `$.model`, `$.agent.spawn`, `$.session.send`, `$.session.append`.

- [ ] **Step 3: Run every test**

Run: `claude plugin test .claude/skills/office`
Expected: all four test files PASS.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/office && git commit -m "Wire the office mod to agent events, the pane and floor files" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Live check (main session, with the user)**

The implementer stops after Step 4. The main session runs this:

1. A fresh session in this worktree loads `.claude/skills/office`. Run `/office`: the pane shows the boss desk, `idle`.
2. Dispatch two subagents: an `Explore` haiku that runs `ls /nonexistent-office-check` twice and then `echo ok`, and an `Explore` haiku that reads one file. Expected: two desks appear; the first shows `retrying` after the second failure and `working` after `echo ok`; both end `done` with spend under $0.10; the status line shows `office: 2 agents` while they run and clears after.
3. Start a second session in another worktree and dispatch one subagent there. Expected: within about 3 seconds a strip with that worktree's name appears in the first session's pane. Quit the second session: the strip goes within 3 minutes.
4. `ls ~/.claude/office` shows one `.json` per session started, and no `~` folder exists in the worktree (`ls -d ./~` fails).
5. Send the user a screenshot of the pane.
```
