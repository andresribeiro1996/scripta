---
name: ship
description: Take finished work in a worktree to main — verify, commit, push, open or update the PR, merge once CI is green, and bring the main checkout up to date. Use when the user says commit, push, open a PR, merge it, "push it to main", or asks whether something is on main.
---

# Ship

Everything reaches `main` through a PR, including "push it to main" — never push to `main` directly. Only do the steps the user asked for: "commit this" stops at step 2, "push" at 3, "open a PR" at 4, "merge" goes through 6.

## 1. Verify

Run the Verify commands from the `AGENTS.md` of each package the branch touches (`git diff --name-only origin/main...HEAD` plus uncommitted files). Rebuild `@scripta/shared` first if `packages/` changed. Don't commit red.

## 2. Commit

Stage the files by name and commit in the same call — another session can sweep up staged files between calls. The body says why the change was needed; end with the attribution line from the session's instructions.

```bash
git add <files> && git commit -F - <<'EOF'
...
EOF
```

## 3. Push

```bash
git push -u origin HEAD
```

## 4. PR

`gh pr view --json number,url,state` — if there is none, `gh pr create --base main` with a short what/why body ending in the attribution line. Then call the `ccd_pr` `get_status` tool; if it doesn't report this PR, `bind_pr` it.

If the branch touches auth, tokens, OAuth, share links or visibility rules, run the `security-review` skill now and fix what it finds before merging. For a multi-task branch that hasn't had one, dispatch `branch-reviewer`.

## 5. Merge — only when the user asked

The repo uses merge commits.

```bash
gh pr merge <n> --merge --auto
```

`--auto` merges the moment required checks pass. If GitHub refuses because auto-merge is disabled on the repo: when `get_status` shows every check passing, run `gh pr merge <n> --merge`; otherwise enable the app's auto-merge with the `ccd_pr` `set_auto_merge` tool and tell the user it will merge when CI is green. Never poll CI yourself (`gh pr checks` loops, sleep, ScheduleWakeup) — the app reports check results.

If CI fails, dispatch `ci-fixer`.

## 6. After the merge

Bring the main checkout up to date so new worktrees and sessions there see the change. In its own call:

```bash
cd /Users/andreribeiro/Documents/scripta
```

then, only if `git status -sb` shows it on `main`:

```bash
git pull --ff-only origin main
```

Never stash, reset or check out anything there; if the pull refuses because of local changes, tell the user which files.

Backend and web deploy from `main` automatically. If the user wants to know it is live, dispatch `deploy-ops`. If they want it on their phone, `node scripts/dev-phone.mjs` from the worktree.

Report: the commit SHA, PR URL, merge state, and whether the main checkout was updated.
