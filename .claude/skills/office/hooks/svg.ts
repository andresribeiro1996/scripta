import type { Agent, Office, Snapshot } from '../types'
import { HEAVY_USD, isHeavy, MAIN_ID, modelShort, spendPerMinute } from './model.ts'
import { type Frame, SPRITE_KEYS, spriteFrame, spriteKeyOf } from './sprites.ts'

export type View = { own: Office; floors: Snapshot[]; cols: number; at: number }

export const SVG_LIMIT = 131072

const PAD = 10
const CELL_W = 160
const CELL_H = 180
const HEADER_H = 30
const STRIP_H = 84
const MINI_W = 90
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
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string)
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
  parts.push(text(x + 8, y + 122, cut(agent.description, 22), `fill="${INK}"`))
  parts.push(text(x + 8, y + 136, agent.id === MAIN_ID ? `boss · ${modelShort(agent.model)}` : `${agent.type} · ${modelShort(agent.model)}`, `fill="#5b5b66"`))
  parts.push(text(x + 8, y + 150, cut(agent.lastCall, 22), `fill="#5b5b66"`))
  parts.push(spendBar(agent, x + 8, y + 156, 140))
  if (agent.state === 'done') parts.push('</g>')
  return parts.join('')
}

function strip(snap: Snapshot, y: number, width: number): string {
  const main = snap.agents.find(a => a.id === MAIN_ID)
  const subs = snap.agents.filter(a => a.id !== MAIN_ID)
  const parts = [
    `<rect x="${PAD}" y="${y}" width="${width - 2 * PAD}" height="${STRIP_H - 8}" rx="6" fill="#efe7d6" stroke="${GRID}"/>`,
    text(PAD + 8, y + 16, `${cut(snap.worktree, 40)} · main ${main?.state ?? 'idle'}`, `font-weight="bold" fill="${INK}"`),
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
