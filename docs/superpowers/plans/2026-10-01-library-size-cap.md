# Library size cap of 10 MiB: implementation plan

> **For agentic workers:** implement task by task, verify each, commit each task separately. Steps use checkbox (`- [ ]`) syntax.

**Goal:** No library document over 10 MiB is stored, and a reader who hits
the limit is told why in plain words, on old and new clients alike.

**Spec:** `docs/superpowers/specs/2026-10-01-load-safety-design.md`,
workstream 4.

**Rules:** root `AGENTS.md` and each package's `AGENTS.md`. No code comments.
Verify with:

```
npm run build --workspace @scripta/shared
npm run typecheck --workspace backend && npm test --workspace backend
npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend
npm run typecheck --workspace mobile && npm test --workspace mobile
```

---

## Task 1: Lower the cap and say it plainly

**Files:** `backend/src/config/env.ts`, `backend/src/modules/library/routes.ts`,
`backend/src/modules/library/import/importChild.ts`, their tests,
`backend/README.md`.

- [ ] `LIBRARY_BODY_LIMIT_BYTES` default `26214400` → `10485760`. It also
  bounds import previews (`parseImport`'s `maxResultBytes`), which is intended.
- [ ] The 413 body for `PUT /library` keeps `code: "LIBRARY_BODY_TOO_LARGE"`
  and `maxBytes`, with `error`:
  `"Your library is over 10 MB, the most Scripta can store. Remove some books or highlights and try again."`
  Build the "10 MB" from `maxBytes` (whole MB) so the text follows the setting.
- [ ] The import child's "The import result is too large." becomes:
  `"This import is over 10 MB, the most Scripta can store. Import fewer books or highlights."`
  (same MB rule). Its status and code stay as they are.
- [ ] Update tests that assert the old messages; add one asserting the new
  `PUT /library` message names 10 MB with the default setting.
- [ ] `backend/README.md`: state the 10 MiB cap in the `library` section.

Both clients already surface the server's `error` text through their
`ApiError` (`frontend/src/api/client.ts`, `mobile/src/core/apiClient.ts`), so
a better message reaches installed builds wherever they display it.

## Task 2: Make sure each client shows that message

**Files:** wherever a library save or import failure is shown, found from
`frontend/src/hooks/useLibrary.ts`, `frontend/src/lib/saveLibraryUpdate.ts`,
`frontend/src/pages/LibraryPage.tsx` and the import flow on web, and
`mobile/src/features/library/hooks/useLibrary.ts` and the mobile import flow.

- [ ] For a failed save and a failed import preview, check whether the UI
  shows `error.message`. Where it already does, change nothing.
- [ ] Where it shows a generic text instead, show `error.message` for status
  `413` and for code `INVALID_IMPORT`, keeping the generic text for other
  failures.
- [ ] Report, per client, what was already fine and what changed.

## Gates before merging (reported, not done by the implementer)

1. Production has no stored library over 10 MiB. The user runs:
   ```
   railway ssh -- node -e 'const { DatabaseSync } = require("node:sqlite"); console.table(new DatabaseSync("/data/library.sqlite", { readOnly: true }).prepare("SELECT length(data) AS chars FROM library_documents ORDER BY chars DESC LIMIT 5").all())'
   ```
2. `LIBRARY_BODY_LIMIT_BYTES` is not set in Railway's service variables (if it
   is, it overrides the new default).

## Done when

- Both tasks committed; every verify command passes.
- Report test counts and the Task 2 findings; leave both gates open.
