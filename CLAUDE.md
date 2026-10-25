@AGENTS.md

# Subagents

The main session plans, designs and reviews; routine work goes to the saved agents in `.claude/agents/`. Dispatch by `subagent_type` and pass only what is task-specific — each agent already carries the repo rules.

| When | Agent |
|---|---|
| Codebase fact-finding before a spec or plan | `Explore`, `model: "sonnet"`; ask for a report under ~600 words where every claim cites `path:line`, with open technical questions kept apart from decisions only the user can make |
| Implementing a plan task | `implementer` |
| After each task: does it match the spec? | `spec-reviewer` |
| After spec passes: bugs and repo rules | `quality-reviewer` |
| A plan is written, before the fresh-session handoff | `branch-reviewer` on the spec and plan; fix the plan from its report, then commit. Each task's Files list has one backticked path per `- Create:`/`- Modify:`/`- Test:`/`- Delete:` line — the gate reads it |
| Once per branch before merge | `branch-reviewer` with the spec and plan, and `node scripts/codex-review.mjs branch <spec> <plan>` in the background, in parallel |
| Rendered mobile change needs a device pass | `device-checker` |
| User wants emulator screenshots | `device-checker`, capture-only, `model: "haiku"`; send the PNGs with SendUserFile without reading them |
| User explicitly asks for a beta test or UX sweep of the app — never otherwise, and never to verify a change | `beta-tester`; the main session evaluates `$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/beta-tests/<YYYY-MM-DD-HHMM>/` and passes its own worktree path and the absolute output dir; send its `report.md` with SendUserFile, then triage it with the user |
| User explicitly asks for a site UI review, a web UX sweep, or site-vs-app gaps — never otherwise, and never to verify a change | `site-ui-reviewer`; the main session passes its own worktree path and the absolute output dir `$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/ui-reviews/<YYYY-MM-DD-HHMM>/`; send its `report.md` with SendUserFile, then triage it with the user |
| Failing CI on a PR, or a `<ci-monitor-event>` | `ci-fixer` |
| Production, Railway, Cloudflare, Litestream, EAS | `deploy-ops` |
| Branch touches auth, tokens, OAuth, share links or who can see what | run the `security-review` skill before merge |
| User says commit / push / merge / deploy / "is it on main?" / "is it live?" | the `ship` skill |

When a skill says to dispatch an implementer, spec reviewer or code reviewer, use these agents instead of `general-purpose`. A device pass, including one bundled with a task's "verify", always goes to `device-checker`, never `general-purpose`. A task that failed twice on Sonnet is escalated to Opus, not retried a third time. A task gets at most 3 implement → review rounds, the first implementation included — this replaces the 5-round fix loop in subagent-driven-development; then the user chooses to rescope, re-plan or drop it. A finding both pre-merge reviews raise is presumed real; one raised by only one of them is checked in the code before acting on it. A `CODEX: ERROR` report means the second review didn't run — tell the user; never read it as a pass.

# Shell

- Search with `rg`, not `grep --include=*.tsx`: zsh expands the unquoted glob first and the command dies with "no matches found".
- Run git from the worktree root. `git -C <dir>` and `cd <dir> && git …` can trigger approval prompts.
