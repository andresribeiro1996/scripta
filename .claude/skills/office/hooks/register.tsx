import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Snapshot } from '../types'
import { emptyOffice, reduce, statusText, type OfficeEvent } from './model.ts'
import { freshFiles, parseFloors, shouldWrite, snapshotOf } from './floors.ts'
import { officeSvg, terminalRows } from './svg.ts'

const PANE = 'office'
const officeAtom = atom({ plugin: 'office', key: 'office' } as const, emptyOffice(0))
const floorsAtom = atom({ plugin: 'office', key: 'floors' } as const, [] as Snapshot[])
const reported = new Set<string>()
let dirty = true
const failures = new Set<string>()
let beating = false
let reading = false
let lastWriteAt = 0

async function dirOf($: any): Promise<string> {
  const home = await $.env.get('HOME')
  if (!home) throw new Error('office: HOME is not set')
  return `${home}/.claude/office`
}

async function guard($: any, label: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    const key = `${label}: ${err instanceof Error ? err.message : String(err)}`
    if (failures.has(key)) return
    failures.add(key)
    $.ui.log(`office: ${key}`, { to: 'debug' })
  }
}

async function apply($: any, ev: OfficeEvent) {
  await update($, officeAtom, o => reduce(o, ev))
  dirty = true
  $.ui.status(statusText(await read($, officeAtom)))
}

async function writeSnapshot($: any, ended: boolean) {
  const at = await $.clock.now()
  const snap = snapshotOf(await $.session.id(), await $.session.root(), await read($, officeAtom), at, ended)
  await $.fs.write(`${await dirOf($)}/${snap.sessionId}.json`, JSON.stringify(snap))
  lastWriteAt = at
  dirty = false
}

async function beat($: any) {
  const at = await $.clock.now()
  await update($, officeAtom, o => reduce(o, { kind: 'tick', at }))
  if (shouldWrite(lastWriteAt, dirty, at)) await writeSnapshot($, false)
}

async function readFloors($: any) {
  const dir = await dirOf($)
  if (!(await $.fs.exists(dir))) return
  const names = freshFiles(await $.fs.list(dir), await $.session.id(), await $.clock.now())
  const files = await Promise.all(names.map(async name => ({ name, text: await $.fs.read(`${dir}/${name}`) })))
  const { floors, bad } = parseFloors(files)
  for (const name of bad) {
    if (reported.has(name)) continue
    reported.add(name)
    $.ui.log(`office: skipped unreadable snapshot ${name}`, { to: 'debug' })
  }
  await update($, floorsAtom, () => floors)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: "Show this machine's agents as an office" })
    const at = await $.clock.now()
    await update($, officeAtom, o => (o.agents[0].startedAt === 0 ? emptyOffice(at) : o))
    $.clock.every(1000, () => {
      if (beating) return
      beating = true
      void guard($, 'beat', () => beat($)).finally(() => { beating = false })
    })
    $.clock.every(2000, () => {
      if (reading) return
      reading = true
      void guard($, 'readFloors', () => readFloors($)).finally(() => { reading = false })
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const r = await next(e)
    await guard($, 'session.end', () => writeSnapshot($, true))
    return r
  })

  on('command.run', { command: 'office' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Office' })
    return { text: 'Office opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const r: any = await next(e)
    await guard($, 'agent.spawn', async () => {
      if (typeof r?.agentId === 'string') {
        await apply($, {
          kind: 'spawn',
          agentId: r.agentId,
          description: e.description ?? '',
          type: e.subagentType ?? 'general-purpose',
          model: r.model ?? '',
          at: await $.clock.now(),
        })
      }
    })
    return r
  })

  on('tool.call', async ($, e, next) => {
    const r: any = await next(e)
    await guard($, 'tool.call', async () => {
      const { tool, tool_use_id: _id, agentId, ...input } = e as any
      await apply($, {
        kind: 'call',
        agentId: agentId ?? null,
        tool,
        input,
        isError: r?.isError === true && r?.deny === undefined,
        at: await $.clock.now(),
      })
    })
    return r
  })

  on('turn.step', async function* ($, e, next) {
    const r: any = yield* next(e)
    await guard($, 'turn.step', async () => {
      if (r?.usage) {
        await apply($, { kind: 'step', agentId: (e as any).agentId ?? null, model: r.usage.model ?? '', usage: r.usage, at: await $.clock.now() })
      }
    })
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await guard($, 'turn.complete', async () => { await apply($, { kind: 'complete', agentId: e.agentId ?? null, at: await $.clock.now() }) })
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = {
      own: await read($, officeAtom),
      floors: await read($, floorsAtom),
      cols: Math.max(1, Math.min(6, Math.floor(((e.props as any)?.bodyColumns ?? 80) / 20))),
      at: await $.clock.now(),
    }
    const rows = terminalRows(view)
    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      return <Svg source={officeSvg(view)} alt={rows.join('\n')} isInteractive={true} />
    }
    const { Box, Text } = $.ui.resolve(e)
    return <Box flexDirection="column">{rows.map(line => <Text>{line}</Text>)}</Box>
  })
}
