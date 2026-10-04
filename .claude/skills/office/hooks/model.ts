import type { Agent, Office } from '../types'

export const HEAVY_USD = 4
export const DONE_TTL_MS = 10 * 60 * 1000
export const SPEND_WINDOW_MS = 5 * 60 * 1000
export const MAIN_ID = 'main'
export const CALL_HISTORY = 30

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
  return { id, description, type, model, state, lastCall: '', costUsd: 0, startedAt: at, finishedAt: null, failKey: null, failCount: 0, calls: [], costByModel: {} }
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
    const next = patch(office, id, a => ({ ...a, model: ev.model, costUsd: a.costUsd + usd, costByModel: { ...(a.costByModel ?? {}), [ev.model]: ((a.costByModel ?? {})[ev.model] ?? 0) + usd }, state: a.state === 'idle' ? 'working' : a.state }))
    return { ...next, spend: [...next.spend, { at: ev.at, usd }], totalUsd: office.totalUsd + usd }
  }
  if (ev.kind === 'call') {
    const key = callKey(ev.tool, ev.input)
    return patch(office, id, a => {
      const failCount = ev.isError ? (a.failKey === key ? a.failCount + 1 : 1) : 0
      const label = callLabel(ev.tool, ev.input)
      const calls = [...(a.calls ?? []), { label, isError: ev.isError, at: ev.at }].slice(-CALL_HISTORY)
      return { ...a, lastCall: label, calls, failKey: ev.isError ? key : null, failCount, state: failCount >= 2 ? 'retrying' : 'working' }
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
