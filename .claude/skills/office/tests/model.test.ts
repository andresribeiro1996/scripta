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
