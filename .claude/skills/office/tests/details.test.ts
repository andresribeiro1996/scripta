import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buttonLabel, detailRows } from '../hooks/details.ts'
import type { Agent } from '../types'

const T0 = new Date(2026, 9, 4, 9, 5, 7).getTime()

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'a1', description: 'Implement the whole of task 3 with no truncation at all', type: 'implementer', model: 'claude-sonnet-5-5',
    state: 'working', lastCall: '', costUsd: 0.31, startedAt: T0, finishedAt: null, failKey: null, failCount: 0,
    calls: [], costByModel: { 'claude-sonnet-5-5': 0.31 }, ...over,
  }
}

test('a working agent shows description, spend, running time and counts', () => {
  const rows = detailRows(agent({ calls: [{ label: 'Read /a', isError: false, at: 1 }, { label: 'Bash npm test', isError: true, at: 2 }] }), T0 + 252_000)
  assert.deepEqual(rows, [
    'Implement the whole of task 3 with no truncation at all',
    'implementer · sonnet $0.31',
    'started 09:05:07 · running 4m 12s',
    '2 calls · 1 failed',
    '✗ Bash npm test',
    '· Read /a',
  ])
})

test('a done agent shows how long it took', () => {
  const rows = detailRows(agent({ state: 'done', finishedAt: T0 + 45_000 }), T0 + 999_000)
  assert.equal(rows[2], 'started 09:05:07 · took 45s')
  assert.equal(rows[3], '0 calls · 0 failed')
  assert.equal(rows.length, 4)
})

test('main with two models lists them by spend and a total', () => {
  const rows = detailRows(agent({ type: 'main', costUsd: 1.51, costByModel: { 'claude-sonnet-5-5': 0.31, 'claude-opus-5-5': 1.2 } }), T0)
  assert.equal(rows[1], 'main · opus $1.20 · sonnet $0.31 · total $1.51')
})

test('durations switch format at a minute and an hour', () => {
  const at = (ms: number) => detailRows(agent(), T0 + ms)[2]
  assert.match(at(45_000), /running 45s$/)
  assert.match(at(252_000), /running 4m 12s$/)
  assert.match(at(3_780_000), /running 1h 3m$/)
})

test('the button shows a closed or open marker before the description', () => {
  assert.equal(buttonLabel(agent({ description: 'Do it' }), false), '▸ Do it')
  assert.equal(buttonLabel(agent({ description: 'Do it' }), true), '▾ Do it')
})
