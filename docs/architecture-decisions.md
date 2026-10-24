# Architecture decisions

Refactors that were considered and rejected, so a later review doesn't raise them again without new evidence.

## Tier-list editor state stays in each client (2026-10-24)

Moving the editor's taken-books, frozen, dirty and add-to-pool rules into `@scripta/shared` was rejected. Each rule is a one-line expression, so a shared module would be as wide as what it hides. Move-book is a different algorithm on web (swap and before-key insertion) and mobile (append), and only mobile has a draft to be dirty. Revisit if the editors grow shared rules beyond one-liners.

## Mural edit history stays per client (2026-10-24)

Web autosaves every edit and keeps server-checked `{before, after}` layout steps; mobile edits a local draft and keeps snapshots until an explicit Save. Only the 20-step cap is common. Unifying them waits on the product choice between autosave and explicit Save.
