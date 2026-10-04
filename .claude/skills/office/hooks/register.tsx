import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: "Show this machine's agents as an office" })
    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    await $.ui.open({ id: 'office', title: 'Office' })
    return { text: 'Office opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: 'office' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Office: not wired yet.</Text>
  })
}
