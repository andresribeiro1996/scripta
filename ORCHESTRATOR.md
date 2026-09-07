# Orchestrator handoff kit — Scripta mobile migration

For whoever (or whatever) holds the integration-owner role next. Read AGENTS.md, 2026-09-06-parallel-mobile-migration.md (the plan), and /tmp task-state.md first. This file is mechanics only.

## Current role assignment
- Integration owner / orchestrator: was OpenCode+GLM; succession by product-owner decision (recorded in plan). May be Codex (`codex exec --sandbox danger-full-access`) or Claude (`claude -p ... --permission-mode acceptEdits --allowedTools ...`) — both have executed tasks here successfully.
- Standing gates: auth / import-security / destructive-data work is merge-blocked on an opus-tier (or product-owner-waived substitute) review. The takeover rule and permission policy live in the plan — follow them, including for yourself.

## Dispatch mechanics (hard-won)
- Packets live in /var/folders/hr/zv5_wpss0ln6nmbrj1z719g00000gn/T/opencode/task-*-packet.md — copy the pattern: goal, files owned, forbidden list, exact verify commands, known baseline, handoff format.
- ALWAYS run the agent with its workdir set to the correct worktree. (An orchestrator once launched codex from the main checkout by mistake: the agent's whole task landed uncommitted in the integration tree and had to be rescued via `git stash push -u -- mobile/` → apply on the right branch.)
- Claude: `nohup claude -p "$(cat packet)" --permission-mode acceptEdits --allowedTools 'Bash(npm run *)' 'Bash(git add:*)' ... > log 2>&1 &`. It CAN commit in worktrees.
- Codex: `nohup codex exec --sandbox workspace-write --skip-git-repo-check "$(cat packet)" > log 2>&1 &`. It CANNOT commit in linked worktrees (sandbox blocks .git writes) — instruct it to leave work verified-but-uncommitted; the orchestrator reviews and commits.
- Codex sandbox also EPERMs: dev-server listens (tell agents never to run vite/expo start), tsx's IPC socket (tests via `node --import tsx --test <files>` equivalent; orchestrator re-runs the real npm scripts).
- Codex `exec resume` breaks after a crashed session (thread-store zombie writers) — after any crash, dispatch a FRESH session with a catch-up packet instead.
- Claude session limit (resets 5h): standing takeover rule applies — any free agent continues a quota-dead task IF the packet carries explicit boundaries; merge gates do not transfer.

## Verify → commit → merge loop
1. In the finished worktree: `git checkout -q -- package-lock.json` if npm install dirtied it (unless deps legitimately changed — then keep and commit at INTEGRATION time, not on the task branch).
2. Run the exact gate commands yourself (never trust the handoff's claimed results): shared build → backend typecheck+test → frontend typecheck+lint+test → mobile typecheck.
3. Baseline (never attribute to a branch): frontend fails ONLY scripts/test-library-style.mts §14 (2 columns of 156.0px). Backend is fully green at integration.
4. Commit codex's work yourself, attributing authorship in the message.
5. Merge one branch at a time into mobile-migration (`git merge --no-ff`). Same-line conflicts on backend test script = union of file lists. After merging anything that adds mobile/src/app routes: kill any Metro on 8081, run `CI=1 npx expo start` ~25s to regenerate typed routes, kill it, THEN mobile typecheck or it fails on stale route types.
6. After merges: `npm install` at root; re-run full gates; update the plan's wave status note + task-state.md; publish the next base commit BEFORE any parallel round branches (env keys and package deps land in the base, never on task branches).

## State files
- /var/folders/hr/zv5_wpss0ln6nmbrj1z719g00000gn/T/opencode/task-state.md — running/queued/merged, watchouts. Update it every checkpoint.
- Logs: /var/folders/hr/zv5_wpss0ln6nmbrj1z719g00000gn/T/opencode/*.log (task-*, fix-*, retro-*).
- Backend dev server (demo account demo@demo.com / demo1234) and Metro for the user's phone are launched on demand; Metro needs EXPO_PUBLIC_API_URL=http://<lan-ip>:3000.

## Queue at time of writing
- running: fix-4a (web OAuth injection blocker + auth should-fixes), fix-4b (import hardening), 5B NOT STARTED (owner: whoever is free; packet = plan Task 5B + mobile/src/features/{gallery,settings,socials})
- unmerged: 5A (mobile/5a-library @ 922b2c52), 5C (mobile/5c-arena-tierlists @ 1df41e29, round-2 gaps: book-picker search/filter; login return-destination for /vote/:code is a CENTRAL change = orchestrator's)
- then: 5D (murals, after 5C contracts), 5E (public routes, orchestrator's per plan), wave gate (enumerate App.tsx routes from the tree), Wave 4/5 per plan
