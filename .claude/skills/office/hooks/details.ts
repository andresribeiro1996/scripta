import type { Agent } from '../types'
import { modelShort } from './model.ts'

const pad = (n: number) => String(n).padStart(2, '0')
const usd = (n: number) => `$${n.toFixed(2)}`

function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function buttonLabel(agent: Agent, open: boolean): string {
  return `${open ? '▾' : '▸'} ${agent.description}`
}

export function detailRows(agent: Agent, at: number): string[] {
  const { calls = [], costByModel = {} } = agent as Partial<Agent>
  const models = Object.entries(costByModel).sort((a, b) => b[1] - a[1])
  const spend = [agent.type, ...models.map(([m, c]) => `${modelShort(m)} ${usd(c)}`)]
  if (models.length > 1) spend.push(`total ${usd(agent.costUsd)}`)
  const start = new Date(agent.startedAt)
  const clock = `${pad(start.getHours())}:${pad(start.getMinutes())}:${pad(start.getSeconds())}`
  const time = agent.finishedAt === null ? `running ${duration(at - agent.startedAt)}` : `took ${duration(agent.finishedAt - agent.startedAt)}`
  const failed = calls.filter(c => c.isError).length
  return [
    agent.description,
    spend.join(' · '),
    `started ${clock} · ${time}`,
    `${calls.length} calls · ${failed} failed`,
    ...[...calls].reverse().map(c => `${c.isError ? '✗' : '·'} ${c.label}`),
  ]
}
