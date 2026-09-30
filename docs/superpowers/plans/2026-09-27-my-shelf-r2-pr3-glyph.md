# My shelf release 2, PR 3: the glyph and its switch. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A published reader who switches on "Show my reader glyph next to my name" gets their Settled identity's small glyph next to their username wherever other readers see it.

**Architecture:**
- `FeedSettings` gains an optional `readerGlyph` flag, default off.
- The library module exposes `readerGlyphFor(userId)`, which returns the identity key only when Settled.
- The community service adds `readerGlyph` to every `CommunityAuthor` it builds for another reader, when that reader is published and has the flag on. It's memoised per response.
- Clients draw `renderGlyph` at 24px after the username.

**Tech Stack:** `@scripta/shared`, Fastify + zod, React + Tailwind, Expo + react-native-svg.

**Spec:** `docs/superpowers/specs/2026-09-26-my-shelf-release-2-design.md`, section "3. The glyph and its switch".

**Base:** `origin/main` after PR 2 merges. PR 3 doesn't depend on PR 2's code, but it's merged after it, so the card sheet exists first.

## Global Constraints

- **The switch:** its exact copy is "Show my reader glyph next to my name", and it's off by default. Stored rows without the field read as off.
- **When a glyph shows:** all three must hold:
  1. the author is published;
  2. their switch is on;
  3. their `readerIdentity` state is `"settled"`.

  Leaning and Unwritten show nothing.
- **Where:** a 24px `renderGlyph(identity, 24, print)` right after the username, on both clients:
  - Activity and Home feed rows;
  - Discover items;
  - People search results;
  - a published profile's header.

  Print is paper in the light theme and reversed in the dark theme. It isn't tappable.
- **Accessible label:** "the <Name>" (e.g. "the Stargazer"), on the element around the SVG. `SvgXml` drops ARIA.
- **Payload:** only the key (`readerGlyph?: IdentityKey`) travels. Nothing else from any library enters a community payload.
- **Cost:** `readerGlyphFor` is called at most once per distinct author per response.
- **Android pitfall:** the glyph sits inside username rows. Those rows' multi-word Texts must not become shrink-wrapped by the change, so give the username Text `flexShrink: 1` / `numberOfLines={1}` where it sits in a row. Device checks zoom into screenshot images.
- No code comments; no new packages. Run backend tests as `DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend`. In a worktree session, run git as `/usr/bin/git …` and don't run `npm install`.

## Rulings made while planning

- **The flag is optional.** It's `readerGlyph?: boolean` in `FeedSettings`, and the zod schema accepts it as optional. That keeps old clients' saves valid, and absent means off.
- **The author's own rows get the glyph too.** Any `CommunityAuthor` in a response gets it, including the viewer's own rows, e.g. their own Discover items. The switch governs how they appear to everyone, so there's no reason to hide it from themselves. The cost is a mark the reader might not expect beside their own name.

---

### Task 1: Setting and backend

**Files:**
- Modify: `packages/shared/src/community/types.ts` (`FeedSettings.readerGlyph?: boolean`; `CommunityAuthor` gains `readerGlyph?: IdentityKey`)
- Modify: `packages/shared/src/community/*` wherever `DEFAULT_FEED_SETTINGS` is defined (add `readerGlyph: false`)
- Modify: `backend/src/modules/community/routes.ts:23` (`feedSettingsSchema` gains `readerGlyph: z.boolean().optional()`)
- Modify: `backend/src/modules/library/` public API (`readerGlyphFor(userId): IdentityKey | null`, exported from `library/index.ts`)
- Modify: `backend/src/modules/community/service.ts` (deps gain `readerGlyphFor`; one helper decorates authors)
- Modify: the community plugin or wiring that builds the service's deps (pass the library's `readerGlyphFor`)
- Test: `backend/src/modules/community/service.test.ts`, `backend/src/modules/library/*.test.ts`

**Interfaces:**
- Produces: `CommunityAuthor.readerGlyph?: IdentityKey`, `FeedSettings.readerGlyph?: boolean`, and library `readerGlyphFor(userId: string): IdentityKey | null`.

- [ ] **Step 1: Failing tests**
- **Library:** `readerGlyphFor` returns `"carto"` for a user whose library settles the Cartographer (10 finished books, 3 in a series group), and `null` for a Leaning library (11 finished, 3 in a series) or no library.
- **Community service,** using the file's `createRepoFake`/`createDeps` helpers with a stubbed `readerGlyphFor` that counts its calls:
  - Author A is published with `readerGlyph: true`, and the stub returns `"star"`. A's feed item actor has `readerGlyph: "star"`.
  - Author B is published with the switch off. There's no `readerGlyph` key, and the stub isn't called for B.
  - Author C is unpublished with the switch on. There's no key.
  - A page with 5 items by A calls the stub once for A.
  - The same checks apply to Discover items, People results and `getProfileByUsername`'s `user`.
- **Routes:** a `PUT` of feed settings with `readerGlyph: true` is accepted and stored. One without the field is still accepted.

- [ ] **Step 2: Implement**
- **Shared:** add the fields, and `readerGlyph: false` to `DEFAULT_FEED_SETTINGS`. Import `IdentityKey` from `../readerCards/index.js`.
- **Library `readerGlyphFor`:** read the user's library document the way `resolvePublicLibrary` does, then `const id = readerIdentity(doc.books ?? [], doc.groups ?? []); return id.state === "settled" ? id.identity : null;`. Return `null` when there's no document.
- **Community service:** add a function used everywhere a `CommunityAuthor` is built. It takes the ids from `deps.resolveProfiles` and returns a `Map<userId, IdentityKey | null>`:
  - It includes an id only when that user is published and `settingsFor(id).readerGlyph` is true.
  - It calls `deps.readerGlyphFor(id)` once per id.
  - Every place that builds `{ ...author, userId }` spreads `readerGlyph` in when the map has a key for that user: feed actors, Discover authors, People results, and the published profile `user`.
  - Find those places with `grep -n "userId: event.user_id\|user: {" service.ts` and check each.
- **Wiring:** pass the library's `readerGlyphFor` into the community deps where `resolveLibrary` is passed today.

- [ ] **Step 3: Verify and commit**

Run the shared build and tests, `npm run typecheck --workspace backend`, `DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend`, and the frontend and mobile typechecks.

```bash
/usr/bin/git add packages/shared backend/src
/usr/bin/git commit -m "Community authors carry a reader glyph when the reader shows it"
```

---

### Task 2: The switch and the glyph on mobile

**Files:**
- Create: `mobile/src/features/community/ReaderGlyph.tsx`
- Modify: `mobile/src/features/community/FeedSettingsDialog.tsx` (the switch row)
- Modify: the username rows:
  - `mobile/src/features/home/FeedRow.tsx`;
  - the Discover item row (`DiscoverPane.tsx`);
  - People results (`PeoplePane.tsx`);
  - `ProfileScreen.tsx`'s header.

**Interfaces:**
- Produces: `ReaderGlyph({ identity }: { identity?: IdentityKey })` renders nothing when `identity` is undefined.

- [ ] **Step 1: `ReaderGlyph`**

```tsx
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { READER_PLATES, renderGlyph, type IdentityKey } from "@scripta/shared";
import { useTheme } from "../../ui";

export function ReaderGlyph({ identity }: { identity?: IdentityKey }) {
  const { mode } = useTheme();
  if (!identity) return null;
  const name = READER_PLATES.find((plate) => plate.key === identity)!.name;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`the ${name}`} style={{ width: 24, height: 24 }}>
      <SvgXml xml={renderGlyph(identity, 24, mode === "dark" ? "reversed" : "paper")} width={24} height={24} />
    </View>
  );
}
```

- [ ] **Step 2: Place it after each username**

In each row, put `<ReaderGlyph identity={author.readerGlyph} />` right after the username Text, inside the same row View with `gap: spacing.xs` and `alignItems: "center"`. Give the username Text `flexShrink: 1` and `numberOfLines={1}`, so it never shrink-wraps.

- [ ] **Step 3: The switch**

In `FeedSettingsDialog.tsx`, add a switch row "Show my reader glyph next to my name", bound to `readerGlyph ?? false`, and saved with the other settings. Use the same Switch/row component the dialog's other rows use.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`.

```bash
/usr/bin/git add mobile/src
/usr/bin/git commit -m "Mobile: reader glyphs beside usernames, and the switch to show yours"
```

---

### Task 3: The switch and the glyph on web

**Files:**
- Create: `frontend/src/components/ReaderGlyph.tsx`
- Modify: the web feed-settings controls in `OwnShelfView.tsx` (the switch row)
- Modify: the username rows in the web feed, Discover, People and `CommunityProfilePage` header components. Find them by where `CommunityAuthor` usernames render, e.g. `grep -rn "\.username" frontend/src/components frontend/src/pages`.

- [ ] **Step 1: `ReaderGlyph`**

```tsx
import { READER_PLATES, renderGlyph, type IdentityKey } from "@scripta/shared";

export function ReaderGlyph({ identity }: { identity?: IdentityKey }) {
  if (!identity) return null;
  const name = READER_PLATES.find((plate) => plate.key === identity)!.name;
  return (
    <span role="img" aria-label={`the ${name}`} className="inline-flex h-6 w-6 shrink-0 align-middle">
      <span className="contents dark:hidden" dangerouslySetInnerHTML={{ __html: renderGlyph(identity, 24, "paper") }} />
      <span className="hidden dark:contents" dangerouslySetInnerHTML={{ __html: renderGlyph(identity, 24, "reversed") }} />
    </span>
  );
}
```

Match the project's dark-mode mechanism: check how other components switch on theme. If `dark:` isn't how this app does it, use its equivalent. `renderGlyph`'s inline styles make two copies on a page safe.

- [ ] **Step 2: Place it and add the switch**

Put `<ReaderGlyph identity={author.readerGlyph} />` after each username, and add the switch row to the owner's feed settings in `OwnShelfView.tsx`.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`, with lint at the 16-warning baseline and none in touched files.

```bash
/usr/bin/git add frontend/src
/usr/bin/git commit -m "Web: reader glyphs beside usernames, and the switch to show yours"
```

---

### Task 4: Verification and device check

- [ ] **Step 1: Merge main and run everything.** Use the same command list as the other release-2 PRs.

- [ ] **Step 2: Device check (mobile)**

Use `node scripts/dev-status.mjs --json` once. `dev-emulator.mjs` adopts an unleased `emulator-5554`. Change the account only through the UI, never by writing the database, and put everything back afterwards: switch the setting back off and restore the publish state.

The fixture reads leaning Cartographer, so its own glyph won't show. Check:
- The switch appears in Feed settings, saves, and survives a reopen.
- With the switch on, the fixture's own rows show no glyph, because the card is Leaning.
- If the fixture has another published account with a Settled library, its glyph shows beside its name in Activity, Discover and People, and in its profile header, in both themes. Zoom in to confirm the username is still in full and the glyph is its ink colour. If no Settled account exists, say so. The backend tests carry that case, and the report should list which UI checks couldn't be made.

Run `npm run dev:release` at the end.

- [ ] **Step 3: Report**

List every check with pass/fail, the screenshot paths, and the account state left.

---

## Self-review

- **Spec coverage:**
  - the setting's copy, default and storage (Task 1);
  - the three conditions, and Settled only (Task 1 tests);
  - the four places on both clients (Tasks 2 and 3);
  - labels on the wrapper, and only the key in the payload (Task 1);
  - the cost: once per distinct author per response (Task 1 test).

  The spec's large-library performance test is covered by #39's measured timings, about 3 ms for 500 books, and the per-response memo. Storing the key at save time stays the fallback.
- **Types:** `IdentityKey` comes from `readerCards`. `CommunityAuthor.readerGlyph` is optional, so every existing consumer still compiles.
