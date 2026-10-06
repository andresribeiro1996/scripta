# office

A Claude Code mod that draws every live session on this machine as a pixel
office: one desk per agent, its state, its last call and its API-equivalent
spend. It only watches; it never blocks or changes anything, and it uses no
model tokens.

A toast appears when a subagent passes $4.

Open it with `/office` in any session in this repo.

Sessions share state through `$HOME/.claude/office/<sessionId>.json`. Ended
sessions' files are left there; they are ignored once three minutes old.

## Tests

    claude plugin validate .claude/skills/office
    node --test '.claude/skills/office/tests/*.test.ts'

The tests use Node's runner because the tested modules don't need the engine.
CI does not run these.

Spec: `docs/superpowers/specs/2026-10-04-agent-office-view-design.md`.
