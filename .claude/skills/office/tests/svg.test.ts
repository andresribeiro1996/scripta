import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Agent, Office, Snapshot } from '../types'
import { emptyOffice, reduce } from '../hooks/model.ts'
import { escapeXml, framePaths, officeSvg, SVG_LIMIT, terminalRows } from '../hooks/svg.ts'

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
  assert.deepEqual(framePaths({ w: 4, h: 1, data }), [
    { fill: '#ff0000', d: 'M0 0h2v1h-2z' },
    { fill: '#0000ff', d: 'M3 0h1v1h-1z' },
  ])
  assert.deepEqual(framePaths({ w: 1, h: 1, data: new Uint8ClampedArray(4) }), [])
})

test('escapeXml escapes markup characters', () => {
  assert.equal(escapeXml(`a<b>&"c'`), 'a&lt;b&gt;&amp;&quot;c&apos;')
})

test('escapeXml drops control characters and lone surrogates', () => {
  assert.equal(escapeXml('a\x1bb\x00c'), 'abc')
  assert.equal(escapeXml('x\uD83D'), 'x')
  assert.equal(escapeXml('\uDE00y'), 'y')
  assert.equal(escapeXml('😀'), '😀')
})

test('control characters in a call never reach the svg', () => {
  const svg = officeSvg({ own: office([agent('a', { lastCall: 'Bash echo -e "\x1b[31m"' })]), floors: [], cols: 4, at: 1 })
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(svg))
})

test('every state has a text label in the svg', () => {
  const svg = officeSvg({
    own: office([agent('a'), agent('b', { state: 'retrying' }), agent('c', { state: 'done', finishedAt: 1 })]),
    floors: [], cols: 4, at: 1,
  })
  for (const label of ['idle', 'working', 'retrying', 'done']) assert.ok(svg.includes(`>${label}<`))
  assert.ok(svg.startsWith('<svg'))
  assert.ok(svg.includes('<animateTransform'))
})

test('heavy shows past four dollars and not below', () => {
  assert.ok(officeSvg({ own: office([agent('a', { costUsd: 4.5 })]), floors: [], cols: 4, at: 1 }).includes('heavy'))
  assert.ok(!officeSvg({ own: office([agent('a', { costUsd: 3.9 })]), floors: [], cols: 4, at: 1 }).includes('heavy'))
})

test('descriptions and calls with markup do not break the svg', () => {
  const svg = officeSvg({ own: office([agent('a', { description: 'Fix <Box> & "quotes"', lastCall: 'Bash echo <x>' })]), floors: [], cols: 4, at: 1 })
  assert.ok(svg.includes('Fix &lt;Box&gt; &amp; &quot;quotes&quot;'))
  assert.ok(!svg.includes('<Box>'))
  assert.ok(!svg.includes('<x>'))
})

test('other floors appear with their worktree names', () => {
  const svg = officeSvg({ own: office([]), floors: [floor(1, 2)], cols: 4, at: 1 })
  assert.ok(svg.includes('worktree-1'))
})

test('a busy machine stays under the svg cap', () => {
  const own = office(Array.from({ length: 12 }, (_, i) => agent(`a${i}`, { description: 'x'.repeat(60), lastCall: 'y'.repeat(40) })))
  const floors = Array.from({ length: 6 }, (_, i) => floor(i, 4))
  assert.ok(officeSvg({ own, floors, cols: 4, at: 1 }).length < SVG_LIMIT)
})

test('terminal rows list this floor and the others', () => {
  const own = reduce(office([agent('a', { costUsd: 4.2 })]), { kind: 'tick', at: 1 })
  const rows = terminalRows({ own, floors: [floor(1, 1)], cols: 4, at: 1 })
  assert.ok(rows[0].startsWith('Office · $'))
  assert.ok(rows.join('\n').includes('main session · idle'))
  assert.ok(rows.join('\n').includes('Task a · implementer · sonnet · working · $4.20 heavy · Bash npm test'))
  assert.ok(rows.join('\n').includes('worktree-1'))
})
