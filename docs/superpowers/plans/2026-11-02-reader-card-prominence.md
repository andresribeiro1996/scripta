# Reader Card Prominence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The reader card heads every profile on web and mobile, stops being a mural block, and can be shared by a public link that previews with the card image.

**Architecture:**
- **Backend.**
  - The community module gains a profile-card read, built on a tolerant library resolver.
  - A `card_shares` table backs share, unshare and public routes.
  - A server-side JPEG of the card front is rendered with `@resvg/resvg-js` and bundled fonts.
- **Retiring the `readerCard` block.** This happens in two steps:
  - the server strips it on save, on read and in a boot migration;
  - then shared code and both clients delete the kind, while dropping any stale copy they still receive.
- **Clients.** Each client gets one `ProfileCardHero`: the card over a blurred copy of itself. Every profile surface and the new public card page use it. One shared helper builds the owner's visitor view and progress line.
- **Link previews.** A Cloudflare Pages Function injects og tags for `/shared/cards/:token`.

**Tech Stack:** Fastify + node:sqlite (`backend/`), `@scripta/shared`, React/Vite/Tailwind (`frontend/`), Expo/React Native with expo-image and react-native-svg (`mobile/`), Cloudflare Pages Functions.

**Spec:** `docs/superpowers/specs/2026-11-02-reader-card-prominence-design.md`

## Global Constraints

- **Visitors only get visitor data.** That means `readerCardInputOf([], [], username, locale, publicCard)`, which is what `visitorView` builds (`packages/shared/src/library/readerCardFacts.ts:72-85`). It never includes `leaders`, `missing`, annotations or the progress line.
- **Private profiles.**
  - `CommunityProfileView.readerCard` is absent whenever `private` is true.
  - Clients decide privacy from `view.private`, never from whether `readerCard` is missing.
  - The card link works whatever the profile's visibility.
  - Owners always see their own card, in every branch of their own shelf.
- **No library or no stored card → the blank Unwritten card.** It is never an error.
- **One card link per user.**
  - Unshare deletes it.
  - Sharing again mints a new `randomUUID()` token.
  - Sharing while a link is live returns the existing one.
  - Sharing and unsharing never touch `profiles.published`.
- **The card's print follows the reader's style.** Use `resolvePrint(input.style.print, dark)` (`packages/shared/src/readerCards/style.ts:125`) for the visible card, the blurred backdrop and the share image. The server image uses `dark = false`.
- **API changes stay additive for old clients** (`backend/CLAUDE.md`). `PublicLibraryData.readerCard` stays in the type until Task 6 deletes it together with its client reads.
- **PRs and deploys.**
  - **PR 1:** Tasks 1–5, server side.
  - **PR 2:** Tasks 6–8, clients, still on the current mobile runtime. Open it without `--auto`, and turn auto-merge on only once PR 1 is live in production.
  - **PR 3:** Task 9, the Pages Function, plus the `mobile/app.json` intent filter. It waits on the Cloudflare precondition in Task 9 and on a store build the user requests. `app.json` changes the fingerprint runtime (`mobile/app.json:9-10`), which would block the over-the-air update if it rode in PR 2.
- **Copy (en / pt-PT):**
  - "Share card" / "Partilhar cartão"
  - "Open in Atmyshelf" / "Abrir no Atmyshelf"
  - "View profile" / "Ver perfil"
  - Reuse the existing "Edit card" keys: `readerCard.editCard` on web, `murals.editCard` on mobile.
- **Owner progress line (Unwritten only):** the owner input's `missing`, e.g. "Finish 3 more books". It comes from `ownProfileCard` (Task 6).
- **Public card URL:** `${env.FRONTEND_URL}/shared/cards/${token}`.
- **Mobile hero placement (Claude's call, flagged to the user).** On mobile the hero is the first item of each profile's first tab: Mural on others' profiles, Shelf on your own. It scrolls away with that tab. On web the hero sits above `SwipeTabs`. If the user wants it above the tabs on mobile too, Task 8 changes. The other tasks don't.
- **Security review.** The branch touches share links and who can see what, so run the `security-review` skill before merge.
- **No comments in code.**
- **Rebuild shared** (`npm run build --workspace @scripta/shared`) before checking consumers.
- **New backend test files** each go in the `test` list in `backend/package.json`.

## Review Focus

1. **Private profile with a live card link.** The profile view has no card. `GET /community/cards/shared/:token` still returns 200 with `profileVisible: false`. *(Tests in Tasks 1 and 4.)*
2. **Library never imported, or `library_summary.reader_card` null while meta is present.** The profile and the public link both show the blank Unwritten card and never return a 500. *(Task 1.)*
3. **Revoked or unknown token.** Both the payload route and the image route return 404. *(Tasks 4 and 5.)*
4. **Stale `readerCard` block.**
   - An old phone bundle that saves a mural holding the block gets a 200, and the block is dropped. Every other block keeps its `x`/`y`/`w`/`h`. *(Task 2.)*
   - A new client that receives a mural still holding the block renders without throwing. *(Task 6.)*
5. **Username with `"`, `<` or `&` in the og tags.** It is escaped. *(Task 9.)*

---

## PR 1 — server side

### Task 1: Profile card on the profile view

**Files:**
- Modify: `backend/src/modules/library/publicResolver.ts`
- Modify: `backend/src/modules/library/index.ts`
- Modify: `packages/shared/src/community/types.ts`
- Modify: `backend/src/modules/community/service.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/library/publicViews.test.ts`
- Test: `backend/src/modules/community/service.test.ts`
- Test: `backend/src/modules/community/archive.test.ts`
- Test: `backend/src/modules/community/backfill.test.ts`
- Test: `backend/src/modules/community/engagement.test.ts`
- Test: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts`

**Interfaces:**
- Produces:
  - `resolveProfileReaderCard(userId: string): PublicReaderCard`, exported from `modules/library/index.ts`.
  - `CommunityDeps.readerCardFor: (userId: string) => PublicReaderCard`.
  - `CommunityProfileView.readerCard?: PublicReaderCard`.

- [ ] **Step 1: Write failing tests in `publicViews.test.ts`.**
  - `resolveProfileReaderCard returns a blank unwritten card when the user has no library`: expects `state === "unwritten"`.
  - `resolveProfileReaderCard returns a blank unwritten card when reader_card is null but meta exists`: no throw, and `state === "unwritten"`.
  - `resolveProfileReaderCard attaches style and chosen for a settled reader`: `card.style` is defined, and `card.chosen?.signature?.title` equals the signature book's title.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test --workspace backend`. Expected: FAIL, because `resolveProfileReaderCard` is not exported.
- [ ] **Step 3: Implement `resolveProfileReaderCard` in `publicResolver.ts` and export it from `index.ts`.**
  - Reuse `readerCardStyleOf`, the signature/highlight book lookup and `publicCardOf`.
  - When `summary.meta === null` or `summary.reader_card === null`, use `publicReaderCard(readerIdentity([], [], "en"))` as the stored card.
  - Never throw.
- [ ] **Step 4: Run the library tests and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Write failing tests in `community/service.test.ts`.**
  - `profile view carries readerCard for a published profile`.
  - `profile view omits readerCard for a private profile viewed by someone else`.
  - `profile view carries readerCard for the owner of an unpublished profile`: pass a `viewerId` equal to the owner.
  - Add `readerCardFor: () => blankCard` to every `CommunityDeps` fake: `service.test.ts:228`, `archive.test.ts:54`, `backfill.test.ts:50`, `engagement.test.ts:99`, `sqliteCommunityRepository.test.ts:773`.
- [ ] **Step 6: Wire it up.**
  - Add the `CommunityProfileView` field (`packages/shared/src/community/types.ts:167`).
  - Add `readerCardFor` to `CommunityDeps` (`service.ts:80-100`).
  - In `getProfileByUsername` (`service.ts:402-430`), set `readerCard` only when `!isPrivate`.
  - Pass `readerCardFor: resolveProfileReaderCard` in `app.ts:196-216`.
- [ ] **Step 7: Run the checks and confirm they pass.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. Expected: PASS.
- [ ] **Step 8: Commit.** Run `git add -A backend packages/shared && git commit -m "Carry the reader card on the profile view"`.

### Task 2: Strip the retired mural block on the server

**Files:**
- Modify: `packages/shared/src/murals/murals.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `backend/src/modules/murals/service.ts`
- Modify: `backend/src/modules/murals/domain/publicPayload.ts`
- Modify: `backend/src/modules/murals/migration.ts`
- Modify: `backend/src/modules/murals/index.ts`
- Modify: `backend/src/migrations/runStartupMigrations.ts`
- Test: `packages/shared/src/murals/murals.test.ts`
- Test: `backend/src/modules/murals/migration.test.ts`
- Test: `backend/src/modules/murals/routes.test.ts`
- Test: `backend/src/modules/murals/home.test.ts`

**Interfaces:**
- Produces:
  - `RETIRED_BLOCK_TYPES: readonly string[] = ["readerCard"]`.
  - `dropRetiredBlocks<T extends { type: string }>(blocks: T[]): T[]`, exported from `@scripta/shared`.
  - `removeRetiredBlocks(db: DatabaseSync): number`, exported from `modules/murals/index.ts`. It returns the number of murals changed.

- [ ] **Step 1: Write failing tests.**
  - `murals.test.ts`, test `dropRetiredBlocks removes readerCard blocks and leaves the rest untouched`:
    - input: `profile` at (0,0,6,4), `readerCard` at (0,4,6,6), `stats` at (6,4,6,6);
    - output: exactly the profile and stats objects, deep-equal.
  - `migration.test.ts`, test `removeRetiredBlocks drops readerCard blocks without moving others and is idempotent`: the first call returns 1 and the second returns 0. The stored blocks equal the input minus the card.
  - `routes.test.ts`:
    - `saving a mural that still holds a readerCard block succeeds and stores it without the block`: the save returns 200 and the other blocks are unchanged.
    - `GET /murals/shared/:token never returns a readerCard block`: write the row directly to the DB with the block in it.
  - `home.test.ts:113-157`: those cases now expect the saved block to be gone and the payload's `readerCard` to be absent.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test --workspace @scripta/shared && npm test --workspace backend`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `dropRetiredBlocks` to `murals.ts` and export it from `index.ts`.
  - Apply it in three places:
    - in `updateMural` before `JSON.stringify` (`service.ts:114-130`);
    - in `toMural` (`service.ts:15-29`);
    - once at the top of `resolveMuralPublicPayload` (`domain/publicPayload.ts:15`). That function feeds both the shared route (`routes.ts:297-306`) and `getMuralPublicPayload`.
  - Add `removeRetiredBlocks` beside `resetPresetBlockStyles` (`migration.ts:159`), using the same `BEGIN IMMEDIATE` loop and updating only changed rows.
  - Call it from `runStartupMigrations.ts`.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git add -A backend packages/shared && git commit -m "Strip retired reader card blocks from murals on the server"`.

### Task 3: Stop resolving the reader card for mural payloads

**Files:**
- Modify: `backend/src/modules/murals/domain/publicPayload.ts`
- Modify: `backend/src/modules/library/publicResolver.ts`
- Test: `backend/src/modules/library/publicViews.test.ts`

**Interfaces:**
- Consumes: `resolveProfileReaderCard` (Task 1), which keeps `publicCardOf` and `chosenOf` in use.
- Produces: `resolvePublicLibraryData` no longer takes `needsReaderCard` and never sets `readerCard`. The optional `PublicLibraryData.readerCard` type stays until Task 6.

- [ ] **Step 1: Update the tests.** Drop the `needsReaderCard` cases in `publicViews.test.ts` (`:140`, `:898`, `:977`) and keep their non-card assertions.
- [ ] **Step 2: Remove the card path.**
  - Remove `needsReaderCard` and the `readerCard` result from `resolvePublicLibraryData` (`publicResolver.ts:204-262`), including the `:254` throw.
  - Remove it from `publicPayload.ts:46` and from the `profile` condition at `:78`.
  - `BlockReferences.needsReaderCard` stays until Task 6. Pass nothing for it.
- [ ] **Step 3: Run the checks and confirm they pass.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && npm run typecheck --workspace frontend && npm run typecheck --workspace mobile`. Expected: PASS.
- [ ] **Step 4: Commit.** Run `git add -A backend && git commit -m "Stop resolving the reader card for mural payloads"`.

### Task 4: Card share link

**Files:**
- Modify: `backend/src/modules/community/adapters/sqlite/schema.sql`
- Modify: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.ts`
- Modify: `backend/src/modules/community/domain/ports.ts`
- Modify: `backend/src/modules/community/service.ts`
- Modify: `backend/src/modules/community/routes.ts`
- Modify: `backend/src/modules/community/plugin.ts`
- Modify: `backend/package.json`
- Modify: `packages/shared/src/public/types.ts`
- Modify: `packages/shared/src/public/api.ts`
- Modify: `packages/shared/src/community/api.ts`
- Modify: `packages/shared/src/community/types.ts`
- Modify: `backend/src/modules/community/routes.test.ts`
- Test: `backend/src/modules/community/cardShare.test.ts`

**Interfaces:**
- Consumes: `CommunityDeps.readerCardFor` (Task 1).
- Produces:
  - **Table:** `card_shares(user_id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`. `deleteUserData` (`sqliteCommunityRepository.ts:132`) deletes the user's row too.
  - **Repo:** `getCardShareToken(userId): string | null`, `setCardShareToken(userId, token: string | null): void`, `getCardShareOwner(token): string | null`.
  - **Shared types:**
    - `CardShare { shareToken: string | null; shareUrl: string | null }` and `LiveCardShare { shareToken: string; shareUrl: string }`, both in `community/types.ts`.
    - `SharedReaderCardPayload { username: string; readerCard: PublicReaderCard; profileVisible: boolean }` in `public/types.ts`.
  - **Service:**
    - `getCardShare(userId): CardShare`
    - `shareCard(userId): LiveCardShare`
    - `unshareCard(userId): void`
    - `getSharedCard(token): SharedReaderCardPayload | null`. It returns `null` for an unknown token and when the owner has no resolvable username. `profileVisible` is the owner's `published` flag.
  - **Routes:**
    - `GET /community/card/share` (auth) → `CardShare`
    - `POST /community/card/share` (auth) → `LiveCardShare`
    - `POST /community/card/unshare` (auth) → 204
    - `GET /community/cards/shared/:token` (public, in the existing 30/min public scope, `Cache-Control: no-store`) → `SharedReaderCardPayload`, or 404 `{ error }`
  - **Shared clients:**
    - `fetchCardShare()`, `shareCard()` and `unshareCard()` in `createCommunityApi`;
    - `fetchSharedCard(token)` in `createPublicApi`, with `{ auth: "none" }`.
  - **URL:** `cardShareUrlFor(token)` returns `${env.FRONTEND_URL}/shared/cards/${token}`, built in `plugin.ts` the way `murals/plugin.ts:33` does it.

- [ ] **Step 1: Write failing route tests in `cardShare.test.ts`.** Follow `murals/routes.test.ts:1-45`. Add the file to `backend/package.json` `test`. Add the four new service methods to `routes.test.ts`'s `fakeService`.
  - `share returns a link and is idempotent while live`: two POSTs return the same token, and `shareUrl` ends with `/shared/cards/<token>`.
  - `unshare kills the token and resharing mints a new one`: after unshare the old token returns 404, and the next share has a different token.
  - `share and unshare leave profiles.published unchanged`.
  - `public card returns visitor payload`: `username`, `readerCard.state`, and `profileVisible: true` for a published owner.
  - `public card still works for a private owner`: 200 with `profileVisible: false`.
  - `unknown token is 404`.
  - `GET /community/card/share without a link returns nulls`.
  - `deleteUserData removes the card share`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test --workspace backend`. Expected: FAIL.
- [ ] **Step 3: Implement the Interfaces.** Generate the token inline with `randomUUID()`, as `murals/service.ts:146-165` does.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git add -A backend packages/shared && git commit -m "Add a public share link for the reader card"`.

### Task 5: Card image for link previews

**Files:**
- Create: `backend/assets/fonts/PlayfairDisplay.ttf`
- Create: `backend/assets/fonts/PlayfairDisplay-Italic.ttf`
- Create: `backend/assets/fonts/Roboto.ttf`
- Create: `backend/assets/fonts/PinyonScript-Regular.ttf`
- Create: `backend/assets/fonts/CourierPrime-Regular.ttf`
- Create: `backend/src/modules/community/cardImage.ts`
- Modify: `backend/src/modules/community/routes.ts`
- Modify: `backend/package.json`
- Modify: `package-lock.json`
- Test: `backend/src/modules/community/cardImage.test.ts`

**Interfaces:**
- Consumes:
  - `getSharedCard(token)` (Task 4);
  - `renderReaderCard` and `resolvePrint` from `@scripta/shared/readerCards`;
  - `readerCardInputOf` from `@scripta/shared`.
- Produces:
  - `renderCardImage(input: ReaderCardInput): Promise<Buffer>`. It renders the front at width 600 (600×840) with resvg, then converts it with `sharp` to JPEG at quality 82.
  - Public route `GET /community/cards/shared/:token/image.jpg`:
    - `image/jpeg` and `Cache-Control: public, max-age=300`;
    - 404 for an unknown or revoked token;
    - the same public rate-limit scope as Task 4.

**Why resvg (Claude's call):** sharp's librsvg finds fonts through fontconfig, and Railway's image doesn't have these fonts. `@resvg/resvg-js` takes font files directly: `font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Roboto", sansSerifFamily: "Roboto", serifFamily: "Playfair Display" }`. That gives the same output locally and in production. Install it as `docs/dev-workflow.md` describes for worktrees: a lockfile-only install, then a real one. deploy-ops checks that the Railpack build picks up the linux-gnu binary.

**Fonts:**
- They live in `backend/assets/fonts/`, outside `src/`, because the build copies only `.html`/`.sql`. Resolve the directory with `new URL("../../../assets/fonts/", import.meta.url)`. That path is the same depth from `src/` and from `dist/`.
- Pinyon Script and Courier Prime are copied from `frontend/public/fonts/*.ttf`.
- Playfair Display (upright and italic variable TTFs) and Roboto (variable TTF, which covers weight 600 for the sans text in `compose.ts:6`) come from the google/fonts repo. Both are OFL.

- [ ] **Step 1: Write failing tests in `cardImage.test.ts`.**
  - `renderCardImage returns a 600x840 JPEG under 300 KB`:
    - the input is `readerCardInputOf([], [], "marta", "en", settledCard)` plus `print: resolvePrint(style.print, false)`;
    - `sharp(buf).metadata()` gives `{ format: "jpeg", width: 600, height: 840 }`;
    - `buf.length < 300_000`.
  - `image route 404s for an unknown token`.
  - `image route 404s for a revoked token`.
  - `image route serves image/jpeg with max-age=300 for a live token`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test --workspace backend`. Expected: FAIL.
- [ ] **Step 3: Implement `renderCardImage` and the route.** The route builds its input from `readerCardInputOf([], [], payload.username, localeOf(request), payload.readerCard)` with `print: resolvePrint(input.style.print, false)`.
- [ ] **Step 4: Run the tests and check the image by eye.** The tests should pass. Then write the image for a settled card to the scratchpad and Read it:
  - the plate name and numerals are in serif;
  - the epithet and motto are in italic serif;
  - the eyebrow and footers are in sans;
  - nothing falls back to a missing glyph.
- [ ] **Step 5: Commit.** Run `git add -A backend package-lock.json && git commit -m "Render the reader card front as a JPEG for link previews"`.

---

## PR 2 — clients (open without `--auto`; enable it once PR 1 is live)

### Task 6: Retire the readerCard block kind; shared owner-card helper

**Files:**
- Modify: `packages/shared/src/murals/murals.ts`
- Modify: `packages/shared/src/murals/blockKinds.ts`
- Modify: `packages/shared/src/murals/presets.ts`
- Modify: `packages/shared/src/public/types.ts`
- Modify: `packages/shared/src/library/readerCardFacts.ts`
- Modify: `packages/shared/src/i18n/messages/en.ts`
- Modify: `packages/shared/src/i18n/messages/pt-PT.ts`
- Modify: `frontend/src/components/murals/AddBlockMenu.tsx`
- Modify: `frontend/src/components/murals/BlockConfigPanel.tsx`
- Modify: `frontend/src/components/murals/BlockRenderer.tsx`
- Modify: `frontend/src/components/murals/MobileBlockPreview.tsx`
- Modify: `frontend/src/components/murals/MuralBlockDetail.tsx`
- Modify: `frontend/src/components/murals/MuralCanvas.tsx`
- Modify: `frontend/src/components/murals/MobileMuralCanvas.tsx`
- Modify: `frontend/src/components/murals/MuralPresetPicker.tsx`
- Delete: `frontend/src/components/murals/blocks/ReaderCardBlock.tsx`
- Modify: `frontend/src/pages/CommunityProfilePage.tsx`
- Modify: `frontend/src/pages/SharedMuralPage.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Modify: `frontend/src/i18n/messages/en/muralEditor.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/muralEditor.ts`
- Modify: `mobile/src/features/murals/MuralCanvas.tsx`
- Delete: `mobile/src/features/murals/ReaderCardBlock.tsx`
- Modify: `mobile/src/features/murals/MuralsScreen.tsx`
- Modify: `mobile/src/features/community/ProfileScreen.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`
- Modify: `mobile/src/features/public/SharedMuralScreen.tsx`
- Modify: `mobile/src/features/search/ReaderPortraitCard.tsx`
- Modify: `mobile/src/features/home/FeedPreview.tsx`
- Modify: `backend/src/modules/murals/home.test.ts`
- Test: `packages/shared/src/murals/murals.test.ts`
- Test: `packages/shared/src/murals/blockKinds.test.ts`
- Test: `packages/shared/src/murals/presets.test.ts`
- Test: `packages/shared/src/library/readerCardFacts.test.ts`
- Test: `packages/shared/src/i18n/sharedStrings.test.ts`
- Test: `packages/shared/src/library/devFixture.test.ts`

**Interfaces:**
- Consumes: `dropRetiredBlocks` (Task 2).
- Produces:
  - `BlockType` without `"readerCard"`.
  - `BlockReferences` without `needsReaderCard`.
  - `PublicLibraryData` without `readerCard`.
  - No `readerCardOverride` prop anywhere.
  - `ensureBookBlockHeights` and `compactMuralBlocks` call `dropRetiredBlocks` first.
  - `buildMuralPreset` keeps its signature. `groups` stays for compatibility and is now unused. Removing the parameter is out of scope.
  - `ownProfileCard(ownerInput: ReaderCardBase): { input: ReaderCardBase; progress: string | null }` in `readerCardFacts.ts`:
    - `input` is `visitorView(ownerInput)`;
    - `progress` is `ownerInput.missing` when `ownerInput.card.state === "unwritten"`, otherwise `null`.

- [ ] **Step 1: Write and update the shared tests.**
  - `murals.test.ts`:
    - `ensureBookBlockHeights drops a stale readerCard block instead of throwing`;
    - `compactMuralBlocks drops a stale readerCard block`.
  - `readerCardFacts.test.ts`:
    - `ownProfileCard shows progress only while unwritten`: with 2 finished books, `progress` contains "3"; with a settled fixture, it is `null`;
    - `ownProfileCard returns the visitor view`: `input.view === "visitor"` and `input.leaders === undefined`.
  - `blockKinds.test.ts`: `BLOCK_TYPES` excludes `"readerCard"`, and the `needsReaderCard` assertions go.
  - `presets.test.ts:133-149`: the "My shelf" preset has no `readerCard` block.
  - Drop `kindReaderCard` from `sharedStrings.test.ts:100` and `devFixture.test.ts:36`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test --workspace @scripta/shared`. Expected: FAIL.
- [ ] **Step 3: Remove the kind everywhere and add the helper.**
  - In shared, remove the kind from:
    - the union at `murals.ts:88`;
    - `blockKinds.ts:19,148-149,196`;
    - `presets.ts:92-97`;
    - `public/types.ts:41`;
    - the `kindReaderCard` i18n key.
  - Add `dropRetiredBlocks` to `ensureBookBlockHeights` (`murals.ts:159`) and `compactMuralBlocks` (`:199`).
  - Add `ownProfileCard`.
  - Remove every client reference in the Files list:
    - the add-block entries;
    - the renderers;
    - the `readerCardOverride` threading, including `ReaderPortraitCard.tsx:37` and `FeedPreview.tsx:52`;
    - the `muralEditor.addDescReaderCard` and `readerCardNote` strings.
  - In `backend/.../home.test.ts`, delete the cases that save a `type: "readerCard"` block through the typed API.
- [ ] **Step 4: Run every workspace's checks and confirm they pass.** Run `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend && npm run typecheck --workspace mobile && npm test --workspace mobile`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git add -A packages/shared frontend mobile backend && git commit -m "Retire the reader card mural block"`.

### Task 7: Web — card hero on profiles, sharing, public card page

**Files:**
- Create: `packages/shared/src/readerCards/dataUri.ts`
- Modify: `packages/shared/src/readerCards/index.ts`
- Create: `frontend/src/components/readerCard/ProfileCardHero.tsx`
- Modify: `frontend/src/pages/CommunityProfilePage.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Create: `frontend/src/pages/SharedCardPage.tsx`
- Create: `frontend/src/api/sharedCards.ts`
- Modify: `frontend/src/api/community.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n/messages/en/readerCard.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/readerCard.ts`
- Test: `packages/shared/src/readerCards/dataUri.test.ts`
- Test: `frontend/scripts/test-profile-card-hero.mts`

**Interfaces:**
- Consumes:
  - `CommunityProfileView.readerCard` (Task 1);
  - `fetchCardShare`, `shareCard`, `unshareCard`, `fetchSharedCard` and `SharedReaderCardPayload` (Task 4);
  - `ownProfileCard` (Task 6).
- Produces:
  - `readerCardDataUri(input: ReaderCardInput, page?: ReaderCardPage): string`, which returns `"data:image/svg+xml;utf8," + encodeURIComponent(renderReaderCard(input, page))`. Mobile reuses it.
  - `ProfileCardHero({ input, children }: { input: ReaderCardBase; children?: ReactNode })`:
    - the backdrop is an `aria-hidden` `<img>` of `readerCardDataUri({ ...input, print: resolvePrint(input.style.print, dark) })`, scaled up with Tailwind `blur-3xl`, under a fade to the page background;
    - the card is `ReaderCardTurner`;
    - `children` sit below.
  - `frontend/package.json`'s `test` glob already picks up the new script. Its `typecheck` gains `&& tsc -p functions --noEmit` in Task 9, not here.

- [ ] **Step 1: Write the failing shared test.** In `dataUri.test.ts`, test `readerCardDataUri round-trips the rendered svg`: decoding the part after the prefix equals `renderReaderCard(input, "front")`.
- [ ] **Step 2: Implement it and run the shared tests.** Run `npm test --workspace @scripta/shared`. Expected: PASS.
- [ ] **Step 3: Write the failing markup test.** In `test-profile-card-hero.mts`, follow the `renderToString` + regex style of `scripts/test-top-bar.mts`. Test `hero puts a blurred aria-hidden backdrop first and the card before its children`:
  - the markup contains an `aria-hidden="true"` `img` whose class includes `blur-`;
  - the card's SVG appears before the children's marker text.
- [ ] **Step 4: Build the hero and use it on the three surfaces.**
  - **`CommunityProfilePage`** (`:118-131`): replace `ProfileHeader` with the hero, built from `readerCardInputOf([], [], username, locale, view.readerCard)`, with name and Follow as its children.
    - Branch on `view.private` exactly as today.
    - When `!view.private` but there is no `view.readerCard` (an old backend), keep today's `ProfileHeader`.
  - **`OwnShelfView`**: the hero heads the page, above `SwipeTabs`, in every state.
    - Input: `ownProfileCard(useReaderCard(books, groups, username, undefined, own))`, built as `ReaderCardPage.tsx:36` does with `useOwnCardStyle`.
    - Children: the name, the publish chip and controls (`:159-193`), the progress line when present, "Share card", and "Edit card" (a link to `/dashboard/reader-card`).
    - "Share card" opens `ShareModal` (`ShareModal.tsx:36-52`):
      - `shareToken` and `shareUrl` from `useQuery(["community","card-share"], fetchCardShare)`;
      - `onShare: shareCard` and `onUnshare: unshareCard`, both invalidating that key.
    - Add the share clients to the destructured exports in `frontend/src/api/community.ts`.
  - **`SharedCardPage`** at `/shared/cards/:token`:
    - Register it beside `App.tsx:73`, outside `RequireAuth`.
    - Query with `useQuery(["sharedCard", token], () => fetchSharedCard(token), { retry: false })`, using the `InfoScreen` pattern (`SharedMuralPage.tsx:37-51`).
    - Children: the username, and "Open in Atmyshelf" linking to `/community/u/:username` when `profileVisible`, otherwise `/`.
- [ ] **Step 5: Run the checks and confirm they pass.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`. Expected: PASS.
- [ ] **Step 6: Commit.** Run `git add -A packages/shared frontend && git commit -m "Head web profiles with the reader card and add the public card page"`.

### Task 8: Mobile — card hero on profiles, sharing, shared card screen

**Files:**
- Create: `mobile/src/features/readerCard/ProfileCardHero.tsx`
- Modify: `mobile/src/features/community/ProfileScreen.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`
- Create: `mobile/src/features/public/SharedCardScreen.tsx`
- Create: `mobile/src/app/shared/cards/[token].tsx`
- Modify: `mobile/src/features/public/api.ts`
- Modify: `mobile/src/features/public/index.ts`
- Modify: `mobile/src/features/community/api.ts`
- Modify: `mobile/src/i18n/messages/en/readerCard.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/readerCard.ts`
- Test: `mobile/src/features/readerCard/profileCardHero.test.ts`

**Interfaces:**
- Consumes:
  - `readerCardDataUri` (Task 7);
  - `ownProfileCard` (Task 6);
  - `CommunityProfileView.readerCard` (Task 1);
  - the share clients and `fetchSharedCard` (Task 4);
  - `readerCardXml` (`mobile/src/features/murals/readerCardXml.ts:5`);
  - `openProfile` (`mobile/src/features/community/AuthorAvatar.tsx`).
- Produces:
  - `ProfileCardHero({ input, width, children }: { input: ReaderCardBase; width: number; children?: ReactNode })`.
  - `backdropXml(svg: string): string` in `ProfileCardHero.tsx`. It wraps the card SVG in an outer `<svg>` with an `feGaussianBlur stdDeviation="18"` filter. This is the fallback path.

- [ ] **Step 1: Write the failing test.** In `profileCardHero.test.ts`, test `backdropXml wraps the card in a gaussian blur filter`: the output contains `feGaussianBlur` and the original `viewBox`.
- [ ] **Step 2: Implement `backdropXml` and run the tests.** Run `npm test --workspace mobile`. Expected: PASS.
- [ ] **Step 3: Build `ProfileCardHero`.**
  - **Backdrop:** an `expo-image` `Image` with `source={{ uri: readerCardDataUri({ ...input, print }) }}` and `blurRadius={40}`.
    - `print` is `resolvePrint(input.style.print, isDark)`.
    - The image is scaled to cover the band, under a fade to `colors.background`.
  - **Fallback:** if the device pass shows expo-image not drawing the SVG data URI, render `SvgXml` of `backdropXml(...)` instead. Both paths stay blurred.
  - **Card:** `ReaderCardTurner` (`mobile/src/features/murals/ReaderCardTurner.tsx`) sits on top.
  - **Text colour:** on a reversed-print band, the children's text uses the paper colour.
- [ ] **Step 4: Use the hero on each surface.**
  - **`ProfileScreen`** (others):
    - The hero is the first element of the Mural tab's `ListHeaderComponent` (`:150-179`), with name and Follow as its children. The Follow button moves up into the hero.
    - Privacy branches use `view.private` (`:89-99`) and stay unchanged.
    - When `!view.private` but there is no `view.readerCard`, the layout stays as today.
  - **`MyShelfScreen`** (own):
    - The hero heads the Shelf tab in every branch (`:206-263`), including the empty-library branch.
    - It is built from `ownProfileCard(readerCardInputOf(books, groups, username, locale, undefined, own))`, with `own` from `useOwnCardStyle`.
    - Children: the progress line when present, "Share card", and "Edit card" (`router.push("/reader-card")`).
    - "Share card" opens `ContentShareSheet` with:
      - `url` from `useQuery(["community","card-share"], fetchCardShare)`;
      - `onEnableLink`, which calls `shareCard()` and returns `shareUrl`;
      - `onDisableLink: unshareCard`; both callbacks invalidate the query;
      - `children` set to `<ReaderCardImage input={input} width={300} />`, using the visitor input.
  - **`SharedCardScreen`**, at route `mobile/src/app/shared/cards/[token].tsx` (mirroring `shared/murals/[token].tsx`):
    - It copies `SharedMuralScreen`'s query, `Skeleton` and `ErrorState`.
    - The hero's children are the username and, when `profileVisible`, "View profile", which calls `openProfile(username)`.
    - It is reachable by deep link only after PR 3.
- [ ] **Step 5: Run the checks and confirm they pass.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`. Expected: PASS.
- [ ] **Step 6: Device pass (`device-checker` agent).** Do not wait on it to push or open the PR. Check:
  - your own shelf, settled and unwritten (fixture);
  - another reader's profile, in paper and reversed print;
  - the share sheet's image preview.
  - **What correct looks like:** a blurred band is visible behind the card; text over a reversed band is readable; tapping the card turns it; the progress line appears only on your own Unwritten shelf.
  - If the band is empty, switch to the `backdropXml` fallback.
- [ ] **Step 7: Commit.** Run `git add -A mobile && git commit -m "Head mobile profiles with the reader card and add the shared card screen"`.

---

## PR 3 — link previews and app links (after PR 2 is live)

### Task 9: og tags for shared card links, and the Android intent filter

**Precondition (user).** In the Cloudflare dashboard, confirm two things about the Pages project:
- the root directory is `frontend`, so `frontend/functions/` gets deployed;
- `VITE_API_URL` is set for Production.

If either is not true, stop and report. Do not create infrastructure. The `app.json` change also needs a store build, which the user has to request explicitly.

**Files:**
- Create: `frontend/functions/shared/cards/[token].ts`
- Create: `frontend/functions/_lib/ogTags.ts`
- Create: `frontend/functions/tsconfig.json`
- Modify: `frontend/package.json`
- Modify: `mobile/app.json`
- Test: `frontend/scripts/test-og-tags.mts`

**Interfaces:**
- Consumes: `GET ${VITE_API_URL}/community/cards/shared/:token` (Task 4) and `.../image.jpg` (Task 5).
- Produces:
  - `ogTags({ username, imageUrl, pageUrl }): string`, which returns escaped `<meta>` tags:
    - `og:title` = `${username} · Atmyshelf`;
    - `og:description` = "Reader card";
    - `og:image`, with `og:image:width` 600, `og:image:height` 840 and `og:image:type` `image/jpeg`;
    - `og:url`;
    - `twitter:card` = `summary_large_image`.
  - `onRequest(context)`:
    - fetch the payload;
    - on 200, fetch `env.ASSETS.fetch(new URL("/", request.url))` and use `HTMLRewriter` to append `ogTags(...)` to `<head>`;
    - on anything else, return the plain `index.html`.
  - The context is typed locally: `{ request: Request; params: { token: string }; env: { ASSETS: { fetch: typeof fetch }; VITE_API_URL: string } }`. `HTMLRewriter` is declared in the function file. No new dependency.
  - `functions/tsconfig.json` is strict, has `noEmit`, and includes `**/*.ts`. The frontend `typecheck` script becomes `tsc -b --noEmit && tsc -p functions --noEmit`.
  - In `mobile/app.json`, add an Android intent-filter entry `pathPrefix: "/shared/cards/"` next to `:47`.

- [ ] **Step 1: Write failing tests in `test-og-tags.mts`.**
  - `ogTags escapes the username`: given `a"<b>&`, the output contains `a&quot;&lt;b&gt;&amp;` and no raw `<b>`.
  - `ogTags points og:image at the JPEG route`.
- [ ] **Step 2: Implement** `ogTags.ts`, the function, the tsconfig, the script change and `app.json`.
- [ ] **Step 3: Run the checks and confirm they pass.** Run `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend && (cd mobile && npx expo-doctor)`. Expected: PASS. Patch drift from `expo-doctor@latest` alone is the known main-wide issue, not this task's.
- [ ] **Step 4: Commit.** Run `git add -A frontend mobile/app.json && git commit -m "Add link previews and app links for shared reader cards"`.
- [ ] **Step 5: Post-deploy check (user, part of the runbook).**
  - Run `curl -s https://atmyshelf.com/shared/cards/<token> | grep og:image`. Expect the JPEG URL.
  - Run `curl -sI <that URL>`. Expect `200` and `image/jpeg`.
