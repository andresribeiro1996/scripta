export type AgentState = 'working' | 'retrying' | 'idle' | 'done'

export type CallRecord = { label: string; isError: boolean; at: number }

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
  calls: CallRecord[]
  costByModel: Record<string, number>
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
    office: { office: Office; floors: Snapshot[]; open: string | null }
  }
}
