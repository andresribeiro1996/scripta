# Rules

- Write the minimum code that works. Reuse existing code, patterns, and the stdlib before adding anything new. `@scripta/shared` exists so the three clients don't each grow their own copy of the same logic — look there before writing a helper.
- No speculative features, abstractions, or config options. YAGNI. An option is permanent: both branches need tests from then on, and this is one person's library app, not a product with users to justify the matrix.
- Don't simplify away validation, error handling, or security. The backend holds accounts, OAuth tokens and public share links, so a swallowed error is a silent one. Catch the specific failure you expect and let everything else propagate — a bare `catch { return null }` reports "permission denied" as "nothing there", and the caller reads that as success.
- Keep replies terse. Code and commands stay exact — they get pasted verbatim, and an approximated flag fails without saying whether the tool or the transcription was wrong.
- No comments in code unless asked. A comment restating the line under it goes stale the moment that line changes and nothing checks it; put the non-obvious *why* in the commit message, where it stays attached to the change that needed it.
- Dev servers, the emulator lease, and how concurrent agent sessions avoid stepping on each other (worktrees, `dev:link-deps`) are in [`docs/dev-workflow.md`](docs/dev-workflow.md) — read it before starting a dev server or a new agent session.
- Before optional emulator verification, run `node scripts/dev-status.mjs --json` once. If another worktree holds the emulator, skip the optional capture immediately; do not wait, retry, take the lease, start a second emulator, or recreate fixture data just for a screenshot.

# Project

Scripta — personal Kobo/Goodreads e-book library app. Each subdirectory has its own `AGENTS.md` (rules + verify commands) and `README.md` (architecture detail); read both before working there.

A new subdirectory `AGENTS.md` needs two things to reach every tool: a `CLAUDE.md` symlink beside it (`ln -s AGENTS.md <dir>/CLAUDE.md`), and an entry in `opencode.json`'s `instructions`. Codex finds it on its own.

Claude Code reads no `AGENTS.md` at any level, including this one — the root `CLAUDE.md` bridges it with an `@AGENTS.md` import on its first line. Don't delete that line: without it these rules reach Codex and opencode but never a Claude session, and nothing fails loudly.

The table below is generated from those files — edit each package's own `AGENTS.md`, then run `node scripts/sync-agent-table.mjs`. `npm run check:agents` verifies the table and both requirements above without writing.

| Dir | What | Commands |
|---|---|---|
<!-- BEGIN agent-table -->
| `backend/` | Fastify/TypeScript API, modular monolith | `npm run dev` / `typecheck` / `test` |
| `frontend/` | React/Vite/TypeScript + Tailwind, installable as a PWA | `npm run dev` / `typecheck` / `lint` / `test` |
| `mobile/` | Expo/React Native app | `npm run mobile` / `typecheck` / `test` / `expo-doctor` |
| `packages/` | `@scripta/shared` — the model and logic the web, mobile, and backend clients all reuse | `npm run build` |
| `exporter/` | Python stdlib script → `library.json` | `python3 export.py` |
| `viewer/` | Static single-file HTML | none |
<!-- END agent-table -->

Run `typecheck` and `lint` after changes in that package. Verify with tests before claiming done.
