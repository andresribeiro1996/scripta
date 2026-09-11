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
