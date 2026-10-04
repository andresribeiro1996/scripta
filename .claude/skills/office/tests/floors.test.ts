import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freshFiles, parseFloors, REFRESH_MS, shouldWrite, snapshotOf, STALE_MS, WRITE_MIN_MS } from '../hooks/floors.ts'
import { emptyOffice } from '../hooks/model.ts'

test('a snapshot names its worktree and round-trips', () => {
  const snap = snapshotOf('s1', '/Users/me/scripta/.claude/worktrees/gallant-ellis-9e576e', emptyOffice(0), 42, false)
  assert.partialDeepStrictEqual(snap, { sessionId: 's1', worktree: 'gallant-ellis-9e576e', updatedAt: 42, ended: false })
  assert.deepEqual(parseFloors([{ name: 's1.json', text: JSON.stringify(snap) }]).floors, [snap])
  assert.equal(snapshotOf('s1', '/repo/', emptyOffice(0), 0, false).worktree, 'repo')
})

test('writes are throttled while busy and refreshed while quiet', () => {
  assert.equal(shouldWrite(0, true, WRITE_MIN_MS - 1), false)
  assert.equal(shouldWrite(0, true, WRITE_MIN_MS), true)
  assert.equal(shouldWrite(0, false, REFRESH_MS - 1), false)
  assert.equal(shouldWrite(0, false, REFRESH_MS), true)
})

test('only fresh json files from other sessions are read', () => {
  const at = 1_000_000
  const listed = [
    { name: 'mine.json', mtimeMs: at },
    { name: 'fresh.json', mtimeMs: at - STALE_MS + 1 },
    { name: 'stale.json', mtimeMs: at - STALE_MS },
    { name: 'notes.txt', mtimeMs: at },
  ]
  assert.deepEqual(freshFiles(listed, 'mine', at), ['fresh.json'])
})

test('ended sessions are skipped and floors sort by latest update', () => {
  const a = snapshotOf('a', '/w/a', emptyOffice(0), 10, false)
  const b = snapshotOf('b', '/w/b', emptyOffice(0), 20, false)
  const c = snapshotOf('c', '/w/c', emptyOffice(0), 30, true)
  const { floors, bad } = parseFloors([a, b, c].map(s => ({ name: `${s.sessionId}.json`, text: JSON.stringify(s) })))
  assert.deepEqual(floors.map(f => f.sessionId), ['b', 'a'])
  assert.deepEqual(bad, [])
})

test('a half-written or foreign file is skipped without hiding the others', () => {
  const good = snapshotOf('good', '/w/good', emptyOffice(0), 10, false)
  const { floors, bad } = parseFloors([
    { name: 'partial.json', text: JSON.stringify(good).slice(0, 25) },
    { name: 'foreign.json', text: '{"hello":1}' },
    { name: 'good.json', text: JSON.stringify(good) },
  ])
  assert.deepEqual(floors.map(f => f.sessionId), ['good'])
  assert.deepEqual(bad, ['partial.json', 'foreign.json'])
})

test('a snapshot with a malformed agent is skipped without hiding the others', () => {
  const good = snapshotOf('good', '/w/good', emptyOffice(0), 10, false)
  const agent = { id: 'a', description: 'd', type: 't', model: 'm', state: 'working', lastCall: '', costUsd: null, startedAt: 0, finishedAt: null, failKey: null, failCount: 0 }
  const broken = { ...good, sessionId: 'broken', agents: [agent] }
  const { floors, bad } = parseFloors([
    { name: 'broken.json', text: JSON.stringify(broken) },
    { name: 'good.json', text: JSON.stringify(good) },
  ])
  assert.deepEqual(floors.map(f => f.sessionId), ['good'])
  assert.deepEqual(bad, ['broken.json'])
})

test('a snapshot drops the failed call input and leaves the office alone', () => {
  const office = emptyOffice(0)
  const agent = { ...office.agents[0] ?? { id: 'a', description: 'd', type: 't', model: 'm', state: 'working', lastCall: '', costUsd: 0, startedAt: 0, finishedAt: null, failCount: 2 }, failKey: 'x'.repeat(1000) }
  const input = { ...office, agents: [agent] }
  const snap = snapshotOf('s1', '/repo', input, 0, false)
  assert.equal(snap.agents.length, 1)
  assert.ok(snap.agents.every(a => a.failKey === null))
  assert.ok(JSON.stringify(snap).length < 2000)
  assert.equal(input.agents[0].failKey, 'x'.repeat(1000))
})
