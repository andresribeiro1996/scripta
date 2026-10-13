# Mobile Tabs and Home Implementation Plan

> **For agentic workers:** run each task with the `implementer` agent, then `spec-reviewer`, then `quality-reviewer` (CLAUDE.md). Device passes go to `device-checker`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Library its own tab and fold My shelf, Murals and Settings into a new You tab. Then make Home show your current books with one-tap actions and the whole feed from people you follow.

**Architecture:**
- **Phase 1** is route work in `mobile/src/app/(app)`.
  - The `(library)` stack's root becomes LibraryScreen.
  - A new `(you)` stack holds a small hub plus the screens that used to be tabs. Their URLs don't change.
  - Cross-tab routes move into shared groups that include `you`.
- **Phase 2** rewrites `HomeScreen` as one `FlatList`.
  - Its header is built from today's `buildDashboardCards` output through a tested `homeSections` model.
  - Its rows are the dashboard feed, so Community's Activity tab goes away.
- No backend or API changes.

**Tech Stack:** Expo Router 57 + React Native, TanStack Query v5, `@scripta/shared` (one constant reordered), `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-12-mobile-tabs-home-design.md`

## Global Constraints

- No code comments (repo rule); the why goes in commit messages. Existing comments that name a tab you rename get the new name and nothing more.
- Reuse what exists, don't rebuild it:
  - From `@scripta/shared`: `buildDashboardCards`, `upNextPair`, `resolveQuote`, `isNewDigestItem`, `newCountLabel`, `clearDashboardCounts`, `readSnapshot`, `bookKey`, `LIBRARY_STATUS_TABS`.
  - From `features/home/FeedRow.tsx`: `FeedRow`, `useDashboardFeed`, `useSkipEmptyPages`, `useFollowBack`, `DASHBOARD_QUERY_KEY`.
  - From `features/community/api.ts`: `markDashboardSeen`, `fetchOwnProfile`.
  - Components: `AuthorAvatar`, `DuelButton`, `CoverImage`.
  - The UI kit: `Button`, `IconButton`, `Menu`, `EmptyState`, `ErrorState`, `Skeleton`, `Toast`, `Screen`, `SwipeableTabs`, `Icon`.
- Every new `.tsx` imports `Text` from `ui/Text`, never from `react-native`. `src/ui/textImports.test.ts` fails otherwise.
- Hrefs follow the codebase's `as never` cast (typed routes are not generated in CI).
- Touch targets ≥ 44pt. Header actions are framed `IconButton`s with a `label`. Home has no primary button except an empty state's own action.
- Copy is exactly as the spec words it. Sentence case.
- Route files move with `git mv` so history follows. No URL string changes in Phase 1 except the one `dashboard/murals/[muralId].tsx` redirect that names a group.
- Run git from the worktree root, and stage and commit in one command (other sessions share the index). End each commit message with the attribution lines your session requires.
- A fresh checkout has no `node_modules`. Run `npm ci`, then `npm run build --workspace @scripta/shared`.
- **Verify after every task** (from the repo root):
  - `npm run typecheck --workspace mobile && npm test --workspace mobile`. CI runs both with `EXPO_PUBLIC_API_URL=http://localhost:3000`; set it if your shell has none.
  - At the end of each phase, also `cd mobile && npx expo-doctor`. It only flags; don't chase `@latest` drift.
  - After Task 1's shared edit, rebuild shared before the mobile checks (they read `dist/`).

## Review Focus

1. **No stranded screens.** Every route a You-stack screen pushes resolves in the `(you)` stack, with a back chevron and no tab jump. That covers `/me`, `/murals`, `/murals/<id>`, `/settings`, `/import`, `/add-book`, `/work/<id>`, `/u/<name>`, and `/book/<key>/style|cover|finished` as sheets. Checked in the Task 4 device pass.
2. **The Library tab lands on LibraryScreen** on a cold start, on re-press and after a Home → Library switch. Expo Router anchors a stack on the first *declared* screen, not on `unstable_settings` alone; see the comment in `(library)/_layout.tsx`.
3. **The `(public)` re-exports and the dashboard mural redirect** still resolve after the group renames. A wrong path there is a runtime error, not a type error.
4. **Home's seen marker** is sent:
   - only while Home is focused, a feed row is on screen and the feed is loaded, error-free and idle;
   - once per focus;
   - again on the next focus after a failure.
5. **Finished on a Home card** opens the finish sheet in the Home stack only after a successful save. A book already Finished never opens it.
6. **What's next?** never shows while any book is Reading, and gives way to Continue reading after "Start this one".
7. **Watch item, no change:** Home now holds every loaded feed page and refetches on each focus, and TanStack refetches every loaded page. Fine at 20 rows a page. If a long scroll makes focusing Home slow, cap it with `maxPages` in a follow-up.

---

## File structure

| File | Change |
|---|---|
| `packages/shared/src/library/libraryView.ts`, `libraryView.test.ts` | Shelves in Reading · To read · Finished order |
| `mobile/src/features/library/LibraryScreen.tsx` | Opens on Reading; empty-shelf copy that doesn't blame a search |
| `mobile/src/app/(app)/_layout.tsx` | Tabs Home · Library · Games · You |
| `mobile/src/app/(app)/(library)/_layout.tsx` | Root `library`; `me` leaves |
| `mobile/src/app/(app)/(you)/_layout.tsx` (new) | The You stack |
| `mobile/src/app/(app)/(you)/you.tsx` (new) | Route for `YouScreen` |
| `mobile/src/features/you/YouScreen.tsx` (new) | The hub |
| Moved into `(you)/` | `me.tsx`, `murals/index.tsx`, `settings.tsx` |
| Renamed groups | `(home,arena,library)` → `(home,arena,library,you)`, now also holding `murals/[id].tsx`; `(home,library)` → `(home,library,you)` |
| Deleted | `(murals)/_layout.tsx`, `(settings)/_layout.tsx` |
| `mobile/src/app/(public)/book/[key]/{cover,finished,style}.tsx`, `(public)/work/[id]/{index,stats}.tsx` | Re-export path names the renamed group |
| `mobile/src/app/dashboard/murals/[muralId].tsx` | Redirects into `(you)` |
| `mobile/src/ui/icon.tsx` | Filled `profile` glyph |
| `mobile/src/features/community/MyShelfScreen.tsx` | Shelf · Activity; no "Manage library…" |
| `mobile/src/features/community/OwnLibraryPane.tsx` | Deleted |
| `mobile/src/features/settings/SettingsScreen.tsx` | No Reader card / Open gallery buttons |
| `mobile/README.md`, `mobile/.maestro/login-navigation.yaml`, `.claude/skills/emulator-verify/SKILL.md`, `.claude/agents/beta-tester.md` | New tab names |
| `mobile/src/features/home/homeModel.ts`, `homeModel.test.ts` (new) | Which Home sections show; the seen-marker rule |
| `mobile/src/features/library/hooks/useChangeStatus.ts` (new) | Save status, then open the finish sheet when it became Finished |
| `mobile/src/features/works/BookScreen.tsx` | `OwnerRow` uses `useChangeStatus` |
| `mobile/src/features/home/ReadingCards.tsx`, `NextReadCard.tsx` (new) | Home's Continue reading cards and the inline duel |
| `mobile/src/features/home/HomeScreen.tsx` | One `FlatList`: sections, then the feed; no Community button |
| `mobile/src/features/home/PickNextSheet.tsx` | Deleted |
| `mobile/src/features/home/communityTabs.ts`, `communityTabs.test.ts`, `CommunityScreen.tsx` | Discover · People only |

---

## Phase 1 — Library and You tabs

### Task 1: Library shelves — order and empty shelf (done: `fc9a799`, then the review fix)

**Files:**
- Modify: `packages/shared/src/library/libraryView.ts:15-19`
- Test: `packages/shared/src/library/libraryView.test.ts`
- Modify: `mobile/src/features/library/LibraryScreen.tsx:47-62, 228-233`

- [ ] **Step 1: Failing test.** Append to `libraryView.test.ts`:

```ts
test("library shelves read Reading, To read, Finished", () => {
  assert.deepEqual(LIBRARY_STATUS_TABS.map((tab) => tab.label), ["Reading", "To read", "Finished"]);
});
```

- [ ] **Step 2: Run it and expect FAIL.** `npm test --workspace @scripta/shared` fails, because the order is Finished, Reading, To read.

- [ ] **Step 3: Implement.** In `libraryView.ts`:

```ts
export const LIBRARY_STATUS_TABS = [
  { value: "reading", label: "Reading" },
  { value: "unread", label: "To read" },
  { value: "finished", label: "Finished" }
] as const;
```

`LibraryScreen.tsx` keeps opening on `LIBRARY_STATUS_TABS[0]`, which is now Reading.
- A visited tab stays mounted, so it keeps its shelf without any memory of its own.
- A module-level `lastShelf` (first landed in `fc9a799`, removed after review) only mattered across a sign-out. There it carried one account's Collections shelf into another account's empty library.
- Its empty state splits on the search:
  - With a search, it keeps "No books match." and "Clear search and sort".
  - With none, it reads `<EmptyState title="Nothing on this shelf yet." />`.
  - Landing on Reading makes an empty shelf common, and the old copy blamed a search nobody typed.

- [ ] **Step 4: Run and expect PASS.**

```bash
npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile
```

- [ ] **Step 5: Commit.**

```bash
git add packages/shared/src/library/libraryView.ts packages/shared/src/library/libraryView.test.ts mobile/src/features/library/LibraryScreen.tsx && git commit -m "Open the library on Reading and remember the last shelf" -m "Reading is the shelf people come back to; Finished first made every visit start on the longest, least-changing list."
```

---

### Task 2: Library and You tabs

All in one commit. The moves, the layouts and the tab list only work together.

**Files:**
- Create: `mobile/src/app/(app)/(you)/_layout.tsx`, `mobile/src/app/(app)/(you)/you.tsx`, `mobile/src/features/you/YouScreen.tsx`
- Move and rename: see Step 1
- Delete: `mobile/src/app/(app)/(murals)/_layout.tsx`, `mobile/src/app/(app)/(settings)/_layout.tsx`
- Modify:
  - `mobile/src/app/(app)/_layout.tsx:49-61`
  - `mobile/src/app/(app)/(library)/_layout.tsx`
  - `mobile/src/ui/icon.tsx:69-76`
  - `mobile/src/app/dashboard/murals/[muralId].tsx:5`, `mobile/src/app/dashboard/murals/index.tsx:4`, `mobile/src/app/dashboard/settings.tsx:4`
  - the five `(public)` re-exports

- [ ] **Step 1: Move routes** (from the repo root; quote every path):

```bash
git mv "mobile/src/app/(app)/(home,arena,library)" "mobile/src/app/(app)/(home,arena,library,you)"
git mv "mobile/src/app/(app)/(home,library)" "mobile/src/app/(app)/(home,library,you)"
mkdir -p "mobile/src/app/(app)/(home,arena,library,you)/murals" "mobile/src/app/(app)/(you)/murals"
git mv "mobile/src/app/(app)/(library,murals)/murals/[id].tsx" "mobile/src/app/(app)/(home,arena,library,you)/murals/[id].tsx"
git mv "mobile/src/app/(app)/(library)/me.tsx" "mobile/src/app/(app)/(you)/me.tsx"
git mv "mobile/src/app/(app)/(murals)/murals/index.tsx" "mobile/src/app/(app)/(you)/murals/index.tsx"
git mv "mobile/src/app/(app)/(settings)/settings.tsx" "mobile/src/app/(app)/(you)/settings.tsx"
git rm -q "mobile/src/app/(app)/(murals)/_layout.tsx" "mobile/src/app/(app)/(settings)/_layout.tsx"
```

Then remove the now-empty `(library,murals)`, `(murals)` and `(settings)` folders if any remain on disk. Every moved file imports through `@/`, so no import changes.

- [ ] **Step 2: Re-export paths.** In each of these five files, change `(home,arena,library)/` to `(home,arena,library,you)/` in the single `export { default } from "…"` line:
  - `mobile/src/app/(public)/book/[key]/cover.tsx`
  - `mobile/src/app/(public)/book/[key]/finished.tsx`
  - `mobile/src/app/(public)/book/[key]/style.tsx`
  - `mobile/src/app/(public)/work/[id]/index.tsx`
  - `mobile/src/app/(public)/work/[id]/stats.tsx`

  Then confirm the old name is gone:

  ```bash
  rg -n --fixed-strings "(home,arena,library)/" mobile/src
  ```

  It must print nothing.

- [ ] **Step 3: Dashboard redirects.** Murals and Settings are no longer the first screen of their stack. Without `withAnchor`, a cold deep link would leave them alone in an unopened You stack, with no way back to the hub.
  - In `mobile/src/app/dashboard/murals/[muralId].tsx`, change the href to:

    ```tsx
    return <Redirect href={`/(app)/(you)/murals/${muralId}` as never} withAnchor />;
    ```

  - In `mobile/src/app/dashboard/murals/index.tsx`, change it to `<Redirect href="/murals" withAnchor />`.
  - In `mobile/src/app/dashboard/settings.tsx`, change it to `<Redirect href="/settings" withAnchor />`.

  `withAnchor` loads the You hub beneath each of them.

- [ ] **Step 4: `(you)` stack.** Create `mobile/src/app/(app)/(you)/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { useScreenOptions, useSheetOptions } from "@/ui/navigation";

export const unstable_settings = {
  initialRouteName: "you",
};

export default function YouStackLayout() {
  const sheet = useSheetOptions();
  return (
    <Stack screenOptions={useScreenOptions()}>
      <Stack.Screen name="you" />
      <Stack.Screen name="me" />
      <Stack.Screen name="murals/index" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="add-book" options={{ ...sheet, title: "Add a book" }} />
      <Stack.Screen name="import" options={{ ...sheet, title: "Import library" }} />
      <Stack.Screen name="book/[key]/index" options={{ title: "" }} />
      <Stack.Screen name="book/[key]/style" options={{ ...sheet, title: "Card style" }} />
      <Stack.Screen name="book/[key]/cover" options={{ ...sheet, title: "Cover" }} />
      <Stack.Screen name="book/[key]/finished" options={{ ...sheet, title: "Finished" }} />
    </Stack>
  );
}
```

Create `mobile/src/app/(app)/(you)/you.tsx`:

```tsx
import { YouScreen } from "@/features/you/YouScreen";

export default YouScreen;
```

- [ ] **Step 5: `YouScreen`.** Create `mobile/src/features/you/YouScreen.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { useAuth } from "../../core/auth";
import { API_URL } from "../../core/config";
import { Icon, IconButton, Screen, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { fetchOwnProfile } from "../community/api";

const ROWS = [
  { label: "Your shelf", href: "/me" },
  { label: "Murals", href: "/murals" },
  { label: "Reader card", href: "/reader-card" },
  { label: "Gallery", href: "/gallery" },
] as const;

export function YouScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
  const username = user?.username ?? "";
  const avatarUrl = user?.avatarId ? `${API_URL}/auth/avatar/${user.avatarId}/file` : null;

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "You",
          headerRight: () => <IconButton framed name="settings" label="Settings" accessibilityLabel="Settings" onPress={() => router.push("/settings" as never)} />,
        }}
      />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.profile}>
          <AuthorAvatar username={username} avatarUrl={avatarUrl} size={64} />
          <View style={styles.grow}>
            <Text {...dynamicType} numberOfLines={1} style={[typography.title, { color: colors.text }]}>@{username}</Text>
            {own.data ? (
              <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{own.data.published ? "Published" : "Private"}</Text>
            ) : null}
          </View>
        </View>
        <View style={[styles.rows, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {ROWS.map((row, index) => (
            <Pressable
              key={row.href}
              accessibilityRole="button"
              onPress={() => router.push(row.href as never)}
              style={({ pressed }) => [
                styles.row,
                index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null,
                pressed ? { backgroundColor: colors.surfacePressed } : null,
              ]}
            >
              <Text {...dynamicType} style={[typography.body, styles.rowLabel, { color: colors.text }]}>{row.label}</Text>
              <Icon name="chevronRight" size={18} color={colors.textDim} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg },
  profile: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1, gap: spacing.xs },
  rows: { borderWidth: 1, borderRadius: radii.lg, overflow: "hidden" },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg },
  rowLabel: { flex: 1, fontWeight: "600" },
});
```

- [ ] **Step 6: Library stack.** In `mobile/src/app/(app)/(library)/_layout.tsx`:
  - Set `initialRouteName: "library"`.
  - In the comment above `unstable_settings`, change "My shelf tab" to "Library tab" and "the shelf" to "the library".
  - Delete `<Stack.Screen name="me" />`, so `<Stack.Screen name="library" />` is the first declared screen. Declared order is what anchors the tab.
  - Leave every other screen as it is.

- [ ] **Step 7: Tabs.** In `mobile/src/app/(app)/_layout.tsx`, the `Tabs` children become exactly:

```tsx
<Tabs.Screen
  name="(home)"
  options={{
    title: "Home",
    tabBarBadge: newCountLabel(newCount) ?? undefined,
    tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent },
    tabBarIcon: ({ color, focused, size }) => <Icon name="home" filled={focused} color={color} size={size} />,
  }}
/>
<Tabs.Screen name="(library)" options={{ title: "Library", tabBarIcon: ({ color, focused, size }) => <Icon name="library" filled={focused} color={color} size={size} /> }} />
<Tabs.Screen name="(arena)" options={{ title: "Games", tabBarIcon: ({ color, focused, size }) => <Icon name="arena" filled={focused} color={color} size={size} /> }} />
<Tabs.Screen name="(you)" options={{ title: "You", tabBarIcon: ({ color, focused, size }) => <Icon name="profile" filled={focused} color={color} size={size} /> }} />
```

- [ ] **Step 8: Filled profile glyph.** In `mobile/src/ui/icon.tsx`, add this line to `FILLED`:

```ts
profile: { ios: "person.circle.fill", android: "account_circle" },
```

- [ ] **Step 9: Verify.**

```bash
npm run typecheck --workspace mobile && npm test --workspace mobile
```

Then check that nothing still names a removed group:

```bash
rg -n '\((murals|settings)\)[/"]|\(library,murals\)|\(home,library\)/' mobile/src
```

It must print nothing.

- [ ] **Step 10: Commit.**

```bash
git add -A "mobile/src/app" mobile/src/features/you mobile/src/ui/icon.tsx && git commit -m "Give the Library its own tab and fold My shelf, Murals and Settings into You" -m "The library sat behind My shelf, then the ⋯ menu, then Manage library. The routes keep their URLs; only the group folders move. Book, work, profile and mural-editor routes now live in every stack that can push them, so nothing opened from You jumps tabs."
```

---

### Task 3: My shelf and Settings drop what moved

**Files:**
- Modify: `mobile/src/features/community/MyShelfScreen.tsx:19, 24-28, 174, 204`
- Delete: `mobile/src/features/community/OwnLibraryPane.tsx`
- Modify: `mobile/src/features/settings/SettingsScreen.tsx:78-79`

- [ ] **Step 1: My shelf.**
  - `MY_SHELF_TABS` becomes `[{ value: "shelf", label: "Shelf" }, { value: "activity", label: "Activity" }]`.
  - Delete the `OwnLibraryPane` import.
  - Delete the `if (value === "library") return <OwnLibraryPane />;` branch.
  - Delete the `"Manage library…"` menu item.

- [ ] **Step 2: Delete the lite library.**

```bash
git rm -q mobile/src/features/community/OwnLibraryPane.tsx
```

Then confirm nothing still uses it:

```bash
rg -n "OwnLibraryPane" mobile/src
```

It must print nothing.

- [ ] **Step 3: Settings.** Delete the two buttons labelled "Reader card" and "Open gallery". They are now rows in You.

- [ ] **Step 4: Verify.**

```bash
npm run typecheck --workspace mobile && npm test --workspace mobile
```

- [ ] **Step 5: Commit.**

```bash
git add -A mobile/src/features/community mobile/src/features/settings && git commit -m "Drop the second library from My shelf and the moved buttons from Settings" -m "My shelf's Library pane was a lighter copy of the Library with differently ordered filters; the Library tab replaces it. Reader card and Gallery are rows in You now."
```

---

### Task 4: Phase 1 docs, tooling and device pass

**Files:**
- Modify:
  - `mobile/README.md` (the `src/app/` bullet and the route table)
  - `mobile/.maestro/login-navigation.yaml`
  - `.claude/skills/emulator-verify/SKILL.md:38`
  - `.claude/agents/beta-tester.md:78-79`

- [ ] **Step 1: `mobile/README.md`.**
  - In the Layout bullet for `src/app/`, change "(Library, Arena, Murals, Settings)" to "(Home, Library, Games, You)".
  - In the route table, change these rows:
    - `/dashboard` → "Home tab `/`"
    - `/dashboard/gallery`, `/dashboard/murals`, `/dashboard/settings` → "`/gallery`, `/murals`, `/settings`, reached from the You tab"
    - `/dashboard/arena` → "Games tab `/my-arena`"

- [ ] **Step 2: Maestro flow.** The login screen no longer shows "server ok", so the first `extendedWaitUntil` becomes `visible: "Your bookshelf, everywhere."`. Then replace everything after the `extendedWaitUntil` that waits for "Library":

```yaml
- tapOn: "Games"
- assertVisible: "Games"
- tapOn: "You"
- assertVisible: "Your shelf"
- tapOn: "Gallery"
- assertVisible: "Gallery"
```

- [ ] **Step 3: Agent docs.**
  - In the emulator-verify skill, the wait becomes:

    ```bash
    npm run dev:wait -- "Library" --timeout 120
    ```

  - In `beta-tester.md`:
    - Step 1 says "look at the empty library, You (Your shelf, Murals) and Games".
    - Step 2 lists "each tab (Home, Library, Games, You)". Settings is reached from You's header.

- [ ] **Step 4: Commit.**

```bash
git add mobile/README.md mobile/.maestro/login-navigation.yaml .claude/skills/emulator-verify/SKILL.md .claude/agents/beta-tester.md && git commit -m "Name the new tabs in the README, Maestro flow and agent docs" -m "The emulator-verify skill waited for the My shelf tab label, which no longer exists."
```

- [ ] **Step 5: Phase checks.**

```bash
cd mobile && npx expo-doctor
```

- [ ] **Step 6: Device pass.** First run `node scripts/dev-status.mjs --json` and make sure the emulator is free. Then dispatch `device-checker` with the worktree path, a screenshot directory, and these checks:
  1. **Tab bar.** A cold start lands on Home, and the bar reads Home · Library · Games · You.
  2. **Library shelf.** The Library tab opens the library on Reading. Switch to Finished, go to Home and back: it is still on Finished. Re-pressing the Library tab keeps the library root.
  3. **You hub.**
     - You shows the avatar, `@scripta_dev`, and Published or Private.
     - Each row opens its screen, with a back chevron to You: Your shelf, Murals, Reader card, Gallery.
     - The header's Settings opens Settings, with back to You.
  4. **Your shelf.**
     - It has only the Shelf · Activity tabs, and ⋯ has no "Manage library…".
     - Edit shelf opens the mural editor in the You stack, and back returns to Your shelf.
     - An Activity row for a book opens its book screen in the You stack.
  5. **Murals.** The list opens a mural; back goes to the list, then to You.
  6. **Settings.** It has no Reader card or Open gallery buttons; Account and Sign out still work.
  7. **Dashboard deep links.** Cold-open each of these as `exp://127.0.0.1:<metro>/--/<path>`. Each lands in the You tab, and back shows the You hub:
     - `dashboard/murals/<a mural id>` (the editor)
     - `dashboard/murals` (the list)
     - `dashboard/settings`
  8. **Library stack unchanged.** A book from the Library opens its screen. ⋯ → Card style opens as a sheet, still in the Library stack.

  Fix findings before Phase 2.

---

## Phase 2 — Home

### Task 5: Home model

**Files:**
- Create: `mobile/src/features/home/homeModel.ts`, `mobile/src/features/home/homeModel.test.ts`

**Interfaces:**
- Produces:
  - `homeSections(cards: DashboardCard[]): HomeSections`, where `HomeSections` is `{ readingKeys: string[]; nextKeys: string[] | null; highlight: Extract<DashboardCard, { kind: "rediscover" }> | null }`.
  - `shouldMarkFeedSeen(state: { focused: boolean; rowVisible: boolean; loaded: boolean; failed: boolean; fetching: boolean; sent: boolean }): boolean`.

- [ ] **Step 1: Failing tests.** Create `homeModel.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardCards } from "@scripta/shared";
import { homeSections, shouldMarkFeedSeen } from "./homeModel.js";

const book = (key: string, ReadStatus: number, highlights: unknown[] = []) => ({ _key: key, Title: key, Attribution: "Author", ReadStatus, highlights });
const sectionsFor = (books: Array<Record<string, unknown>>) => homeSections(buildDashboardCards(books, "2026-10-12", "u1:0"));

test("an empty library shows no section", () => {
  assert.deepEqual(sectionsFor([]), { readingKeys: [], nextKeys: null, highlight: null });
});

test("every reading book becomes a card, in shelf order", () => {
  assert.deepEqual(sectionsFor([book("a", 1)]).readingKeys, ["a"]);
  assert.deepEqual(sectionsFor([book("a", 1), book("b", 0), book("c", 1), book("d", 2), book("e", 1)]).readingKeys, ["a", "c", "e"]);
});

test("What's next shows only when nothing is reading and two or more books are to read", () => {
  assert.deepEqual(sectionsFor([book("a", 0), book("b", 0), book("c", 2)]).nextKeys, ["a", "b"]);
  assert.equal(sectionsFor([book("a", 0)]).nextKeys, null);
  assert.equal(sectionsFor([book("a", 1), book("b", 0), book("c", 0)]).nextKeys, null);
  assert.equal(sectionsFor([book("a", 2), book("b", 2)]).nextKeys, null);
});

test("a highlight shows when a book has one", () => {
  const highlighted = book("a", 2, [{ Type: "highlight", Text: "Call me Ishmael.", BookmarkID: "h1" }]);
  assert.equal(sectionsFor([highlighted]).highlight?.highlightId, "h1");
  assert.equal(sectionsFor([book("b", 2)]).highlight, null);
});

test("the feed counts as seen only when focused, a row is on screen, the data is loaded and idle, and it wasn't sent yet", () => {
  const ready = { focused: true, rowVisible: true, loaded: true, failed: false, fetching: false, sent: false };
  assert.equal(shouldMarkFeedSeen(ready), true);
  assert.equal(shouldMarkFeedSeen({ ...ready, focused: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, rowVisible: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, loaded: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, failed: true }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, fetching: true }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, sent: true }), false);
});
```

- [ ] **Step 2: Run it and expect FAIL.** `npm test --workspace mobile` fails with module not found.

- [ ] **Step 3: Implement** `homeModel.ts`:

```ts
import type { DashboardCard } from "@scripta/shared";

export interface HomeSections {
  readingKeys: string[];
  nextKeys: string[] | null;
  highlight: Extract<DashboardCard, { kind: "rediscover" }> | null;
}

export function homeSections(cards: DashboardCard[]): HomeSections {
  const readingKeys = cards.find((card) => card.kind === "currentlyReading")?.bookKeys ?? [];
  const upNext = cards.find((card) => card.kind === "upNext")?.bookKeys ?? [];
  return {
    readingKeys,
    nextKeys: readingKeys.length === 0 && upNext.length >= 2 ? upNext : null,
    highlight: cards.find((card) => card.kind === "rediscover") ?? null,
  };
}

export function shouldMarkFeedSeen({ focused, rowVisible, loaded, failed, fetching, sent }: { focused: boolean; rowVisible: boolean; loaded: boolean; failed: boolean; fetching: boolean; sent: boolean }): boolean {
  return focused && rowVisible && loaded && !failed && !fetching && !sent;
}
```

- [ ] **Step 4: Run and expect PASS.**

```bash
npm run typecheck --workspace mobile && npm test --workspace mobile
```

- [ ] **Step 5: Commit.**

```bash
git add mobile/src/features/home/homeModel.ts mobile/src/features/home/homeModel.test.ts && git commit -m "Add the Home sections model and the feed seen rule"
```

---

### Task 6: One status-change path for the book screen and Home

**Files:**
- Create: `mobile/src/features/library/hooks/useChangeStatus.ts`
- Modify: `mobile/src/features/works/BookScreen.tsx:46-82` and its imports

**Interfaces:**
- Produces: `useChangeStatus(): (book: Record<string, unknown>, status: ReadStatus) => Promise<void>`. It saves through `setStatus`. When the save succeeded and moved the book to Finished from another status, it opens `/book/<key>/finished?before=…` in the current stack.

- [ ] **Step 1: Hook.** Create `useChangeStatus.ts`. Its body is `OwnerRow.changeStatus` (`BookScreen.tsx:52-57`), moved verbatim:

```ts
import { router, useSegments } from "expo-router";
import { bookKey, readSnapshot, type ReadStatus } from "@scripta/shared";
import { bookToolPath } from "../../works/workPath";
import { useLibraryActions } from "./useLibraryActions";

export function useChangeStatus() {
  const { setStatus } = useLibraryActions();
  const segments = useSegments();
  return async function changeStatus(book: Record<string, unknown>, status: ReadStatus) {
    const before = readSnapshot(book);
    const wasFinished = book.ReadStatus === 2;
    const saved = await setStatus(book, status);
    if (saved && status === 2 && !wasFinished) router.push(`${bookToolPath(bookKey(book), "finished", segments)}?before=${encodeURIComponent(JSON.stringify(before))}` as never);
  };
}
```

- [ ] **Step 2: Book screen uses it.** In `OwnerRow`:
  - Replace `const { setStatus, setRating } = useLibraryActions();` and `const segments = useSegments();` with `const { setRating } = useLibraryActions();` and `const changeStatus = useChangeStatus();`.
  - Delete the local `changeStatus` function.
  - The status menu's `onPress` becomes `() => void changeStatus(book, o.value)`.
  - Drop the imports nothing else in the file uses any more (`readSnapshot`, `bookKey`, `ReadStatus` if unused). `BookScreen` itself still uses `router` and `useSegments`.

- [ ] **Step 3: Verify.**

```bash
npm run typecheck --workspace mobile && npm test --workspace mobile
```

There is no behaviour change on the book screen.

- [ ] **Step 4: Commit.**

```bash
git add mobile/src/features/library/hooks/useChangeStatus.ts mobile/src/features/works/BookScreen.tsx && git commit -m "Move the finish-aware status change into a hook" -m "Home's Continue reading cards need the same save-then-open-the-finish-sheet step the book screen has."
```

---

### Task 7: Home screen

**Files:**
- Create: `mobile/src/features/home/ReadingCards.tsx`, `mobile/src/features/home/NextReadCard.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx` (rewrite)
- Delete: `mobile/src/features/home/PickNextSheet.tsx`

- [ ] **Step 1: `ReadingCards.tsx`.**

```tsx
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../../ui/Text";
import { bookKey } from "@scripta/shared";
import { Button, IconButton, Menu, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { CoverImage } from "../library/components/CoverImage";
import { useChangeStatus } from "../library/hooks/useChangeStatus";

const PEEK = 40;

export function ReadingCards({ keys, books, onOpen }: { keys: string[]; books: Array<Record<string, unknown>>; onOpen: (key: string) => void }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const changeStatus = useChangeStatus();
  const byKey = new Map(books.map((book) => [bookKey(book), book] as const));
  const items = keys.flatMap((key) => {
    const book = byKey.get(key);
    return book ? [{ key, book }] : [];
  });
  const cardWidth = width - spacing.lg * 2 - (items.length > 1 ? PEEK : 0);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardWidth + spacing.md} decelerationRate="fast" contentContainerStyle={styles.row}>
      {items.map(({ key, book }) => {
        const title = String(book.Title ?? "Untitled");
        const author = String(book.Attribution ?? "Unknown author");
        return (
          <View key={key} style={[styles.card, { width: cardWidth, backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${title} by ${author}`} onPress={() => onOpen(key)} style={[styles.cover, { backgroundColor: colors.border }]}>
              <CoverImage book={book} />
            </Pressable>
            <View style={styles.body}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={() => onOpen(key)}>
                <Text {...dynamicType} numberOfLines={2} style={[typography.title, { color: colors.text }]}>{title}</Text>
                <Text {...dynamicType} numberOfLines={1} style={[typography.body, { color: colors.textDim }]}>{author}</Text>
              </Pressable>
              <View style={styles.actions}>
                <Button label="Finished" variant="secondary" accessibilityLabel={`Mark ${title} finished`} onPress={() => void changeStatus(book, 2)} />
                <Menu title={title} items={[{ label: "Move to To read", onPress: () => void changeStatus(book, 0) }, { label: "Open book", onPress: () => onOpen(key) }]}>
                  <IconButton accessibilityLabel={`More for ${title}`} name="more" />
                </Menu>
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.md, paddingHorizontal: spacing.lg },
  card: { flexDirection: "row", gap: spacing.lg, padding: spacing.lg, borderWidth: 1, borderRadius: radii.lg },
  cover: { width: 72, aspectRatio: 2 / 3, borderRadius: radii.md, overflow: "hidden" },
  body: { flex: 1, minWidth: 0, gap: spacing.sm, justifyContent: "space-between" },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
});
```

- [ ] **Step 2: `NextReadCard.tsx`.** This is `PickNextSheet`'s body, inline. It keeps the same pairing, the same save and the same "Another pair" rule.

```tsx
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { bookKey, upNextPair } from "@scripta/shared";
import { Button, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { CoverImage } from "../library/components/CoverImage";
import { DuelButton } from "../library/components/DuelButton";
import { useLibraryActions } from "../library/hooks/useLibraryActions";

export function NextReadCard({ keys, books }: { keys: string[]; books: Array<Record<string, unknown>> }) {
  const { colors } = useTheme();
  const { setStatus } = useLibraryActions();
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const pair = upNextPair(keys, offset)
    .map((key) => books.find((book) => bookKey(book) === key))
    .filter((book): book is Record<string, unknown> => Boolean(book));

  if (pair.length < 2) return null;

  async function start(book: Record<string, unknown>) {
    if (saving) return;
    setSaving(true);
    await setStatus(book, 1);
    setSaving(false);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>What's next?</Text>
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Two from your to-read pile. Starting one moves it to Continue reading.</Text>
      <View style={styles.pair}>
        {pair.map((book) => {
          const title = String(book.Title ?? "Untitled");
          return (
            <View key={bookKey(book)} style={styles.side}>
              <View style={[styles.cover, { backgroundColor: colors.border }]}><CoverImage book={book} /></View>
              <Text {...dynamicType} numberOfLines={2} style={[typography.body, styles.title, { color: colors.text }]}>{title}</Text>
              <View style={styles.duelWrap}>
                <DuelButton label="Start this one" accessibilityLabel={`Start reading ${title}`} disabled={saving} onPress={() => void start(book)} />
              </View>
            </View>
          );
        })}
      </View>
      {keys.length > 2 ? <Button label="Another pair" variant="secondary" disabled={saving} onPress={() => setOffset((value) => value + 2)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderRadius: radii.lg },
  pair: { flexDirection: "row", gap: spacing.md, alignItems: "stretch" },
  side: { flex: 1, gap: spacing.sm },
  cover: { aspectRatio: 2 / 3, borderRadius: radii.sm, overflow: "hidden" },
  title: { textAlign: "center" },
  duelWrap: { marginTop: "auto" },
});
```

- [ ] **Step 3: Rewrite `HomeScreen.tsx`.** It keeps today's `SectionHeader`, `day`/`offset` handling, the highlight card markup and the empty-library state. `BookRow`, the Community button, `PickNextSheet`, the "Up next" section and the "All activity" link go.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View, type ViewToken } from "react-native";
import { Text } from "../../ui/Text";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { buildDashboardCards, clearDashboardCounts, isNewDigestItem, newCountLabel, resolveQuote, type DashboardFeedPage } from "@scripta/shared";
import { BrandMark, Button, EmptyState, ErrorState, Screen, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { useAuth } from "../../core/auth";
import { useLibrary } from "../library/hooks/useLibrary";
import { markDashboardSeen } from "../community/api";
import { DASHBOARD_QUERY_KEY, FeedRow, useDashboardFeed, useFollowBack, useSkipEmptyPages } from "./FeedRow";
import { digestRoute } from "./feedRowModel";
import { homeSections, shouldMarkFeedSeen } from "./homeModel";
import { NextReadCard } from "./NextReadCard";
import { ReadingCards } from "./ReadingCards";

export function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const { user } = useAuth();
  const library = useLibrary();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [offset, setOffset] = useState(0);
  const [pulling, setPulling] = useState(false);
  const dashboard = useDashboardFeed();
  const { followingId, followError, followBack } = useFollowBack(dashboard.refetch);
  const seenSent = useRef(false);
  const rowVisible = useRef(false);

  useFocusEffect(useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) {
      setDay(today);
      setOffset(0);
    }
    seenSent.current = false;
    void library.refetch();
    void dashboard.refetch();
  }, [day, library.refetch, dashboard.refetch]));

  const books = library.data?.data.books ?? [];
  const sections = homeSections(user ? buildDashboardCards(books, day, `${user.id}:${offset}`) : []);
  const quote = sections.highlight ? resolveQuote({ type: "quote", bookKey: sections.highlight.bookKey, highlightId: sections.highlight.highlightId } as never, books) : null;

  const feedItems = dashboard.data?.pages.flatMap((page) => page.items) ?? [];
  const newLabel = newCountLabel(dashboard.data?.pages[0]?.personalNewCount ?? 0);
  const seenAt = dashboard.data?.pages[0]?.seenAt ?? null;
  const feedLoading = dashboard.isPending || (dashboard.hasNextPage && !dashboard.isError && !feedItems.length);
  useSkipEmptyPages(dashboard, feedItems.length);

  const markSeen = useRef(() => {});
  markSeen.current = () => {
    if (!shouldMarkFeedSeen({ focused, rowVisible: rowVisible.current, loaded: dashboard.data !== undefined, failed: dashboard.isError, fetching: dashboard.isFetching, sent: seenSent.current })) return;
    seenSent.current = true;
    void markDashboardSeen().then(
      () => queryClient.setQueryData<InfiniteData<DashboardFeedPage>>(DASHBOARD_QUERY_KEY, (data) => (data ? clearDashboardCounts(data) : data)),
      () => {},
    );
  };
  useEffect(() => {
    markSeen.current();
  }, [focused, dashboard.data, dashboard.isError, dashboard.isFetching]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    rowVisible.current = viewableItems.length > 0;
    markSeen.current();
  }).current;

  const openBook = (key: string) => router.push(`/book/${encodeURIComponent(key)}` as never);
  const findReaders = () => router.push("/community?tab=people" as never);

  async function onRefresh() {
    setPulling(true);
    try {
      await Promise.all([library.refetch(), dashboard.refetch()]);
    } finally {
      setPulling(false);
    }
  }

  const header = (
    <View style={styles.sections}>
      {!library.data ? (
        <View style={styles.sectionPad}>
          {library.isError
            ? <ErrorState body="Couldn't load your home." actionLabel="Retry" onAction={() => void library.refetch()} />
            : <ActivityIndicator accessibilityLabel="Loading home" />}
        </View>
      ) : !books.length ? (
        <View style={styles.sectionPad}>
          <EmptyState title="Start your library" body="Import your existing collection, or add your first book manually." actionLabel="Import library" onAction={() => router.push("/import" as never)} secondaryActionLabel="Add a book manually" onSecondaryAction={() => router.push("/add-book" as never)} />
        </View>
      ) : (
        <>
          {sections.readingKeys.length ? (
            <View style={styles.section}>
              <SectionHeader title="Continue reading" count={String(sections.readingKeys.length)} />
              <ReadingCards keys={sections.readingKeys} books={books} onOpen={openBook} />
            </View>
          ) : null}
          {sections.nextKeys ? (
            <View style={styles.sectionPad}>
              <NextReadCard keys={sections.nextKeys} books={books} />
            </View>
          ) : null}
          {quote ? (
            <View style={styles.sectionPad}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text {...dynamicType} style={[typography.title, styles.heading, { color: colors.text }]}>From your highlights</Text>
                <Text {...dynamicType} display={false} style={[typography.title, { color: colors.text }]}>{String(quote.highlight.Text)}</Text>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                  {String(quote.book.Title)} · {String(quote.book.Attribution ?? "")}
                </Text>
                <Button label="Another" variant="secondary" onPress={() => setOffset((value) => value + 1)} />
              </View>
            </View>
          ) : null}
        </>
      )}
      <SectionHeader title="From people you follow" count={newLabel ? `· ${newLabel} new` : undefined} action={{ label: "Find readers", onPress: findReaders }} />
    </View>
  );

  const feedEmpty = feedLoading ? (
    <View style={styles.sectionPad}><Skeleton height={80} /></View>
  ) : dashboard.isError && !dashboard.data ? (
    <View style={styles.sectionPad}><ErrorState body="Couldn't load activity." actionLabel="Retry" onAction={() => void dashboard.refetch()} /></View>
  ) : dashboard.hasNextPage ? null : (
    <View style={styles.sectionPad}><EmptyState title="Nothing here yet" body="Follow readers to see what they finish and publish." actionLabel="Find readers" onAction={findReaders} /></View>
  );

  const feedFooter = dashboard.isFetchingNextPage ? (
    <View style={styles.sectionPad}><Skeleton height={80} /></View>
  ) : dashboard.isFetchNextPageError ? (
    <View style={styles.sectionPad}><ErrorState body="Couldn't load more." actionLabel="Retry" onAction={() => void dashboard.fetchNextPage()} /></View>
  ) : null;

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Home", headerShown: true, headerLeft: () => <View style={styles.mark}><BrandMark size={24} /></View> }} />
      {followError ? (
        <Toast visible message={followError} tone="error" />
      ) : dashboard.isRefetchError && !dashboard.isRefetching ? (
        <Toast visible message="Couldn't refresh activity." tone="error" />
      ) : null}
      <FlatList
        data={feedItems}
        keyExtractor={(item) => `${item.kind}:${item.id}`}
        ListHeaderComponent={header}
        ListEmptyComponent={feedEmpty}
        ListFooterComponent={feedFooter}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <FeedRow
            item={item}
            onOpen={() => router.push(digestRoute(item) as never)}
            onFollowBack={() => { if (item.kind === "follow") void followBack(item.actor.userId); }}
            following={item.kind === "follow" && followingId === item.actor.userId}
            isNew={isNewDigestItem(item, seenAt)}
          />
        )}
        onEndReached={() => {
          if (dashboard.hasNextPage && !dashboard.isFetchingNextPage && !dashboard.isFetchNextPageError) void dashboard.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onRefresh()} />}
      />
    </Screen>
  );
}
```

Keep `SectionHeader` exactly as it is today, below the component.

The `styles` object keeps `mark`, `sectionPad`, `heading`, `headerTitle`, `card`, `sections`, `section`, `sectionHeader` and `sectionAction`, and adds:

```ts
list: { paddingBottom: spacing.huge },
```

It drops `page`, `grow`, `row`, `cover` and `linkRow`.

- [ ] **Step 4: Delete the sheet.**

```bash
git rm -q mobile/src/features/home/PickNextSheet.tsx
```

Then confirm nothing still uses it:

```bash
rg -n "PickNextSheet" mobile/src
```

It must print nothing.

- [ ] **Step 5: Verify.**

```bash
npm run typecheck --workspace mobile && npm test --workspace mobile
```

- [ ] **Step 6: Commit.**

```bash
git add -A mobile/src/features/home && git commit -m "Make Home your current books and the feed from people you follow" -m "Reading now was untitled covers with no action and Up next was the first ten books of the whole to-read pile. Atmyshelf is not the e-reader, so the useful actions are Finished and picking the next book. Those now sit on cards, the duel shows when nothing is in progress, and the feed fills the rest of Home instead of hiding behind a header button. The seen marker moves here from Community and fires when a feed row is on screen."
```

---

### Task 8: Community without Activity

**Files:**
- Modify: `mobile/src/features/home/communityTabs.ts`, `communityTabs.test.ts`, `CommunityScreen.tsx`

- [ ] **Step 1: Failing tests.** Replace `communityTabs.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMUNITY_TABS, parseCommunityTab } from "./communityTabs.js";

test("the tabs read Discover and People", () => {
  assert.deepEqual(COMMUNITY_TABS.map((tab) => tab.label), ["Discover", "People"]);
});

test("a tab param opens that tab, and anything else opens People", () => {
  assert.equal(parseCommunityTab("discover"), "discover");
  assert.equal(parseCommunityTab("people"), "people");
  assert.equal(parseCommunityTab("activity"), "people");
  assert.equal(parseCommunityTab(undefined), "people");
});
```

- [ ] **Step 2: Run it and expect FAIL.** `npm test --workspace mobile` fails: `COMMUNITY_TABS` is not exported.

- [ ] **Step 3: Implement.** `communityTabs.ts` becomes:

```ts
export const COMMUNITY_TABS = [
  { value: "discover", label: "Discover" },
  { value: "people", label: "People" },
] as const;

export type CommunityTab = (typeof COMMUNITY_TABS)[number]["value"];

export function parseCommunityTab(value: string | undefined): CommunityTab {
  return COMMUNITY_TABS.find((tab) => tab.value === value)?.value ?? "people";
}
```

`CommunityScreen.tsx` becomes:

```tsx
import { useState } from "react";
import { Stack } from "expo-router";
import { Screen, SwipeableTabs } from "../../ui";
import { DiscoverPane } from "../community/DiscoverPane";
import { PeoplePane } from "../community/PeoplePane";
import { COMMUNITY_TABS, type CommunityTab } from "./communityTabs";

export function CommunityScreen({ initialTab }: { initialTab: CommunityTab }) {
  const [tab, setTab] = useState<CommunityTab>(initialTab);
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Community", headerShown: true }} />
      <SwipeableTabs
        accessibilityLabel="Community sections"
        options={COMMUNITY_TABS}
        value={tab}
        onChange={setTab}
        renderPage={(value) => (value === "discover" ? <DiscoverPane /> : <PeoplePane />)}
      />
    </Screen>
  );
}
```

`(home)/community.tsx` is unchanged.

- [ ] **Step 4: Run and expect PASS.**

```bash
npm run typecheck --workspace mobile && npm test --workspace mobile
```

- [ ] **Step 5: Commit.**

```bash
git add mobile/src/features/home/communityTabs.ts mobile/src/features/home/communityTabs.test.ts mobile/src/features/home/CommunityScreen.tsx && git commit -m "Drop the Activity tab from Community now that Home shows the feed" -m "Community keeps Discover and People, opening on People, until the Search tab takes people search."
```

---

### Task 9: Phase 2 device pass

- [ ] **Step 1: Phase checks.**

```bash
cd mobile && npx expo-doctor
```

- [ ] **Step 2: Device pass.** First run `node scripts/dev-status.mjs --json` and make sure the emulator is free. Then dispatch `device-checker` with the worktree path, a screenshot directory, and these checks. The fixture has 7 Reading and 6 To read books; the dev setup seeds the social graph, so the feed has rows.
  1. **Continue reading cards.** Home shows "Continue reading 7" with one card per book, and the next card peeks in. Swiping snaps card by card. The Home header has no Community button.
  2. **Finished.** On one card, Finished opens the finish sheet in the Home stack. Closing it returns to Home, without that book.
  3. **⋯ menu.** "Open book" opens the book screen. "Move to To read" removes the card.
  4. **What's next?** Move every remaining Reading book to To read. "What's next?" then appears with two covers. "Another pair" changes the pair. "Start this one" makes that book the only Continue reading card, and What's next? disappears.
  5. **Feed.**
     - "From people you follow" lists rows. Scrolling to the end loads more when there are more.
     - Pull to refresh works.
     - "Find readers" opens Community on People, and the tabs read Discover · People.
  6. **Badge.** When the Home tab shows a badge, it clears after a feed row has been on screen. Leave Home and come back: no error, and no badge until new activity arrives.
  7. **Highlight card.** When a highlight exists, it reads "From your highlights" with "Another". The fixture has none, so a missing card is expected.

  Fix findings, then run the `branch-reviewer` once for the whole branch before merge.
