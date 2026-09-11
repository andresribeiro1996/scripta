# Frontend

React/Vite/TypeScript + Tailwind, installable as a PWA. Read `README.md` before changing it.

## Commands

- Run: `npm run dev --workspace frontend`
- Verify: `npm run build --workspace @scripta/shared`
- Verify: `npm run typecheck --workspace frontend`
- Verify: `npm run lint --workspace frontend` (oxlint)
- Verify: `npm test --workspace frontend`

## Rules

- Put logic shared with the mobile client in `@scripta/shared`; do not duplicate it.
- Style tests live in `scripts/test-*.mts` and assert real resolved layout — fix the CSS, not the assertion.
