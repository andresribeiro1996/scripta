import type { Office, Snapshot } from '../types'

export const STALE_MS = 3 * 60 * 1000
export const WRITE_MIN_MS = 1000
export const REFRESH_MS = 60 * 1000

export function snapshotOf(sessionId: string, root: string, office: Office, at: number, ended: boolean): Snapshot {
  const worktree = root.split('/').filter(Boolean).pop() ?? root
  return { sessionId, worktree, updatedAt: at, ended, agents: office.agents.map(a => ({ ...a, failKey: null, calls: [] })) }
}

export function shouldWrite(lastWriteAt: number, dirty: boolean, at: number): boolean {
  return at - lastWriteAt >= (dirty ? WRITE_MIN_MS : REFRESH_MS)
}

export function freshFiles(listed: { name: string; mtimeMs: number }[], selfId: string, at: number): string[] {
  return listed
    .filter(f => f.name.endsWith('.json') && f.name !== `${selfId}.json` && at - f.mtimeMs < STALE_MS)
    .map(f => f.name)
}

const AGENT_STRINGS = ['id', 'description', 'type', 'model', 'state', 'lastCall']

function isAgent(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>
  return AGENT_STRINGS.every(k => typeof a[k] === 'string') && Number.isFinite(a.costUsd)
}

function isSnapshot(v: unknown): v is Snapshot {
  const s = v as Snapshot
  return typeof s === 'object' && s !== null && typeof s.sessionId === 'string' && typeof s.worktree === 'string' &&
    typeof s.updatedAt === 'number' && typeof s.ended === 'boolean' && Array.isArray(s.agents) && s.agents.every(isAgent)
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

export function sameFloors(a: Snapshot[], b: Snapshot[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
