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
- **Mobile hero placement (changed 2026-11-02 after the user's phone test).** The hero sits above the tab bar, and its backdrop runs up under a transparent header. This is the user's decision ("go fully D, hero above the tabs"). Task 10 replaces Task 8's in-tab placement. On web the hero sits above `SwipeTabs`.
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
- Test: `backend/src/modules/community/service.test.ts`

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
- Modify: `backend/src/modules/murals/routes.ts`
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

---

## PR 2 addendum — fully D on mobile (added 2026-11-02 after the user's phone test)

### Task 10: Mobile profile — hero above the tabs, one native scroller

The user tested PR 2 on a phone and asked for the layout to match mockup D much more closely, with the hero above the tabs. The mechanism follows the one layout already proven against scroll lag in this app, PR #231's book page (`mobile/src/features/works/BookScreen.tsx`, `WorkScreen.tsx`; lessons in `docs/superpowers/plans/2026-10-12-book-screen-followups.md`, Task 7):

- **Everything that must stay glued scrolls natively.** The card, name and tab bar are content of a single list. The tab bar pins with `stickyHeaderIndices`, never with a Reanimated translate.
- **The blurred backdrop is one non-scrolling layer behind the list**, driven by one shared value: `translateY: -max(scrollY, 0)`. It runs up under a transparent native header. Its one-frame lag is acceptable because it is a soft blur with no edge against content. That is the same reasoning #231 recorded.

**Files:**
- Create: `mobile/src/features/community/ProfileScroller.tsx`
- Modify: `mobile/src/features/readerCard/ProfileCardHero.tsx`
- Modify: `mobile/src/features/murals/ReaderCardTurner.tsx`
- Modify: `mobile/src/features/murals/MuralCanvas.tsx`
- Modify: `mobile/src/features/community/ProfileScreen.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`
- Modify: `mobile/src/features/community/ActivityList.tsx`
- Modify: `mobile/src/features/public/PublicLibraryGrid.tsx`
- Modify: `mobile/src/features/dailyChapter/daily-chapter-profile-section.tsx`
- Modify: `mobile/src/features/public/SharedCardScreen.tsx`
- Test: `mobile/src/features/community/profileScroller.test.ts`

**Interfaces:**
- `ProfileScroller<T extends string>(props)`, with these props:
  - `hero: ReactNode` — transparent, with no backdrop of its own;
  - `backdrop: ReactNode` — the blurred card layer;
  - `tabs: readonly { value: T; label: string }[]`, `value: T`, `onChange(value: T)`;
  - `section: ProfileSection`, the rows of the active tab;
  - `refreshing?`, `onRefresh?`.

  What it renders:
  - The screen root holds an absolute `Animated.View` at the top for the backdrop. Its height is `headerHeight + heroHeight`, where `useHeaderHeight()` gives the header height and the hero's `onLayout` gives the hero height. It fades to `colors.background` at its bottom.
  - Over that sits a Reanimated `Animated.FlatList` with `marginTop: headerHeight` and `scrollEventThrottle={16}`. Its `ListHeaderComponent` is `hero`. Its `data` is `[TAB_BAR, ...section.data]`, with `stickyHeaderIndices={[1]}`; the list header is index 0.
  - The tab bar row has an opaque `colors.background` and looks like `SwipeableTabs`' row: same labels, typography and underline. Tapping a tab calls `onChange`. If `scrollY > heroHeight` at that moment, it calls `scrollToOffset({ offset: heroHeight, animated: false })`, so the bar stays pinned and the new tab starts at its top.
  - `onEndReached` comes from `section`.
  - There is no horizontal swipe between tabs. This is deliberate, and BookScreen has the same tab model.
- `ProfileSection`: `{ data: readonly unknown[]; keyExtractor(item, index): string; renderItem(item): ReactElement; onEndReached?(): void; ListEmptyComponent?: ReactElement }`.
- Tab sources are refactored to produce a `ProfileSection`. Each keeps its existing component for every other caller:
  - `useActivitySection(username): ProfileSection` in `ActivityList.tsx`, taken from `ActivityList`'s infinite query and its `hasNextPage` guard. `ActivityList` itself stays as is for other screens.
  - `useLibrarySection(library, width): ProfileSection` in `PublicLibraryGrid.tsx`. It chunks the books into rows of `columns` and uses the same card sizing as `LibraryGrid`, so the list keeps its virtualisation. `SharedLibraryScreen` keeps `PublicLibraryGrid`.
  - `DailyChapterProfileSection` gets `embedded?: boolean`. When it is true it renders a `View`, not its `ScrollView`. It is one row.
  - **Mural (others):** the rows are `[mural canvas, "Published" eyebrow, ...publishedRows]`.
  - **Shelf (own):** one row, `shelfBody()`.
- `ProfileCardHero` gains `withBackdrop?: boolean` (default `true`) and exports `ProfileCardBackdrop({ input }: { input: ReaderCardBase })`.
  - The profile screens pass `withBackdrop={false}` and give `ProfileCardBackdrop` to `ProfileScroller.backdrop`.
  - `SharedCardScreen` keeps the default.
- `ReaderCardTurner` gains `dots?: boolean` (default `true`). The hero passes `false`, and the card is turned by tap or swipe.
- `MuralCanvas` gains `profileInHero?: boolean`. When it is true, the `profile` block skips its avatar and handle row (`MuralCanvas.tsx:188-190`) and keeps the bio, favourite genres and shelf theme. Both profile screens pass `true`.
- **Header on both profile routes:**
  - `headerTransparent: true`, `headerStyle: { backgroundColor: "transparent" }`, `headerShadowVisible: false`, `headerLargeTitleEnabled: false`, `title: ""`.
  - `MyShelfScreen` keeps its `headerRight`.
  - The loading, error and private states set all four keys back explicitly to the opaque defaults, the way `WorkScreen.tsx:47-52`'s `plainHeader` does, because `Stack.Screen` options merge.
- **Hero content, centred like mockup D:**
  - avatar (40) and name in one centred row, with the glyph after the name;
  - under it, the finished-book count from `input.card.facts?.finished` when present ("{count} books read" / "{count} livros lidos", plural forms);
  - then compact pill buttons: Follow on others' profiles, Share card and Edit card on your own;
  - then the progress line, own Unwritten only.
- **Own shelf while the card isn't ready:** while `styleQuery` is pending, the hero slot keeps the card's height as a skeleton, so the tabs don't jump. When it errors, the existing retry block takes the hero slot.

- [ ] **Step 1: Write a failing test.** In `profileScroller.test.ts`, test `pinnedOffset keeps the tab bar pinned when switching tabs`: `pinnedOffset(scrollY, heroHeight)` returns `heroHeight` when `scrollY > heroHeight`, and `null` otherwise. Export it from `ProfileScroller.tsx`.
- [ ] **Step 2: Implement** `ProfileScroller` and the refactors from Interfaces, then move both profile screens onto it.
- [ ] **Step 3: Run the checks and confirm they pass.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`. Expected: PASS.
- [ ] **Step 4: Commit and push.** Run `git add -A mobile docs && git commit -m "Put the reader card above the profile tabs on mobile"`, then push.
- [ ] **Step 5: Device pass (`device-checker`).** Check your own shelf and `fixture_alice`'s profile, in dark and light themes. It passes if:
  - the backdrop starts under the status bar and header, and the back button and header actions sit over it;
  - the card, centred name and pills appear in D's order;
  - scrolling moves the card and the backdrop together, with no seam or band at the header's bottom edge, during a fling and on overscroll;
  - the tab bar pins under the header;
  - switching tabs while pinned keeps the bar pinned;
  - the Activity tab loads more at its end;
  - the Library tab scrolls smoothly;
  - pull-to-refresh works on the Mural tab.

### Task 11: Share badge on the card; tapping the card opens the big viewer

Asked by the user on 2026-11-02 after the phone test: "go with B, also. clicking the card opens the card in a bigger modal screen". Option B means the share button is icon-only and sits as a round badge on the hero card's bottom-right corner. Applies to web and mobile.

**Files:**
- Create: `mobile/src/features/murals/ReaderCardViewer.tsx`
- Modify: `mobile/src/features/readerCard/ProfileCardHero.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`
- Modify: `mobile/src/features/community/ProfileScreen.tsx`
- Modify: `mobile/src/features/public/SharedCardScreen.tsx`
- Modify: `frontend/src/components/readerCard/ProfileCardHero.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Modify: `frontend/src/pages/CommunityProfilePage.tsx`
- Modify: `frontend/src/pages/SharedCardPage.tsx`

**Interfaces:**
- Mobile `ReaderCardViewer({ input, onClose, onEdit })` is restored from `origin/main:mobile/src/features/murals/ReaderCardViewer.tsx`. Task 6 deleted it along with the mural block. The web `ReaderCardViewer` still exists and is reused as it is.
- `ProfileCardHero` (web and mobile) gains `badge?: ReactNode` and `onEdit?: () => void`.
  - The hero card no longer turns in place. It shows its first page, with the shine, inside one pressable labelled "Open card".
  - Tapping it opens `ReaderCardViewer` for the same input. The hero owns the open state, and `onEdit` is passed through to the viewer.
  - The card turns inside the viewer.
  - `badge` renders over the card's bottom-right corner, overlapping the edge. It is a sibling after the card pressable, so its tap never opens the viewer.
- Badge, own shelf only: a round icon-only share button with no visible label.
  - Accent fill. Mobile uses `IconButton framed tone="accent"`; web uses the matching accent token.
  - Touch target of at least 44.
  - Accessible name "Share card" (`readerCard.shareCard`).
  - Disabled until `cardShare.data` loads. It opens the existing share sheet or modal.
- The visible Share pill goes away on both clients. Mobile keeps Edit card in the ⋯ menu; web keeps the Edit card link. The own shelf passes `onEdit`, which goes to the editor.
- Every hero opens the viewer: own shelf, others' profiles and the shared card screens. Only the own shelf has a badge.

- [ ] **Step 1: Implement** the Interfaces above. If no existing key fits the "Open card" accessibility label, add one in both locales.
- [ ] **Step 2: Run the checks and confirm they pass.** Run `node scripts/gate.mjs`. Expected: PASS.
- [ ] **Step 3: Commit and push.** Run `git add -A mobile frontend docs && git commit -m "Put card sharing on a badge and open the card in the viewer on tap"`, then push.
- [ ] **Step 4: Device pass (`device-checker`).** Check your own shelf and `fixture_alice`'s profile, in dark theme. It passes if:
  - the badge sits on the card's corner;
  - tapping the badge opens the share sheet, not the viewer;
  - tapping the card opens the viewer, which turns the card and closes;
  - on your own shelf, Edit in the viewer opens the editor.

### Task 12: Backdrop blur identical to mockup D

Asked by the user on 2026-11-02: "the blurry needs to be identical with the one in the mock". Task 11's look (blur 80, scale 1.6) is replaced by mockup D's recipe from `docs/superpowers/specs/2026-11-02-reader-card-prominence-mockups/compare.mjs:15-18`.

**The recipe.** The mock phone is 188px wide inside its frame. Every length below is a fraction of the screen width W, or of the hero width on web.
- **Backdrop box:** the hero area grown by 30px of 188 (**0.16 W**) on every side. The card SVG fills it with `cover` (`xMidYMid slice`), centred, with no extra scale.
- **Filter:** `blur(16px)` (Gaussian stdDeviation **0.085 W** in screen units), then `saturate(1.4)`.
- **Overlay:** on the hero area only (`inset: 0`, not the grown box), `linear-gradient(to bottom, rgba(0,0,0,.08) 20%, <page background> 98%)`. The page background is the theme's background colour.

**Files:**
- Modify: `mobile/src/features/readerCard/backdropXml.ts`
- Modify: `mobile/src/features/readerCard/ProfileCardHero.tsx`
- Modify: `mobile/src/features/readerCard/profileCardHero.test.ts`
- Modify: `frontend/src/components/readerCard/ProfileCardHero.tsx`
- Test: `frontend/scripts/test-profile-card-hero.mts`

**Interfaces:**
- **Mobile:** `backdropXml(svg: string): string` only sets `preserveAspectRatio="xMidYMid slice"`. Amended by 0e6e2052: react-native-svg's Android `FeGaussianBlur` clamps the radius at 25 px, so the blur is the view's `filter: [{ blur: 0.085 W }, { saturate: 1.4 }]` on the grown box, not an SVG filter.
  - `ProfileCardBackdrop` measures its box with `onLayout`. It renders the SVG absolutely, with negative insets of 0.16 W.
  - The gradient becomes the mock's overlay.
- **Web:**
  - The backdrop `img` uses negative insets of 16% of the hero width on every side, with `object-cover` and `filter: blur(8.5cqw) saturate(1.4)`. The hero is the size container. Drop `scale-150` and the radial mask.
  - The overlay div becomes the mock's gradient.

- [ ] **Step 1: Test.** In `profileCardHero.test.ts`, assert that `backdropXml(svg, 12.5)` contains `stdDeviation="12.5"` and `type="saturate" values="1.4"`, and no `scale(`.
- [ ] **Step 2: Implement** the Interfaces above.
- [ ] **Step 3: Off-device side-by-side.** Render mock D (from `compare.mjs`) and our recipe at the same proportions for the reversed "star" card and the paper card. Save the result as `.superpowers/device/task12/mock-vs-ours.png`. The two backdrops must be indistinguishable.
- [ ] **Step 4: Run the checks and confirm they pass.** Run `node scripts/gate.mjs`. Expected: PASS.
- [ ] **Step 5: Commit and push.** Run `git add -A mobile frontend docs && git commit -m "Match the hero backdrop to mockup D's blur"`, then push.

### Task 13: Colour-wash backdrop where the view blur is missing

Asked by the user on 2026-11-02: "yes, add the colour wash fallback for older phones". Task 12's mobile blur is RN's view `filter` blur. It only works on Android 12 (API 31) and later, and RN doesn't support it on iOS. On those platforms the backdrop currently shows the card unblurred.

**Files:**
- Modify: `mobile/src/features/readerCard/ProfileCardHero.tsx`
- Modify: `mobile/src/features/readerCard/backdropXml.ts`
- Modify: `packages/shared/src/readerCards/render.ts`
- Modify: `docs/superpowers/plans/2026-11-02-reader-card-prominence.md`
- Test: `mobile/src/features/readerCard/profileCardHero.test.ts`

**Interfaces:**
- `viewBlurSupported(os: string, version: number | string): boolean` is true only for `"android"` with `version >= 31`. `ProfileCardBackdrop` calls it with `Platform.OS` and `Platform.Version`.
- When it is false, the backdrop renders no card SVG. In its place, a flat fill in the card's own ground colour covers the backdrop box, under the same overlay as Task 12.
  - Take the ground colour from `@scripta/shared`'s reader-card render path, not a hard-coded table. That is the colour the plate's first `rect` is filled with, for the card's resolved print and finish; see `packages/shared/src/readerCards/finishes.ts`.
  - If shared has no export for it, add the smallest one next to where it's computed.
  - The tone should be the one the blurred card averages to. If the ground alone reads noticeably off from the blurred result, report it; don't invent a mix.

- [ ] **Step 1: Test.**
  - `viewBlurSupported("android", 31)` and `("android", 34)` return true.
  - `("android", 30)`, `("ios", "17.0")` and `("web", 0)` return false.
  - The ground colour for a reversed card and a paper card matches the fill of the first `rect` in `renderReaderCard`'s output for the same input.
- [ ] **Step 2: Implement** the Interfaces above.
- [ ] **Step 3: Run the checks and confirm they pass.** Run `node scripts/gate.mjs`. Expected: PASS.
- [ ] **Step 4: Commit and push.** Run `git add -A mobile packages docs && git commit -m "Fall back to a colour wash where the view blur is missing"`, then push.

### Task 14: Mural blocks float on the profile page (option C)

Asked by the user on 2026-11-02 after seeing the blend mockups (`.superpowers/device/task12/mural-blend-options.png`): "i would say C". On a profile, the mural's canvas background is not painted, so there is no light slab on a dark page. Only the mural's blocks show, in their own theme colours, each with a soft shadow, on the app's background. Applies to web and mobile, and only on profile pages. The mural editor and every other mural view keep the canvas background.

**Files:**
- Modify: `mobile/src/features/murals/MuralCanvas.tsx`
- Modify: `frontend/src/components/murals/MuralCanvas.tsx`
- Modify: `frontend/src/components/murals/MobileMuralCanvas.tsx`
- Modify: `frontend/src/pages/CommunityProfilePage.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Modify: `packages/shared/src/murals/blockEffects.ts`
- Modify: `docs/superpowers/plans/2026-11-02-reader-card-prominence.md`
- Test: `packages/shared/src/murals/blockEffects.test.ts`

**Interfaces:**
- **Mobile:** `profileInHero` already marks the profile use. When it is true, the canvas gets no `backgroundColor` and each block gets a soft shadow.
  - The shadow is about `0 6 18` at 45% black on dark app themes. On light themes use a lighter one, about `0 4 14` at 12% black.
  - Use the existing elevation or shadow tokens from `DESIGN.md` / `mobile/src/ui/theme` if one fits.
- **Web:** add `floating?: boolean` to `MuralCanvas`. With it, the canvas drops its theme background but keeps `muralThemeStyle`'s colour variables, so the blocks keep their theme. Blocks get the matching shadow.
  - `CommunityProfilePage` passes it to the profile mural, the first `MuralCanvas`.
  - `OwnShelfView` passes it to the shelf mural, the first `MuralCanvas`.
  - The preview canvases stay as they are.

- [ ] **Step 1: Implement** the Interfaces above.
- [ ] **Step 2: Run the checks and confirm they pass.** Run `node scripts/gate.mjs`. Expected: PASS.
- [ ] **Step 3: Commit and push.** Run `git commit -m "Float mural blocks on the profile page instead of a canvas slab"`, then push.

### Task 15: Avatar before the name in the mobile hero

Asked by the user on 2026-11-02: "add the user avatar before the name". This reverses Task 10's "no avatar". The web hero already shows one.

**Files:**
- Modify: `mobile/src/features/readerCard/ProfileCardHero.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`
- Modify: `mobile/src/features/community/ProfileScreen.tsx`

**Interfaces:**
- `ProfileHeroIdentity` gains `avatarUrl: string | null`. It renders `AuthorAvatar` (`mobile/src/features/community/AuthorAvatar.tsx`) at size 32 before the name, in the same centred row as the name and glyph.
- `MyShelfScreen` passes the signed-in user's avatar. `ProfileScreen` passes the profile user's avatar.

- [ ] **Step 1: Implement** the Interfaces above.
- [ ] **Step 2: Run the checks and confirm they pass.** Run `node scripts/gate.mjs`. Expected: PASS.
- [ ] **Step 3: Commit and push.** Run `git commit -m "Show the avatar before the name in the profile hero"`, then push.

### Task 16: Swipe to switch profile tabs on mobile

Asked by the user on 2026-11-02: "the menus should be swipeable". Answering a question, the user chose "swipe to switch" over a full pager. A horizontal swipe on the tab content switches to the neighbouring tab with a short slide. The next tab does not follow the finger. The single native scroller from Task 10 stays.

**Files:**
- Modify: `mobile/src/features/community/ProfileScroller.tsx`
- Modify: `mobile/src/features/community/pinnedOffset.ts`
- Modify: `mobile/src/features/murals/MuralCanvas.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`
- Test: `mobile/src/features/community/profileScroller.test.ts`

**Interfaces:**
- `swipeTarget<T>(tabs: readonly T[], value: T, translationX: number, velocityX: number): T | null` in `pinnedOffset.ts`. It returns the next tab for a left swipe and the previous tab for a right swipe, and `null` at either end or below the threshold.
  - The threshold is |translationX| ≥ 64 or |velocityX| ≥ 600, in the swipe's direction.
- `ProfileScroller` wraps the list in a `react-native-gesture-handler` 3 `Gesture.Pan()` with `activeOffsetX([-24, 24])` and `failOffsetY([-12, 12])`.
  - The pan simultaneously allows the list's native scroll, so vertical scrolling and pull-to-refresh are unchanged.
  - It must not fire when the gesture starts on a horizontally scrollable child (a mural block carousel, for example). Use the child's native gesture or a blocking relation, so the inner scroll wins.
  - It must not fire on the hero card.
  - On end it calls the existing `select()` with `swipeTarget(...)`, so a swipe and a tap land in the same state, pinned offset included.
- **Slide:** the rows after the tab bar enter with a 180 ms translateX from ±24 plus a fade, from the side of the swipe. Taps use the same slide, from the side of the tapped tab. Under reduced motion there is no slide.

- [ ] **Step 1: Test.** In `profileScroller.test.ts`, with tabs `["shelf","activity","daily"]`:
  - `("shelf", -80, 0)` gives `"activity"`.
  - `("activity", 80, 0)` gives `"shelf"`.
  - `("daily", -80, 0)` gives `null`.
  - `("shelf", -30, -700)` gives `"activity"`.
  - `("shelf", -30, 0)` gives `null`.
  - `("shelf", 80, 0)` gives `null`.
- [ ] **Step 2: Implement** the Interfaces above.
- [ ] **Step 3: Run the checks and confirm they pass.** Run `node scripts/gate.mjs`. Expected: PASS.
- [ ] **Step 4: Commit and push.** Run `git commit -m "Swipe between profile tabs"`, then push.
- [ ] **Step 5: Device pass (`device-checker`), covering Tasks 13–16.** Check your own shelf and `fixture_alice`'s profile, in dark and light themes. It passes if:
  - the blocks float with shadows and there is no canvas slab;
  - the avatar sits before the name;
  - a left or right swipe switches tabs with a slide, both at the top and while the tab bar is pinned;
  - vertical scroll, pull-to-refresh and tab taps behave as before;
  - a swipe on the card does not switch tabs.

### Task 17: Profile tab swipe follows the finger

Asked by the user on 2026-11-03: "go with 1 first", that is, follow the finger. While a horizontal swipe is held, the current tab's rows move with the finger and fade. Released past the threshold, the switch happens and the new tab's rows slide in from that side. Released short of it, the rows spring back. The tab bar never moves. The single scroller, the hero and every guard from Task 16 stay.

**Files:**
- Modify: `mobile/src/features/community/ProfileScroller.tsx`
- Modify: `mobile/src/features/community/pinnedOffset.ts`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`
- Modify: `mobile/src/features/community/ProfileScreen.tsx`
- Modify: `mobile/src/features/murals/MuralCanvas.tsx`
- Test: `mobile/src/features/community/profileScroller.test.ts`

**Interfaces:**
- **Drag:** a `drag` shared value is driven by the pan's `onUpdate` on the UI thread. The current rows' `Animated.View` takes `translateX: drag` and `opacity: 1 - min(|drag| / width, 1) * 0.6`.
- **No neighbour:** at the first or last tab, the drag is rubber-banded to about a third of the finger's travel.
- **Release:** `swipeTarget` from Task 16 decides.
  - **Switch:** `drag` animates out to ±width·0.35 over 120 ms. When the tab bar is pinned, `select()` runs after the out-animation; otherwise it runs at release, overlapping the out-animation (amended by 91ae8d61: the serial chain added about 120 ms to every switch). The new rows enter with Task 16's slide, from the opposite side at ±24, so the motion reads as continuous.
  - **No switch:** `drag` springs back to 0 (`withSpring`, damping about 20).
- **Reset:** rows read `drag` only while `dragTab` is their tab, so new rows never inherit the offset; the pan's `onStart` also zeroes `drag` before claiming `dragTab`.
- **Reduced motion:** no drag translate. A release past the threshold switches instantly.
- **Activation:** `activeOffsetX([-12, 12])` and `failOffsetY([-12, 12])`, with the drag measured from the touch-down `absoluteX` so no travel is lost to activation (amended by 654f5532). Horizontal children such as the cover row keep their native scroll, which claims the touch first.
- **Kept from Task 16:** the hero guard and the pinned-offset flow from Task 16's last fixes.
- `rubberBand(dx: number, atEdge: boolean): number` in `pinnedOffset.ts`.

- [ ] **Step 1: Test.** `rubberBand(90, false)` is 90, and `rubberBand(90, true)` is 30.
- [ ] **Step 2: Implement** the Interfaces above.
- [ ] **Step 3: Run the checks and confirm they pass.** Run `node scripts/gate.mjs`. Expected: PASS.
- [ ] **Step 4: Commit and push.** Run `git commit -m "Let the profile tab swipe follow the finger"`, then push.
- [ ] **Step 5: Device pass (`device-checker`).**
  - The rows follow a held drag and spring back on a short release.
  - A long release switches tabs with continuous motion.
  - Edge tabs rubber-band.
  - Pinned switches don't jump.
  - The hero card and cover row don't drag the rows.

### Task 18: Profile tabs become a pager driven by one gesture

Asked by the user on 2026-11-03, after comparing Task 17 with a pager spike (`spike/profile-pager`, 769763bd, local only): "the pager feels better, build it properly". They also said "some swipes … end up not swiping and its jarring". A device pass on the spike found three causes:
- On the card or name row, nothing moved. The spike's detector was on a `pointerEvents="box-none"` header, and RNGH 3.3 on Android only records a detector's handlers when a child under the touch is a touch target. The card image, its Pressable and the name Text are not targets.
- On the tab bar, the page stayed still during the drag and then jumped on release.
- On content, react-native-pager-view sprang back unless the release was past half a page or was a fling, so a slow 90 px swipe never switched.

A diagonal swipe on a tappable Activity row also sometimes opened that row.

So the pages are not a native pager. One RNGH pan, over a root View that holds both the header and the pages, moves a row of pages, so a swipe follows the finger wherever it starts. Release uses Task 16's `swipeTarget`, the same thresholds everywhere. The card and tab bar float above the pages and never move sideways. Task 17's follow-the-finger rows, slide-in, out-animation and `pinnedOffset` go away.

Accepted, by the user after the spike or as Claude's call:
- During the collapse on Android, the floating header can trail the list by about a frame (Reanimated scroll-driven style; see PR #231).
- Swipes that start on a horizontal cover row scroll the covers, not the tabs.
- A tab keeps its own scroll position only while the tab bar is pinned. While the header is partly open, every page follows the active one so the header doesn't jump.
- Every tab's page mounts when a profile opens, so Daily, mural, library and activity all fetch at once.
- Pull-to-refresh starts from the rows, not by pulling down on the card.

**Files:**
- Modify: `mobile/src/features/community/ProfileScroller.tsx`
- Modify: `mobile/src/features/community/pinnedOffset.ts`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`
- Modify: `mobile/src/features/community/ProfileScreen.tsx`
- Test: `mobile/src/features/community/profileScroller.test.ts`

**Interfaces:**
- **Props:** `ProfileScroller<T>({ hero, backdrop, notice, tabs, value, onChange, sectionFor, accessibilityLabel })`.
  - `sectionFor: (tab: T) => ProfileSection` replaces `section`. Both screens already have `sectionFor`.
  - `ProfileSection`, `elementSection`, `transparentHeader` and `usePlainHeader` keep their names and shapes.
  - The tab count is fixed per screen. Create `tabs.map(() => useAnimatedRef<FlatList<unknown>>())`, `tabs.map(() => useSharedValue(0))` (each page's `scrollY`) and `tabs.map(() => useSharedValue(0))` (each page's content height, from `onContentSizeChange`) once in `ProfileScroller`, held in a ref.
- **Tree:** the outer View holds, in this order:
  1. the root View, with default `pointerEvents` (never `box-none`) and `collapsable={false}`, inside the `GestureDetector`;
  2. `notice`, placed as today: last, `pointerEvents="box-none"`, at `top: headerHeight`, outside the root.

  The root holds, in this order:
  1. the header, `zIndex: 1`, rendered first so screen readers read it before the rows;
  2. the pages box.
- **Pages box:** `marginTop: useHeaderHeight()`, `overflow: "hidden"`, `flex: 1`. Its `onLayout` height is `viewport`. It holds a row `Animated.View` of `tabs.length` pages, each `width` wide (`useWindowDimensions`), with `translateX: -x`.
  - `x` is a shared value in pixels, `activeIndex * width` at rest.
  - When `width` changes, snap `x` to `activeIndex * width`.
  - Inactive pages get `importantForAccessibility="no-hide-descendants"` and `accessibilityElementsHidden`.
- **Each page:** an `Animated.FlatList` over `sectionFor(tab)`.
  - Its `ListHeaderComponent` is an empty spacer of height `heroHeight + tabBarHeight`.
  - `contentContainerStyle` has `minHeight: heroHeight + viewport` and `paddingBottom: spacing.huge`.
  - It takes the section's `onEndReached` (threshold 0.4), `ListEmptyComponent` and `ListFooterComponent`.
  - `scrollY` comes from its `useAnimatedScrollHandler`, whose `onBeginDrag` cancels `fling`.
  - **Android:** keep a RefreshControl mounted with `enabled={Boolean(section.onRefresh)}`, as Task 16 does, and add `progressViewOffset={heroHeight + tabBarHeight}`. **iOS:** render it only when `onRefresh` is set.
- **Header:** absolute at `top: 0`, full width. It is not translated itself.
  - `collapse = min(activeY, heroHeight)`, where `activeY` is the active page's `scrollY`, read on the UI thread.
  - On Android, clamp `activeY` at 0 first. On iOS, don't clamp, so the header follows the overscroll and the refresh spinner shows above the rows.
  - Inside the header:
    - the backdrop, `pointerEvents="none"`, absolute at `top: 0`, height `headerHeight + heroHeight`, with `translateY: -collapse`;
    - a clip View, `pointerEvents="box-none"`, `overflow: "hidden"`, absolute at `top: headerHeight`, height `heroHeight + tabBarHeight`, which never moves;
    - inside the clip, one `pointerEvents="box-none"` View with the hero and the tab bar, with `translateY: -collapse`.
  - Because the clip stays put, the hero is cut off at the nav bar once it is pinned. Where the content has moved up, the clip is empty and passes touches through to the pages.
  - Measure `heroHeight` and `tabBarHeight` with `onLayout`, into both state and shared values.
  - The tab bar keeps ProfileScroller's tab look.
  - The indicator is one bar with a Reanimated style interpolated from `x / width` across the measured tab layouts, so it slides with the finger.
- **Swipe:** `Gesture.Pan()` with `activeOffsetX([-12, 12])` and `failOffsetY([-12, 12])`. Stay on the `Gesture.*` builder API the file already uses (deprecated in RNGH 3.3, but the hook API detects touches differently). Don't add a hero guard, because a swipe on the card pages too.
  - **onTouchesDown:** record the touch-down `absoluteX`.
  - **onStart:**
    - `cancelAnimation(x)` and `cancelAnimation(fling)`.
    - Sync every other page to `syncedOffset(activeY, itsY, heroHeight)` with `scrollTo(ref, 0, offset, false)`, and set its `scrollY`. Do this synchronously in the worklet.
    - Remember `startX = x`.
  - **onUpdate:** `x = dragX(startX, absoluteX - downX, tabs.length, width)`.
  - **onEnd(event, success):**
    - `target = success ? swipeTarget(order, current, absoluteX - downX, velocityX) ?? current : current`.
    - Set `activeIndex` to the target index, then animate `x` to `targetIndex * width` with `withTiming` over `settleDuration(distance, velocityX)` and `Easing.out(Easing.cubic)`. This amends the spring: on the phone the user found the spring didn't match Library's pager, which finishes in about 300 ms at the finger's speed.
  - `settleDuration(distance, velocity)` in `pinnedOffset.ts` is `3 · distance / |velocity|` in ms, so an out-cubic settle starts at the finger's speed, clamped to 150–300 ms. At zero velocity it is 300 ms. Tab taps use it with velocity 0.
    - When the target differs, call `scheduleOnRN` at release, through the existing `latest` ref pattern, so `onChange` gets the target value.
  - **Reduced motion:** no follow during the drag, and `x` jumps to the target on release.
- **Vertical drags on the header:** `Gesture.Race` the swipe with a second `Gesture.Pan()`, `activeOffsetY([-8, 8])` and `failOffsetX([-12, 12])`.
  - In `onTouchesDown`, cancel `fling`, then fail unless `allTouches[0].y`, relative to the root, is in `[headerHeight, headerHeight + heroHeight + tabBarHeight - collapse)`.
  - **onStart:** `startY = activeY`.
  - **onUpdate:** `scrollTo(activeRef, 0, max(startY - translationY, 0), false)`.
  - **On release:** `fling.set(activeY)`, then `fling.set(withDecay({ velocity: -velocityY, clamp: [0, max(contentHeight - viewport, 0)] }))`.
  - A `useAnimatedReaction` on `fling` calls `scrollTo` on the active ref.
- **Tab tap:** in one worklet run with `scheduleOnUI`:
  1. cancel `fling` and `x`;
  2. run the same sync;
  3. set `activeIndex`;
  4. animate `x` to the tab with `withTiming(…, { duration: 220 })`, or jump under reduced motion.

  Then call `onChange`.
- **`value` changing from outside:** a `useEffect` on `value` acts only when `order.indexOf(value)` differs from `activeIndex` on the UI thread, and then does the same as a tab tap without calling `onChange`. Tap and swipe set `activeIndex` themselves, so their `onChange` echo is a no-op and never replaces the spring.
- **Rows under a swipe:** the pan's activation cancels the JS press in progress (RNGH `cancelsJSResponder`, true by default), so a horizontal or diagonal swipe never opens a row. Don't set `cancelsJSResponder(false)`. If a row still opens, the swipe didn't activate; report it rather than adding a workaround.
- **Pure helpers in `pinnedOffset.ts`, both `"worklet"`:**
  - `syncedOffset(activeY: number, ownY: number, heroHeight: number): number` is `activeY < heroHeight ? activeY : max(ownY, heroHeight)`. It is the offset another page takes so the header doesn't jump when that page comes in.
  - `dragX(startX: number, dx: number, count: number, width: number): number` is `startX - dx`. Past `0` or `(count - 1) * width`, the excess goes through `rubberBand(…, true)`.
  - Delete `pinnedOffset`, which has no caller left, and its test.
  - Keep `swipeTarget` and `rubberBand`.
- **Removed:** `SectionRow`, `slideIn`, `drag`/`dragTab`/`leaving`, the out-animation and the pinned-offset `select()`. Don't port the spike's `profileSwipeMode.ts` or its long-press toggle.

- [ ] **Step 1: Test.** In `profileScroller.test.ts`:
  - `syncedOffset(100, 500, 300)` is 100, `syncedOffset(400, 50, 300)` is 300, and `syncedOffset(400, 500, 300)` is 500.
  - `dragX(0, -100, 3, 320)` is 100, `dragX(320, 100, 3, 320)` is 220, `dragX(0, 90, 3, 320)` is -30, and `dragX(640, -90, 3, 320)` is 670.
  - Delete the `pinnedOffset` test.
- [ ] **Step 2: Implement** the Interfaces above.
- [ ] **Step 3: Run the checks and confirm they pass.** Run `node scripts/gate.mjs`. Expected: PASS.
- [ ] **Step 4: Commit and push.** Run `git commit -m "Make the profile tabs a pager driven by one gesture"`, then push.
- [ ] **Step 5: Device pass (`device-checker`).** Use own shelf (tabs Shelf, Activity, Daily) and fixture_alice (tabs Mural, Activity, Library, Daily), each at the top and pinned. Use these swipe shapes:
  - slow: 90 px over about 450 ms;
  - medium: 220 px over about 300 ms;
  - diagonal: dx 220, dy 50 over 300 ms.

  Use `adb shell input swipe` for the timed swipes, and `input motionevent` with 2 px first steps for hold-and-screenshot probes. Start from:
  - the card, (245, 200) on a 320×640 emulator at the top;
  - the name row, just above the tab bar;
  - the tab bar, top and pinned;
  - a plain row;
  - an Activity row that opens a profile or quiz on tap;
  - the Finished cover row;
  - empty space below the Daily tab.

  Expected:
  - Every swipe except a cover-row swipe follows the finger mid-drag, with a non-zero mid-frame difference. It switches when it passes 64 px or is fast, and the slow 90 px one switches too.
  - No row opens under a swipe.
  - A tap on the card opens the viewer.
  - A vertical drag and a fling on the card scroll the page.
  - Pinned: a tab keeps its scroll when you swipe away and back, and switching doesn't jump.
  - Pinned: no hero text draws over the nav bar.
  - The Android pull-to-refresh spinner shows below the tab bar.
