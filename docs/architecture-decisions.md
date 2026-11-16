# Architecture decisions

Refactors that were considered and rejected, so a later review doesn't raise them again without new evidence.

## Tier-list editor state stays in each client (2026-10-24)

Moving the editor's taken-books, frozen, dirty and add-to-pool rules into `@scripta/shared` was rejected. Each rule is a one-line expression, so a shared module would be as wide as what it hides. Move-book is a different algorithm on web (swap and before-key insertion) and mobile (append), and only mobile has a draft to be dirty. Revisit if the editors grow shared rules beyond one-liners.

## Mural edit history stays per client (2026-10-24)

Web autosaves every edit and keeps server-checked `{before, after}` layout steps; mobile edits a local draft and keeps snapshots until an explicit Save. Only the 20-step cap is common. Unifying them waits on the product choice between autosave and explicit Save.

## Mural cleanup on book delete stays in each client (2026-11-16)

Moving the scrub of deleted books from murals into the server's library save was rejected. Both clients already scrub: mobile right after the delete (`useMurals.ts`), web after its 6.5 s undo window. A server scrub would cost web's undo of mural blocks, can't be atomic because murals live in a separate database, and would have to decide what an import that drops books means. The gaps left are web's scrub never running if the tab closes inside the undo window, and mobile's scrub PUT failing with a 409 when the mural changed elsewhere. Revisit if either gap leaves stale blocks in practice.
