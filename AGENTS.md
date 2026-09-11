# Rules

- Write the minimum code that works. Reuse existing code, patterns, and the stdlib before adding anything new.
- No speculative features, abstractions, or config options. YAGNI.
- Don't simplify away validation, error handling, or security.
- Keep replies terse. Code and commands stay exact.
- No comments in code unless asked.

# Project

Scripta — personal Kobo/Goodreads e-book library app. Each subdirectory has its own `AGENTS.md` (rules + verify commands) and `README.md` (architecture detail); read both before working there.

| Dir | What | Commands |
|---|---|---|
| `backend/` | Fastify/TS API, modular monolith | `npm run dev` / `typecheck` / `test` |
| `frontend/` | React/Vite/TS + Tailwind, PWA | `npm run dev` / `lint` (oxlint) / `typecheck` / `test` |
| `packages/shared` | Model and logic reused by every client | `npm run build` |
| `mobile/` | Expo/React Native + Expo Router | `npm run mobile` / `typecheck` / `test` / `expo-doctor` |
| `exporter/` | Python stdlib script → `library.json` | `python3 export.py` |
| `viewer/` | Static single-file HTML | none |

Run `typecheck` and `lint` after changes in that package. Verify with tests before claiming done.
