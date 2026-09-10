# Mural-powered home

Status: planned; implementation has not started.

## Outcome and scope

Home provides a small, consistent frame around a user-selected mural. The frame offers library search, Add book, Import, and Edit home. The mural supplies the personal content and remains editable through the existing mural editor.

Deliver on Expo mobile and the web client, with shared content rules in `@scripta/shared`. Build and verify the mobile experience first, then complete web parity before calling the feature done.

The first version includes:

- A persistent, account-owned home mural selection and an editable starter mural.
- Useful book, collection, quote, and tier-list navigation from mural view mode.
- Shelves that follow an existing collection, alongside existing hand-picked shelves.
- Quote spotlights that can rediscover a saved passage, alongside existing pinned quotes.
- Appropriate empty, loading, unavailable, and save-conflict states.

Automatic recent/top-rated shelves, shortcut blocks, goals, and other extensions are tracked in [the postponed-work note](2026-09-09-mural-home-postponed.md).

## Verified starting points

- `packages/shared/src/murals/murals.ts` defines ten block types, the canonical `{x,y,w,h}` layout, and reference resolvers. Shelves currently store explicit book keys; quotes store explicit book/highlight references.
- `packages/shared/src/murals/presets.ts` creates three editable compositions from a one-time book selection. Currently-reading and stats blocks derive their content from current library data.
- Murals are separate backend documents under `/murals`; do not follow the stale comment in the shared model that describes library-embedded storage.
- `mobile/src/app/(app)/(library)/index.tsx` currently owns `/`; `mobile/src/app/dashboard/index.tsx` redirects there. Web `/dashboard` currently renders Library.
- `mobile/src/features/murals/MuralCanvas.tsx` preserves freeform coordinates, but several native book blocks render primarily text and taps currently delegate to block selection.
- `backend/src/modules/murals/domain/blockRefs.ts`, the mural public route, and `backend/src/modules/library/publicResolver.ts` control public reference resolution and redaction. Dynamic content must respect these boundaries.
- Goodreads and StoryGraph importers can represent reviews inside the highlights structure and generate placeholder progress. A numeric percentage alone is not evidence of measured reading progress.

Recheck these files and the applicable READMEs/AGENTS.md before implementation; this is a September 9 checkout snapshot.

## Product contract

### Frame and navigation

- Home is the signed-in landing destination; Library remains a distinct destination.
- On mobile, use Home, Library, Arena, Murals, Settings in the tab shell. Move the library index to `/library`; preserve existing book, series, collection, import, and sharing links.
- On web, use `/dashboard` for Home and `/dashboard/library` for Library. Audit every existing `/dashboard` link: book-detail back navigation must still return to Library, while login should land on Home.
- Search reuses the existing library search flow and opens Library with the query applied; no second search engine.
- On phones, Add book and Import can share an Add menu. Edit home opens the existing editor. The mural-selection action is available through Home's menu and “Set as home” on an owned mural.
- Setting a mural as home does not copy it, publish it, or change its sharing status. Editing it anywhere changes the same document.

### Starter mural

Create one ordinary private mural named “My reading space” through an explicit “Create my home” action. Existing users may choose a mural instead. Do not write data merely because Home rendered.

The starter uses a fixed freeform arrangement with intentional gaps:

| Block | Initial content |
|---|---|
| Currently reading | Current reading-status selection; the main visual anchor |
| Up next shelf | Empty hand-picked shelf with a choose-books/connect-collection prompt |
| Rediscover a passage | Include only when eligible book passages exist at creation |
| Text | A small editable “My reading space” heading/note |

Do not populate Up next from arbitrary unread books or infer a collection from its name. Let the user choose the collection. No stats or goals in the starter.

If the library is empty, lead with Import/Add book plus the option to create or choose a mural. A home created before import remains the same mural afterward. Subsequent imports never regenerate blocks or overwrite composition/content choices.

### Everyday interaction

- View mode: a book opens existing book details; a collection shelf title opens its collection; a quote opens its readable passage/context; a tier list opens its existing destination.
- Where covers or text are too small to tap comfortably, open an existing-style block detail sheet with readable content and actions. Do not shrink touch targets to preserve density.
- Edit mode retains explicit selection, configuration, dragging/resizing, and existing save/conflict behavior. Navigation actions must not compete with editing gestures.
- Dynamic updates replace content inside assigned bounds. They never move, resize, delete, or reorder blocks. Provide a bounded preview and access to remaining content.
- Preserve canonical layout, authored whitespace, styles, and grouping on phones and desktop. No conversion into a sequence and no second persisted layout.
- Show reading status initially. Add percentages only where reliable provenance already exists; otherwise omit them. Do not infer measured progress from importer placeholders.

### Collection-linked shelf

Extend Shelf with an optional collection source; old blocks continue to mean hand-picked books. Reuse the existing collection and book-key resolver patterns.

- Configuration offers “Pick books” or “Follow a collection.”
- Linked content follows collection membership and order without storing a second copy of its book list.
- Collection rename is reflected in the default title; an explicitly authored shelf title remains unchanged.
- Missing books are skipped. A deleted collection leaves the block in place with a reconnect action; do not silently choose another source.
- Switching back to hand-picked mode explicitly snapshots the current resolved books, preserving visible choices. Explain this in the configuration control.

### Rediscover a passage

Extend Quote spotlight with a rediscovery mode. Existing pinned quote references retain their behavior.

- Eligible entries are identifiable book passages with nonempty text and valid book/highlight references. Exclude reviews, note-only entries, and ambiguous legacy entries from automatic selection; manual selection remains available.
- Inspect importer/exporter provenance before implementation. Reuse reliable existing markers, or add the smallest explicit content-kind field at ingestion. Do not classify by prose heuristics or guess the kind of legacy text.
- Choose deterministically from eligible passages using a stable day key and block ID. Freeze that choice during the mounted visit; update on the next visit/day. No scheduler or persisted daily rotation state.
- “Show another” advances locally; “Keep this passage” persists the displayed book/highlight reference and switches that block to pinned mode through existing save/conflict handling.
- Always show book/author attribution; open long passages in a readable detail view. Missing/deleted passages produce a calm empty state without changing layout.

### Ownership, persistence, and sharing

- Store one nullable home mural reference per account in the existing murals backend module, outside the public library payload. Avoid introducing a generic preferences framework for this one value.
- Use a small authenticated home read/select surface. Selection validates mural ownership. Starter creation and home assignment should be one atomic, retry-safe operation so two devices/retries cannot create duplicate starter murals.
- Selecting another mural never deletes the previous one. Deleting the selected mural clears the reference and offers Choose/Create on the next Home visit; no automatic replacement.
- Preserve existing optimistic concurrency for mural edits. Failures must leave the previous usable home selected and provide retry feedback.
- Public sharing stays explicitly controlled by existing share actions. For v1, rediscovery blocks render an unavailable/private-content state in public views and expose no passage candidates or private text.
- Collection shelves on an explicitly shared mural are resolved server-side against the owner's collection and existing public-book redaction. Do not expose collection metadata or the owner's entire library to make client-side resolution work.

## Implementation sequence

1. **Shared contracts and resolvers.** Add backward-compatible shelf/quote source fields, eligibility/selection helpers, and a starter builder. Audit every renderer, picker, scrubber, validator, merge/import path, and public resolver consuming the changed types. Add focused tests for behavior and legacy blocks.
2. **Persistence and public resolution.** Add the account home reference, ownership checks, atomic starter initialization, and deletion cleanup in the murals module. Extend public collection resolution and explicitly redact rediscovery content. Test authorization, retries, and public payloads before UI integration.
3. **Make blocks usable on native.** Reuse existing cover/book-detail components, add collection-source and quote-mode configuration, and separate view actions from edit selection. Implement readable detail fallbacks. Extend `mobile/src/ui/theme.tsx` and existing UI components only as needed.
4. **Mobile Home.** Add routes/tab, frame actions, chosen-mural loading, starter/selection flows, and targeted query invalidation after library, collection, or mural changes. Use existing import and search flows. Verify login, deep links, back navigation, and deletion recovery.
5. **Web parity.** Update routes/sidebar, reuse the web mural renderer/editor, and support the same sources and actions. Check desktop plus narrow-screen layouts and public viewers. Do not introduce a separate home block system.
6. **Verification and documentation.** Run relevant package checks, perform device/browser acceptance checks, and update the affected READMEs with final routes, source behavior, and sharing rules. Record unverified device behavior explicitly.

## Acceptance checks

- New account, imported library, and existing mural owner can each establish a home without duplicate creation or inferred reading choices.
- Home selection survives reload/login and another device; another account cannot read or select it.
- Import, reload, source updates, and edits elsewhere preserve user-authored coordinates, text, styles, pinned passages, and selected home.
- Collection additions/removals/order changes appear in linked shelves; manual shelves remain unchanged. Missing source references recover gracefully.
- Rediscovery excludes imported reviews and ambiguous entries, is stable during a visit, supports Show another and Keep, and handles removed content.
- Public responses contain no rediscovery text/candidate pool/private library fields; shared collection shelves expose only intended redacted book data.
- Tapping/scrolling in view mode never edits or moves blocks. Editing retains existing conflict behavior.
- Empty, failed-load, stale/deleted-home, and failed-save states are usable. A failed request is not treated as an empty account.
- Phone and desktop checks cover long text, many reading books, missing covers, a tall mural, deliberate gaps, accessible touch targets, and text scaling.

Use existing test runners for meaningful resolver, persistence, navigation, and public-redaction checks. Run shared build/typecheck and typecheck/lint/tests for each changed package where scripts exist. At this snapshot mobile and shared have no lint script; report that rather than adding tooling for this feature. Run Expo Doctor and existing relevant Maestro flows when a device/emulator and credentials are available.

Normal development uses Expo Go or an existing development client. No deployment, EAS build/submit/update, APK/AAB generation, or native rebuild is part of this plan.
