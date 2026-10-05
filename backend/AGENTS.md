# Backend

Fastify/TypeScript API, modular monolith. Read `README.md` before changing it.

## Commands

- Run: `npm run dev --workspace backend`
- Verify: `npm run build --workspace @scripta/shared`
- Verify: `npm run typecheck --workspace backend`
- Verify: `npm test --workspace backend`

## Rules

- One module per domain under `src/modules/<domain>/`; keep routes, service, and adapters inside it.
- Put logic shared with the web or mobile client in `@scripta/shared`; do not duplicate it.
- `npm test` names its test files explicitly — add new `*.test.ts` files to that list or CI will not run them.
- Never weaken auth, import validation, or error handling to make a test pass.
- A new `*_DB_PATH` must be under `/data` and listed in `litestream.yml`, or the deploy fails at boot.
- A new Railway variable also goes in `.railway/railway.ts` as `NAME: preserve()`. `railway config apply` deletes any variable that file doesn't list.
- **Installed apps can't be updated from here.** The backend deploys from `main` automatically, but mobile builds stay on phones for weeks and open web tabs keep old code. Keep API changes additive: anything an older client can't handle (a new row kind, a new required field) is opt-in through a parameter the client sends, as the dashboard's `kinds` is, and a route or field an installed build still uses is never removed.
