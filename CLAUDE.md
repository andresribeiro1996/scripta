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
| Branch touches auth, tokens, OAuth, share links or who can see what | run the `security-review` skill before merge |
| User says commit / push / merge / "is it on main?" | the `ship` skill |

When a skill says to dispatch an implementer, spec reviewer or code reviewer, use these agents instead of `general-purpose`. A device pass, including one bundled with a task's "verify", always goes to `device-checker`, never `general-purpose`. A task that failed twice on Sonnet is escalated to Opus, not retried a third time.

# Shell

- Search with `rg`, not `grep --include=*.tsx`: zsh expands the unquoted glob first and the command dies with "no matches found".
- Run git from the worktree root. `git -C <dir>` and `cd <dir> && git …` can trigger approval prompts.
