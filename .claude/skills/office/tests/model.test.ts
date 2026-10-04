import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CALL_HISTORY,
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
} from '../hooks/model.ts'

const round = (n: number) => Math.round(n * 1e6) / 1e6

function spawned(at = 0) {
  return reduce(emptyOffice(at), {
    kind: 'spawn', agentId: 'a1', description: 'Implement task 3', type: 'implementer', model: 'claude-sonnet-5-5', at,
  })
}

test('prices each family and treats unknown models as sonnet', () => {
  const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 }
  assert.equal(round(costUsd('claude-opus-5-5', u)), 29.2)
  assert.equal(round(costUsd('claude-sonnet-5-5', u)), 14.7)
  assert.equal(round(costUsd('claude-haiku-4-5', u)), 7.35)
  assert.equal(round(costUsd('claude-fable-5-1', u)), 14.7)
  assert.equal(round(costUsd('', u)), 14.7)
})

test('missing usage fields cost nothing rather than NaN', () => {
  assert.equal(costUsd('claude-opus-5-5', {}), 0)
  assert.equal(costUsd('claude-opus-5-5', { output_tokens: 1000 }), 0.02)
})

test('an empty office has only the idle main session', () => {
  const o = emptyOffice(5)
  assert.equal((o.agents).length, 1)
  assert.partialDeepStrictEqual(o.agents[0], { id: MAIN_ID, type: 'main', state: 'idle', startedAt: 5, costUsd: 0 })
  assert.equal(o.totalUsd, 0)
})

test('spawn adds a working subagent once', () => {
  const o = spawned()
  assert.partialDeepStrictEqual(o.agents[1], { id: 'a1', description: 'Implement task 3', type: 'implementer', state: 'working' })
  const again = reduce(o, { kind: 'spawn', agentId: 'a1', description: 'x', type: 'x', model: 'x', at: 1 })
  assert.equal((again.agents).length, 2)
})

test('events for agents never spawned are ignored', () => {
  const o = spawned()
  const after = [
    { kind: 'call' as const, agentId: 'fork-1', tool: 'Read', input: { file_path: '/x' }, isError: false, at: 1 },
    { kind: 'step' as const, agentId: 'fork-1', model: 'claude-opus-5-5', usage: { output_tokens: 1000 }, at: 1 },
    { kind: 'complete' as const, agentId: 'fork-1', at: 1 },
  ].reduce(reduce, o)
  assert.equal((after.agents).length, 2)
  assert.equal(after.totalUsd, 0)
})

test('steps add cost to the agent, the total and the spend window', () => {
  const o = reduce(spawned(), { kind: 'step', agentId: 'a1', model: 'claude-sonnet-5-5', usage: { output_tokens: 100_000 }, at: 10 })
  assert.equal(o.agents[1].costUsd, 1)
  assert.equal(o.agents[1].model, 'claude-sonnet-5-5')
  assert.equal(o.totalUsd, 1)
  assert.equal(spendPerMinute(o, 10), 0.2)
})

test('a main-loop step wakes the idle main session', () => {
  const o = reduce(emptyOffice(0), { kind: 'step', agentId: null, model: 'claude-opus-5-5', usage: {}, at: 1 })
  assert.equal(o.agents[0].state, 'working')
})

test('the last call is labelled with its most telling input', () => {
  assert.equal(callLabel('Bash', { command: 'npm test', description: 'Run tests' }), 'Bash npm test')
  assert.equal(callLabel('Read', { file_path: '/a/b.ts' }), 'Read /a/b.ts')
  assert.equal(callLabel('TodoWrite', { todos: [] }), 'TodoWrite')
  assert.equal((callLabel('Bash', { command: 'x'.repeat(80) })).length, 40)
})

test('call keys ignore description and key order', () => {
  assert.equal(callKey('Bash', { command: 'ls', description: 'a' }), callKey('Bash', { description: 'b', command: 'ls' }))
  assert.notEqual(callKey('Bash', { command: 'ls' }), callKey('Bash', { command: 'pwd' }))
})

test('two identical failures mark retrying and a success clears it', () => {
  const fail = { kind: 'call' as const, agentId: 'a1', tool: 'Bash', input: { command: 'npm test' }, isError: true, at: 1 }
  const once = reduce(spawned(), fail)
  assert.equal(once.agents[1].state, 'working')
  const twice = reduce(once, fail)
  assert.equal(twice.agents[1].state, 'retrying')
  const other = reduce(once, { ...fail, input: { command: 'npm run lint' } })
  assert.equal(other.agents[1].state, 'working')
  const ok = reduce(twice, { ...fail, isError: false })
  assert.partialDeepStrictEqual(ok.agents[1], { state: 'working', failCount: 0, failKey: null })
})

test('completion marks a subagent done and returns main to idle', () => {
  const o = reduce(reduce(spawned(), { kind: 'complete', agentId: 'a1', at: 50 }), { kind: 'complete', agentId: null, at: 60 })
  assert.partialDeepStrictEqual(o.agents[1], { state: 'done', finishedAt: 50 })
  assert.equal(o.agents[0].state, 'idle')
  const late = reduce(o, { kind: 'call', agentId: 'a1', tool: 'Read', input: {}, isError: false, at: 70 })
  assert.equal(late.agents[1].state, 'done')
})

test('ticks drop done agents after ten minutes and keep the total', () => {
  let o = reduce(spawned(), { kind: 'step', agentId: 'a1', model: 'claude-sonnet-5-5', usage: { output_tokens: 100_000 }, at: 1 })
  o = reduce(o, { kind: 'complete', agentId: 'a1', at: 100 })
  assert.equal((reduce(o, { kind: 'tick', at: 100 + DONE_TTL_MS - 1 }).agents).length, 2)
  const later = reduce(o, { kind: 'tick', at: 100 + DONE_TTL_MS })
  assert.equal((later.agents).length, 1)
  assert.equal(later.totalUsd, 1)
  assert.equal(spendPerMinute(later, 100 + DONE_TTL_MS), 0)
})

test('a tick that changes nothing returns the same office', () => {
  const o = spawned()
  assert.equal(reduce(o, { kind: 'tick', at: 1 }), o)
})

test('heavy, short model names and the status line', () => {
  const o = reduce(spawned(), { kind: 'step', agentId: 'a1', model: 'claude-opus-5-5', usage: { output_tokens: 200_000 }, at: 1 })
  assert.equal(isHeavy(o.agents[1]), true)
  assert.equal(isHeavy(o.agents[0]), false)
  assert.equal(modelShort('claude-opus-5-5'), 'opus')
  assert.equal(modelShort('claude-haiku-4-5'), 'haiku')
  assert.equal(modelShort('claude-fable-5-1'), 'claude-fable-5-1')
  assert.equal(statusText(o), 'office: 1 agent · 1 heavy')
  assert.equal(statusText(emptyOffice(0)), undefined)
  assert.equal(statusText(reduce(o, { kind: 'complete', agentId: 'a1', at: 2 })), undefined)
})

test('calls are recorded with their outcome and capped at the newest thirty', () => {
  const call = (n: number, isError = false) => ({ kind: 'call' as const, agentId: 'a1', tool: 'Read', input: { file_path: `/f${n}` }, isError, at: n })
  const two = reduce(reduce(spawned(), call(1, true)), call(2))
  assert.deepEqual(two.agents[1].calls, [
    { label: 'Read /f1', isError: true, at: 1 },
    { label: 'Read /f2', isError: false, at: 2 },
  ])
  assert.equal(CALL_HISTORY, 30)
  const many = Array.from({ length: CALL_HISTORY + 1 }, (_, i) => call(i)).reduce(reduce, spawned())
  assert.equal(many.agents[1].calls.length, CALL_HISTORY)
  assert.equal(many.agents[1].calls[0].label, 'Read /f1')
  assert.equal(many.agents[1].calls[CALL_HISTORY - 1].label, `Read /f${CALL_HISTORY}`)
})

test('step cost is split by full model id', () => {
  const step = (model: string, at: number) => ({ kind: 'step' as const, agentId: 'a1', model, usage: { output_tokens: 100_000 }, at })
  const o = [step('claude-sonnet-5-5', 1), step('claude-opus-5-5', 2), step('claude-sonnet-5-5', 3)].reduce(reduce, spawned())
  assert.deepEqual(o.agents[1].costByModel, { 'claude-sonnet-5-5': 2, 'claude-opus-5-5': 2 })
  assert.equal(o.agents[1].costUsd, 4)
  assert.deepEqual(spawned().agents[1].calls, [])
  assert.deepEqual(spawned().agents[1].costByModel, {})
})

test('calls to done or unknown agents are not recorded', () => {
  const done = reduce(spawned(), { kind: 'complete', agentId: 'a1', at: 5 })
  const after = reduce(reduce(done, { kind: 'call', agentId: 'a1', tool: 'Read', input: {}, isError: false, at: 6 }), { kind: 'call', agentId: 'zz', tool: 'Read', input: {}, isError: false, at: 6 })
  assert.deepEqual(after.agents[1].calls, [])
})
