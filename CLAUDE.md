@AGENTS.md

# Subagents

The main session plans, designs and reviews; routine work goes to the saved agents in `.claude/agents/`. Dispatch by `subagent_type` and pass only what is task-specific — each agent already carries the repo rules.

| When | Agent |
|---|---|
| Codebase fact-finding before a spec or plan | `Explore`, `model: "sonnet"` |
| Implementing a plan task | `implementer` |
| After each task: does it match the spec? | `spec-reviewer` |
| After spec passes: bugs and repo rules | `quality-reviewer` |
| Once per branch before merge, or a plan before coding | `branch-reviewer` |
| Rendered mobile change needs a device pass | `device-checker` |
| User wants emulator screenshots | `device-checker`, capture-only, `model: "haiku"`; send the PNGs with SendUserFile without reading them |
| Failing CI on a PR, or a `<ci-monitor-event>` | `ci-fixer` |
| Production, Railway, Cloudflare, Litestream, EAS | `deploy-ops` |

When a skill says to dispatch an implementer, spec reviewer or code reviewer, use these agents instead of `general-purpose`. A task that failed twice on Sonnet is escalated to Opus, not retried a third time.

<!-- rtk-instructions v2 -->
# Command output

Command output here is condensed to save tokens, keeping every signal and
dropping costly noise. Treat it as the complete result: run commands
normally, and batch related commands into one call to avoid extra turns.
Truncated results state their recovery path in their own output. Re-run a
command as `rtk proxy <cmd>` only when its result is unusable: empty when
output was clearly expected, contradicting its exit code, or garbled.
<!-- /rtk-instructions -->
