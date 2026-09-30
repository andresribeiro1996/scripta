# My shelf release 2, PR 2: the card block, its sheet and the public card. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader can place their reader card on any mural. It draws their plate from their own books, and tapping it shows the evidence. Visitors to a published shelf see the same plate and numbers, but never a title, author or series name. The My shelf preset includes the card when it's Settled.

**Architecture:**
- **Shared:** a new `readerCard` block type, plus two small helpers for the plate's text and the accessible label.
- **Backend:** computes `publicReaderCard(readerIdentity(allBooks, groups))` for murals that hold the block, following exactly the path `shelfTheme` takes today.
- **Clients:** draw the plate with `renderPlate` (#36).
  - Web renders it inline, and its evidence sheet lives in the existing `MuralBlockDetail`.
  - Mobile uses `SvgXml` plus a press target that opens a sheet.

**Tech Stack:** `@scripta/shared`, Fastify, React + Tailwind, Expo + react-native-svg.

**Spec:** `docs/superpowers/specs/2026-09-26-my-shelf-release-2-design.md`, section "2. The card block, its sheet, and the public card".

**Base:** `origin/main` (0cfc2d66 or later: #36 plates, #38, #39 `readerIdentity` merged).

## Global Constraints

- **Rendering:**
  - Plates come from `renderPlate({ identity, state, readerName, print, label, unwrittenLine })`. Glyphs aren't used in this PR.
  - Print is `"paper"` in the light theme and `"reversed"` in the dark theme.
  - The accessible label goes on the element around the SVG, e.g. "Reader card: the Stargazer, leaning". `SvgXml` drops ARIA attributes.
- **Privacy:** visitors get only `publicReaderCard` fields (`state`, `identity`, `runnerUp`, `signal`, `coverage`). `leaders` and `missing` never leave the owner's device. A backend test asserts no title, author or series name from the library appears in the public payload.
- **Sheet contents:**
  - The identity's name and epithet. When Leaning with a `runnerUp`, both identities are named.
  - The `signal.label` and every `coverage` line.
  - **Owner only:** the leaders ("Discworld (14)") and, when Leaning or Unwritten, `missing`.
- **Plate line for Unwritten:** `missing` with its first letter lowercased (e.g. "finish 2 more books", "genres known for 4 of 10 books").
- **Preset:** `buildMuralPreset("shelf", books, groups)` includes a `readerCard` block below the profile block only when the result is Settled.
- **Genre lookup:** it must also start for a `readerCard` block in both mural editors, not only for a `profile` block.
- **Books hidden from the public shelf:** the library has no such feature, so the public card counting all books is correct. No option is added.
- **Android pitfall:** a multi-word Text shrink-wrapped to its own width can lose its last word. Pills use `numberOfLines={1}`, buttons stretch their label, and headings stretch or take `numberOfLines`. Device checks zoom into screenshot images; uiautomator text isn't enough.
- No code comments; no new packages. Run backend tests as `DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend`. In a worktree session, run git as `/usr/bin/git …` and don't run `npm install`.

## Rulings made while planning

- **No hidden-books handling:** hidden books don't exist, so there's nothing to exclude.
- **Web's sheet is the existing block detail:** `MuralBlockDetail` already opens when any block is tapped, so the card's sheet lives there rather than in a new component.
- **The mobile font check is gated:** the first mobile step renders one plate on the emulator and checks its colours, Playfair Display, and the sans labels. If the fonts fail, the fallback in the spec (Text over the SVG art) is ruled on then, before any more mobile work.

---

### Task 1: Shared block type, preset and helpers

**Files:**
- Modify: `packages/shared/src/murals/murals.ts` (the `MuralBlock` union, `BLOCK_TYPE_LABELS`, `DEFAULT_SIZE_BY_TYPE`, `defaultBlockForType`)
- Modify: `packages/shared/src/murals/presets.ts` (`buildMuralPreset(id, books, groups?)`)
- Create: `packages/shared/src/readerCards/card.ts`, `packages/shared/src/readerCards/card.test.ts`
- Modify: `packages/shared/src/readerCards/index.ts` (`export * from "./card.js";`)
- Modify: `packages/shared/src/murals/presets.test.ts`

**Interfaces:**
- Produces:
  - block variant `{ type: "readerCard" }` (with `MuralBlockBase`);
  - `BLOCK_TYPE_LABELS.readerCard = "Reader card"`, with a default size of 4 wide by 6 high;
  - `readerCardLabel(identity: { state: CardState; identity: IdentityKey | null }): string`;
  - `readerCardPlateLine(missing: string | null): string | undefined`;
  - `buildMuralPreset(id: MuralPresetId, books, groups: Group[] = [])`.

- [ ] **Step 1: Failing tests**

`packages/shared/src/readerCards/card.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { readerCardLabel, readerCardPlateLine } from "./card.js";

test("the card's accessible label names the identity and how sure it is", () => {
  assert.equal(readerCardLabel({ state: "settled", identity: "star" }), "Reader card: the Stargazer");
  assert.equal(readerCardLabel({ state: "leaning", identity: "carto" }), "Reader card: the Cartographer, leaning");
  assert.equal(readerCardLabel({ state: "unwritten", identity: null }), "Reader card: unwritten");
});

test("the Unwritten plate line is the missing sentence with a lowercase first letter", () => {
  assert.equal(readerCardPlateLine("Finish 2 more books"), "finish 2 more books");
  assert.equal(readerCardPlateLine("Genres known for 4 of 10 books"), "genres known for 4 of 10 books");
  assert.equal(readerCardPlateLine(null), undefined);
});
```

Add to `packages/shared/src/murals/presets.test.ts`:

```ts
test("the My shelf preset adds a settled reader card below the profile", () => {
  const books = Array.from({ length: 10 }, (_, i) => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2 }));
  const groups = [{ id: "g", type: "series" as const, name: "S", bookKeys: books.slice(0, 3).map((b) => `ta:${String(b.Title).toLowerCase()}|${String(b.Attribution).toLowerCase()}`), createdAt: "", updatedAt: "" }];
  const blocks = buildMuralPreset("shelf", books, groups).blocks;
  const card = blocks.find((block) => block.type === "readerCard");
  const profile = blocks.find((block) => block.type === "profile")!;
  assert.ok(card, "settled card is placed");
  assert.equal(card.layout.y, profile.layout.y + profile.layout.h);
  assert.equal(buildMuralPreset("shelf", books.slice(0, 4), []).blocks.some((block) => block.type === "readerCard"), false);
});
```

Check the preset's existing block order before writing the `y` expectation. The card goes directly below the profile block, and the blocks under it shift down by the card's height.

- [ ] **Step 2: Implement**

`packages/shared/src/readerCards/card.ts`:

```ts
import { READER_PLATES, type IdentityKey } from "./plates.js";
import type { CardState } from "./render.js";

export function readerCardLabel({ state, identity }: { state: CardState; identity: IdentityKey | null }): string {
  if (state === "unwritten" || !identity) return "Reader card: unwritten";
  const name = READER_PLATES.find((plate) => plate.key === identity)!.name;
  return `Reader card: the ${name}${state === "leaning" ? ", leaning" : ""}`;
}

export function readerCardPlateLine(missing: string | null): string | undefined {
  return missing ? missing.charAt(0).toLowerCase() + missing.slice(1) : undefined;
}
```

In `murals.ts`:
- add `| (MuralBlockBase & { type: "readerCard" })` to `MuralBlock`;
- add `readerCard: "Reader card"` to `BLOCK_TYPE_LABELS`;
- add `readerCard: { w: 4, h: 6 }` to `DEFAULT_SIZE_BY_TYPE`;
- add `case "readerCard": return { id, type, layout };` to `defaultBlockForType`.

Fix any exhaustive `switch`/`Record<BlockType, …>` the compiler flags, in shared and in both clients. Where a client has a per-type renderer, return the plate in Tasks 3–4. Until then, a TypeScript `never` check may need a temporary branch that renders nothing. Tasks 3 and 4 replace it.

In `presets.ts`, `buildMuralPreset` gains `groups: Group[] = []`. In the shelf branch, compute `readerIdentity(library, groups)`. When its state is `"settled"`, push `{ ...at(0, profileBottom, 6, 8), type: "readerCard" }` below the profile block and move the running `y` down by 8. Import `readerIdentity` from `../library/readerIdentity.js`. The 6×8 size is checked on the emulator in Task 3. Callers that pass no groups (the Murals preset pickers) still work.

- [ ] **Step 3: Pass groups at the My shelf call sites**

Pass the library's groups to `buildMuralPreset("shelf", …)`:
- `mobile/src/features/community/MyShelfScreen.tsx`;
- `frontend/src/components/OwnShelfView.tsx`;
- both preset pickers (`mobile/src/features/murals/MuralsScreen.tsx` and `frontend/src/components/murals/MuralPresetPicker.tsx`).

Each already has `library?.data.groups` in reach.

- [ ] **Step 4: Verify and commit**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`, then typecheck mobile, frontend and backend.

```bash
/usr/bin/git add packages/shared mobile/src frontend/src
/usr/bin/git commit -m "Shared: the reader card block, its label and plate line, and the preset card"
```

---

### Task 2: Backend public card

**Files:**
- Modify: `backend/src/modules/murals/domain/blockRefs.ts` (`needsReaderCard`)
- Modify: `backend/src/modules/murals/domain/publicPayload.ts` (pass `needsReaderCard`)
- Modify: `backend/src/modules/library/publicResolver.ts` (`ResolvedPublicData.readerCard?`, `PublicDataRequest.needsReaderCard?`)
- Modify: `backend/src/modules/murals/routes.ts:~306` (shared-mural response carries `readerCard` next to `shelfTheme`)
- Modify: the community profile payload type in `frontend/src/api/community.ts:~29` and `mobile/src/features/community/api.ts:~27`, plus `frontend/src/api/sharedMurals.ts:~39`: add `readerCard?: PublicReaderCard` beside `shelfTheme`
- Test: `backend/src/modules/murals/home.test.ts` (or whichever test file covers `shelfTheme` in the public payload, around `:63`)

**Interfaces:**
- Consumes: `readerIdentity`, `publicReaderCard` and `type PublicReaderCard` from `@scripta/shared`.
- Produces: `library.readerCard?: PublicReaderCard` in the public mural and profile payloads, and `readerCard` in the shared-mural response.

- [ ] **Step 1: Failing test**

Next to the existing `shelfTheme` payload test, add a test:
- **Setup:** a user whose library has 10 finished books. Three share a `series` group named "Secret Series", and the titles are distinctive, e.g. "Klara 1". A mural holds a `{ type: "readerCard" }` block.
- **Assert** the public payload's `readerCard` equals `{ state: "settled", identity: "carto", runnerUp: null, signal: { counted: 3, of: 10, label: "3 of 10 finished books are in a series" }, coverage: [...] }`.
- **Assert** `JSON.stringify(payload.readerCard)` contains neither "Secret Series" nor "Klara".
- **Assert** a mural without the block has no `readerCard` key.

Use the same fixtures and helpers as the file's existing tests.

- [ ] **Step 2: Implement, following `shelfTheme` exactly**
- **`blockRefs.ts`:** add `needsReaderCard: boolean` (default `false`), and set it in a `case "readerCard":`.
- **`publicPayload.ts`:** pass `needsReaderCard: refs.needsReaderCard` into the request, beside `needsShelfTheme`.
- **`publicResolver.ts`:** add `...(req.needsReaderCard ? { readerCard: publicReaderCard(readerIdentity(allBooks, groups)) } : {})`. The resolver already loads the library document; take `groups` from its `groups` (default `[]`).
- **`routes.ts:~306`:** add `readerCard: payload.library.readerCard`.
- Check the community profile route passes the resolved library data through unchanged. If it copies fields one by one, add `readerCard` there too.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck --workspace backend && DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend`, and typecheck frontend and mobile for the payload types.

```bash
/usr/bin/git add backend/src frontend/src/api mobile/src/features/community/api.ts
/usr/bin/git commit -m "Backend: published murals carry the public reader card"
```

---

### Task 3: Mobile card and sheet

**Files:**
- Create: `mobile/src/features/murals/ReaderCardBlock.tsx`
- Modify: `mobile/src/features/murals/MuralCanvas.tsx` (`BlockContent` branch for `readerCard`; `readerCardOverride` prop threaded like `shelfThemeOverride`)
- Modify: `mobile/src/features/community/ProfileScreen.tsx:~123` (pass `readerCardOverride={muralData?.library.readerCard}`)
- Modify: `mobile/src/features/murals/MuralEditorScreen.tsx:60` (start genre lookup when any block is `profile` or `readerCard`)

**Interfaces:**
- Consumes: `renderPlate`, `readerCardLabel`, `readerCardPlateLine`, `readerIdentity`, `READER_PLATES` and `PublicReaderCard` from `@scripta/shared`, and `SvgXml` from `react-native-svg`.
- Produces: `ReaderCardBlock({ books, groups, readerName, publicCard }: { books; groups: Group[]; readerName: string; publicCard?: PublicReaderCard })`. When `publicCard` is given, it renders that and shows no leaders or missing line. Otherwise it computes `readerIdentity(books, groups)` with `useMemo`.

- [ ] **Step 1: One plate on the emulator, before anything else**

Build the `ReaderCardBlock` render with no sheet yet, put a `readerCard` block on the dev account's shelf through the mural editor, and take an emulator screenshot. Zoom into it and check:
- the frame, the emblem and the text are in the plate's ink, and nothing is black;
- the name renders in Playfair Display;
- "EX LIBRIS", the eyebrow and the foot render in a sans font, in full.

Use `node scripts/dev-status.mjs --json` once. `node scripts/dev-emulator.mjs` adopts an unleased `emulator-5554`. Change the account only through the app's UI, and never write to the database directly.

If the fonts are wrong, stop and report BLOCKED with the screenshot. The controller rules on the spec's fallback (Text over the art) before more work. If they're right, continue.

- [ ] **Step 2: `ReaderCardBlock`**

```tsx
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { READER_PLATES, readerCardLabel, readerCardPlateLine, readerIdentity, renderPlate, type Group, type PublicReaderCard } from "@scripta/shared";
import { Sheet, spacing, typography, useTheme } from "../../ui";

export function ReaderCardBlock({ books, groups, readerName, publicCard }: { books: Array<Record<string, unknown>>; groups: Group[]; readerName: string; publicCard?: PublicReaderCard }) {
  const { colors, mode } = useTheme();
  const [open, setOpen] = useState(false);
  const own = useMemo(() => (publicCard ? null : readerIdentity(books, groups)), [books, groups, publicCard]);
  const card = publicCard ?? own!;
  const label = readerCardLabel(card);
  const xml = useMemo(() => renderPlate({ identity: card.identity, state: card.state, readerName, print: mode === "dark" ? "reversed" : "paper", label, unwrittenLine: readerCardPlateLine(own?.missing ?? null) }), [card, readerName, mode, label, own]);
  const name = (key: string | null) => READER_PLATES.find((plate) => plate.key === key)?.name;
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={styles.plate}>
        <SvgXml xml={xml} width="100%" height="100%" />
      </Pressable>
      <Sheet visible={open} title={card.identity ? `The ${name(card.identity)}` : "Unwritten"} onClose={() => setOpen(false)}>
        <View style={styles.sheet}>
          {card.runnerUp ? <Text style={[typography.body, { color: colors.text }]}>Leaning between the {name(card.identity)} and the {name(card.runnerUp)}</Text> : null}
          {card.signal ? <Text style={[typography.body, { color: colors.text }]}>{card.signal.label}</Text> : null}
          {card.coverage.map((line) => <Text key={line} style={[typography.caption, { color: colors.textDim }]}>{line}</Text>)}
          {own?.leaders.map((leader) => <Text key={leader.label} style={[typography.body, { color: colors.text }]}>{leader.label} ({leader.count})</Text>)}
          {own?.missing ? <Text style={[typography.body, { color: colors.textDim }]}>{own.missing}</Text> : null}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  plate: { flex: 1, aspectRatio: 5 / 7, alignSelf: "center" },
  sheet: { gap: spacing.sm },
});
```

Match the import paths and `useTheme()` field names to the surrounding mobile code. `mode` is how `Segmented` reads the theme. Also show the identity's epithet under the sheet title, from `READER_PLATES`.

- [ ] **Step 3: Wire it in**
- **`MuralCanvas.tsx`:** `BlockContent` gets a `readerCardOverride?: PublicReaderCard` prop, threaded through the same components that pass `shelfThemeOverride`, and a branch `if (block.type === "readerCard") return <ReaderCardBlock books={books} groups={groups} readerName={profile?.username ?? "reader"} publicCard={readerCardOverride} />;`. `groups` is already a `MuralCanvas` prop; thread it to `BlockContent` if it isn't there.
- **In editable mode,** the canvas's own Pressable handles selection, so the card's Pressable must not steal the press. Render the plate without the Pressable when `editable`.
- **`ProfileScreen.tsx`:** pass `readerCardOverride={muralData?.library.readerCard}` next to `shelfThemeOverride`.
- **`MuralEditorScreen.tsx:60`:** change `currentBlocks.some((block) => block.type === "profile")` to include `readerCard`.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`.

```bash
/usr/bin/git add mobile/src
/usr/bin/git commit -m "Mobile: the reader card block and its sheet"
```

---

### Task 4: Web card and sheet

**Files:**
- Create: `frontend/src/components/murals/blocks/ReaderCardBlock.tsx`
- Modify: every web renderer that switches on block type and takes `shelfThemeOverride`:
  - `BlockRenderer.tsx`;
  - `MobileBlockPreview.tsx`;
  - `MobileMuralCanvas.tsx`;
  - `MuralCanvas.tsx`;
  - `MuralBlockDetail.tsx`, which is the sheet.

  Each gets a `readerCardOverride?: PublicReaderCard` prop and a `readerCard` branch.
- Modify: `frontend/src/pages/CommunityProfilePage.tsx:~137` and `frontend/src/pages/SharedMuralPage.tsx:~119` (pass `readerCardOverride`)
- Modify: `frontend/src/pages/MuralEditorPage.tsx:74` (genre lookup for `readerCard` too)

**Interfaces:**
- Consumes: the same shared helpers as Task 3.
- Produces:
  - `ReaderCardPlate({ card, readerName, unwrittenLine })` renders the plate;
  - `ReaderCardDetail({ card, own })` renders the sheet contents inside `MuralBlockDetail`;
  - `useReaderCard(books, groups, override)` returns `{ card, own }`.

- [ ] **Step 1: Components**

```tsx
import { useMemo } from "react";
import { READER_PLATES, readerCardLabel, readerCardPlateLine, readerIdentity, renderPlate, type Group, type PublicReaderCard, type ReaderIdentity } from "@scripta/shared";

export function useReaderCard(books: Array<Record<string, unknown>>, groups: Group[], override?: PublicReaderCard) {
  const own = useMemo(() => (override ? null : readerIdentity(books, groups)), [books, groups, override]);
  return { card: (override ?? own)!, own };
}

export function ReaderCardPlate({ card, own, readerName, dark }: { card: PublicReaderCard; own: ReaderIdentity | null; readerName: string; dark: boolean }) {
  const label = readerCardLabel(card);
  const svg = useMemo(() => renderPlate({ identity: card.identity, state: card.state, readerName, print: dark ? "reversed" : "paper", label, unwrittenLine: readerCardPlateLine(own?.missing ?? null) }), [card, own, readerName, dark, label]);
  return <span role="img" aria-label={label} className="mx-auto block aspect-[5/7] h-full max-w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function ReaderCardDetail({ card, own }: { card: PublicReaderCard; own: ReaderIdentity | null }) {
  const plate = (key: string | null) => READER_PLATES.find((item) => item.key === key);
  return (
    <div className="space-y-2">
      {card.identity ? <p className="font-serif italic text-(--color-text-dim)">{plate(card.identity)?.epithet}</p> : null}
      {card.runnerUp ? <p>Leaning between the {plate(card.identity)?.name} and the {plate(card.runnerUp)?.name}</p> : null}
      {card.signal ? <p>{card.signal.label}</p> : null}
      {card.coverage.map((line) => <p key={line} className="text-sm text-(--color-text-dim)">{line}</p>)}
      {own?.leaders.length ? <ul className="text-sm">{own.leaders.map((leader) => <li key={leader.label}>{leader.label} ({leader.count})</li>)}</ul> : null}
      {own?.missing ? <p className="text-sm text-(--color-text-dim)">{own.missing}</p> : null}
    </div>
  );
}
```

The dark flag comes from however the web app knows its theme. Check how `ProfileBlockView` or `DESIGN.md` handles light and dark. If only CSS knows it, render both prints and toggle them with the existing dark-mode class or media query. `renderPlate`'s inline styles make that safe. `renderPlate` escapes its inputs (#36), so `dangerouslySetInnerHTML` is safe here.

- [ ] **Step 2: Wire it in**

Add a `readerCard` branch to each renderer listed under Files.
- **Plate branches:** `BlockRenderer`, `MobileBlockPreview` and the canvases render `ReaderCardPlate`.
- **Sheet branch:** `MuralBlockDetail` renders the plate and `ReaderCardDetail`, and titles the sheet with the identity's name.
- **Overrides:** thread `readerCardOverride` wherever `shelfThemeOverride` is threaded, and pass it from `CommunityProfilePage` and `SharedMuralPage`.
- **Genre lookup:** in `MuralEditorPage.tsx:74`, include `readerCard` in the `useGenreEnrichment` condition.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`, with lint staying at the 16-warning baseline and no new warnings in touched files.

```bash
/usr/bin/git add frontend/src
/usr/bin/git commit -m "Web: the reader card block and its detail sheet"
```

---

### Task 5: Verification and device check

- [ ] **Step 1: Merge main and run everything**

Run the shared build and tests, backend typecheck and tests (with the env preamble), frontend typecheck, lint and tests, mobile typecheck and tests, and `npx expo-doctor`.

- [ ] **Step 2: Device check (mobile)**

Use `node scripts/dev-status.mjs --json` once. `dev-emulator.mjs` adopts an unleased `emulator-5554`. Change the account only through the UI, never by writing the database, and put everything back afterwards: remove any block you added and switch the shelf mural back.

Zoom into every screenshot. Check:
- **On My shelf:** a `readerCard` block renders the fixture's card, which PR 1 recorded as leaning Cartographer, "3 of 11 finished books are in a series". Check it in both themes, with the right ink, Playfair name, sans labels, and "LEANING TOWARD" in full.
- **Tapping the plate:** the sheet shows the Cartographer and its epithet, the signal line, the coverage lines, the leaders (the two series), and the missing line.
- **The published shelf as a visitor:** use the `/u/<dev username>` route in the web app from a second session, or the mobile `ProfileScreen` for another account if the fixture has one. The plate and numbers show, with no leaders and no missing line. If no second account is available, check the public payload's `readerCard` through the API response in the web app's network panel, and say so.
- **The preset:** a fresh "My shelf" preset on the fixture has no card, because it's Leaning, not Settled.
- **Genre lookup:** adding a card to a mural in the editor starts it. The coverage line's "genres known for N" goes up once it finishes; say if lookup is unavailable offline.

Run `npm run dev:release` at the end.

- [ ] **Step 3: Report**

List every check with pass/fail and counts, the screenshot paths, and the account state left.

---

## Self-review

- **Spec coverage:**
  - the block type, label, size and both editors' Add block menus (Task 1, since the menus read `BLOCK_TYPE_LABELS`);
  - owner rendering from the owner's own books (Tasks 3 and 4) and public rendering through `publicReaderCard` (Task 2);
  - the sheet contents with the owner-only parts (Tasks 3 and 4);
  - the preset card when Settled (Task 1);
  - labels on the wrapper, and colours and fonts checked on the emulator first (Task 3 Step 1);
  - genre lookup for the card (Tasks 3 and 4).
- **Types:** `PublicReaderCard` and `ReaderIdentity` come from `@scripta/shared` (#39). `readerCardOverride` is named the same way on both clients as `shelfThemeOverride`.
