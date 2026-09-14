# Shared packages

`@scripta/shared` — the model and logic the web, mobile, and backend clients all reuse.

## Commands

- Verify: `npm run build --workspace @scripta/shared`
- Consumers read `dist/`, so rebuild before running any consumer's typecheck or tests.

## Rules

- Only put code here when more than one consumer needs it. No platform-specific imports — no React, no React Native, no Node-only APIs.
- Adding an entry point means adding it to the `exports` map in `package.json`.
