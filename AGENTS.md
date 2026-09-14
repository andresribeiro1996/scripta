# Rules

- Write the minimum code that works. Reuse existing code, patterns, and the stdlib before adding anything new.
- No speculative features, abstractions, or config options. YAGNI.
- Don't simplify away validation, error handling, or security.
- Keep replies terse. Code and commands stay exact.
- No comments in code unless asked.
- Dev servers: run `node scripts/dev-emulator.mjs` (claims this worktree's port slot) and `npm run dev:release` when done. Never hardcode 3000/8081/5173, and never kill another worktree's process to free a port.
- The emulator is leased, two at a time. Take one only to verify a change that must be rendered — layout, navigation, touch behaviour, animation, native modules. Not for backend, shared-package, type or refactor work. Write, typecheck and test with no device, then take the lease for one verification pass at the end.

# Project

Scripta — personal Kobo/Goodreads e-book library app. Each subdirectory has its own `AGENTS.md` (rules + verify commands) and `README.md` (architecture detail); read both before working there.

A new subdirectory `AGENTS.md` needs two things to reach every tool: a `CLAUDE.md` symlink beside it (`ln -s AGENTS.md <dir>/CLAUDE.md`), and an entry in `opencode.json`'s `instructions`. Codex finds it on its own.

| Dir | What | Commands |
|---|---|---|
| `backend/` | Fastify/TS API, modular monolith | `npm run dev` / `typecheck` / `test` |
| `frontend/` | React/Vite/TS + Tailwind, PWA | `npm run dev` / `lint` (oxlint) / `typecheck` / `test` |
| `packages/shared` | Model and logic reused by every client | `npm run build` |
| `mobile/` | Expo/React Native + Expo Router | `npm run mobile` / `typecheck` / `test` / `expo-doctor` |
| `exporter/` | Python stdlib script → `library.json` | `python3 export.py` |
| `viewer/` | Static single-file HTML | none |

Run `typecheck` and `lint` after changes in that package. Verify with tests before claiming done.
