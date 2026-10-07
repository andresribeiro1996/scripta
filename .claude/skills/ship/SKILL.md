---
name: ship
description: Take finished work in a worktree to main — verify, commit, push, open or update the PR with auto-merge on so it lands once CI is green, bring the main checkout up to date, and deploy to production when asked. Use when the user says commit, push, open a PR, merge it, deploy, "push it to main", or asks whether something is on main or live.
---

# Ship

Everything reaches `main` through a PR, including "push it to main" — never push to `main` directly. Only do the steps the user asked for: "commit this" stops at step 2, "push" at 3. "Open a PR", "merge", "ship" and "push it to main" all go through 6: every PR gets auto-merge, so it lands by itself when CI is green and nobody has to ask for the merge. Stop at step 4 only when the user says not to merge or asks for a draft. Merging never deploys; step 7 runs only when the user asks to deploy.

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

## 5. Auto-merge

Enable it as soon as the PR exists, without waiting to be asked. The required `checks` run is the gate. The repo uses merge commits.

```bash
gh pr merge <n> --merge --auto
```

`--auto` merges the moment required checks pass. If GitHub refuses because auto-merge is disabled on the repo: when `get_status` shows every check passing, run `gh pr merge <n> --merge`; otherwise enable the app's auto-merge with the `ccd_pr` `set_auto_merge` tool and tell the user it will merge when CI is green. Never poll CI yourself (`gh pr checks` loops, sleep, ScheduleWakeup) — the app reports check results.

If CI fails, dispatch `ci-fixer`. A PR that is only behind `main` still merges. When it conflicts, run the `sync_with_base_branch` tool (or merge `origin/main`), resolve, verify and push. A stacked PR whose base is not `main` gets auto-merge only once it is retargeted to `main`.

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

If the user wants it on their phone before a deploy, `node scripts/dev-phone.mjs` from the worktree.

## 7. Deploy — only when the user asks

Merging does not deploy. The backend (Railway), the web app (Cloudflare Pages) and the phone OTA update all deploy from the `production` branch, and only the Deploy workflow moves it:

```bash
gh workflow run deploy.yml
```

It deploys the newest `main` commit whose CI passed (`-f sha=<sha>` picks one), refuses anything not on `main` or not green, and lists the commits going out in the run summary. Never push to `production` any other way. "Deploy" means only this workflow: backend, web and the over-the-air JavaScript update. "Release" means a deploy followed by an Android store build of `production` (see `mobile/AGENTS.md`): run the Deploy workflow, wait for it to succeed, then start the build. A deploy never starts a build. Migrations run when the backend boots, so one deploy runs every migration merged since the last. If the user wants to know it is live, dispatch `deploy-ops`.

Report: the commit SHA, PR URL, merge state, whether the main checkout was updated, and, after a deploy, the Deploy run URL.
