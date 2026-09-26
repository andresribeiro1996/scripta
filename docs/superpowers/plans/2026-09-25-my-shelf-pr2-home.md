# My shelf PR 2: Home leads with your books. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mobile Home shows the reader's own books first (Reading now, Rediscover, Up next) with a compact follower section, and on both clients tapping a cover opens that book.

**Architecture:** Mobile `HomeScreen` becomes one scroll built from the dashboard cards it already computes. The follower tabs move to a pushed `(home)/activity` route. Book routes move into an expo-router shared group `(home,library)` so a book opened from Home is presented in the Home stack. On web, Home covers link to `/dashboard/library?book=<key>`, and `LibraryPage` opens its sheet from that param.

**Tech Stack:** Expo Router 57, React Native, TanStack Query; React Router + Tailwind on web.

**Spec:** `docs/superpowers/specs/2026-09-25-my-shelf-release-1-design.md`, section "2. Home leads with your books".

## Global Constraints

- No code comments unless a surrounding pattern demands one; the why goes in commit messages.
- Reuse `buildDashboardCards`, `resolveQuote`, `CoverImage`, and the existing `FeedRow` rendering. Add no new packages.
- `markDashboardSeen` runs when the activity screen opens, never when Home loads.
- A book opened from Home must be presented over Home, and back must return to Home.
- In a worktree session, run git as `/usr/bin/git …` from the worktree root.

---

### Task 1: Move the follower tabs to `(home)/activity`

**Files:**
- Create: `mobile/src/features/home/FeedRow.tsx`, which receives `FeedRow`, its styles, `BADGE_SIZE`/`AVATAR_SIZE`, and a module-level `digestRoute(item)` moved out of `HomeScreen.tsx`
- Create: `mobile/src/features/home/ActivityScreen.tsx`
- Create: `mobile/src/app/(app)/(home)/activity.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx` (temporarily keep it compiling; Task 3 rewrites it)

**Interfaces:**
- Produces: `FeedRow({ item, onOpen, onFollowBack, following })` and `digestRoute(item: DigestItem): string`, both exported from `features/home/FeedRow.tsx`; `ActivityScreen({ initialTab?: HomeTab })`; the route `/activity?tab=people`.

- [ ] **Step 1: Extract `FeedRow`**

Move the `FeedRow` function (currently `HomeScreen.tsx:171-232`), the `BADGE_SIZE`/`AVATAR_SIZE` constants, and the style entries it uses (`feedRow`, `slot`, `slotAvatar`, `labelRow`, `timestamp`, `rowAction`, `heading`, `grow`) into `features/home/FeedRow.tsx`, with the imports those lines need. Export `FeedRow`. Also move the body of `HomeScreen`'s inner `digestRoute` to a module export:

```ts
export function digestRoute(item: DigestItem): string {
  return item.kind === "follow" || item.kind === "reading" ? `/u/${item.actor.username}` : digestTarget(item);
}
```

- [ ] **Step 2: Create `ActivityScreen`**

Move everything tab-related out of `HomeScreen` into `features/home/ActivityScreen.tsx`: the `useInfiniteQuery` for `["community", "dashboard"]`, the `markDashboardSeen` effect, `followBack`, the default-tab effect, and the `SwipeableTabs` block with its three panes. Render it inside `<Screen top={false}>` with `<Stack.Screen options={{ title: "Activity", headerShown: true }} />`. Accept `initialTab?: HomeTab`. When it's given, start on it and skip the `defaultHomeTab` effect:

```tsx
export function ActivityScreen({ initialTab }: { initialTab?: HomeTab }) {
  const [tab, setTab] = useState<HomeTab>(initialTab ?? "activity");
  const tabInitedRef = useRef(Boolean(initialTab));
  ...
}
```

Use `FeedRow` and `digestRoute` from `./FeedRow`. `markDashboardSeen` stays in this screen: the effect that runs once when `dashboard.data` arrives.

- [ ] **Step 3: Add the route**

`mobile/src/app/(app)/(home)/activity.tsx`:

```tsx
import { useLocalSearchParams } from "expo-router";
import { ActivityScreen } from "@/features/home/ActivityScreen";

export default function ActivityRoute() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  return <ActivityScreen initialTab={tab === "people" ? "people" : undefined} />;
}
```

- [ ] **Step 4: Verify and commit**

Run `npm run typecheck --workspace mobile` and `npm test --workspace mobile`. Expected: pass. (`HomeScreen` may still render the old layout minus the moved pieces; Task 3 replaces it.)

```bash
/usr/bin/git add mobile/src
/usr/bin/git commit -m "Move Home's follower tabs to their own activity screen"
```

---

### Task 2: Present book sheets inside the Home stack

**Files:**
- Move: `mobile/src/app/(app)/(library)/book/` → `mobile/src/app/(app)/(home,library)/book/` (all three routes: `[key]/index.tsx`, `[key]/style.tsx`, `[key]/cover.tsx`)
- Modify: `mobile/src/app/(app)/(home)/_layout.tsx`

**Interfaces:**
- Produces: `/book/<key>` pushed from any Home screen opens in the Home stack; the same URL from My shelf opens in the library stack, as today.

- [ ] **Step 1: Move the routes into the shared group**

```bash
mkdir -p "mobile/src/app/(app)/(home,library)"
/usr/bin/git mv "mobile/src/app/(app)/(library)/book" "mobile/src/app/(app)/(home,library)/book"
```

`(library)/_layout.tsx` keeps its `<Stack.Screen name="book/[key]/…">` declarations unchanged; expo-router expands the array group into both groups.

- [ ] **Step 2: Declare the sheets in the Home stack**

Replace `mobile/src/app/(app)/(home)/_layout.tsx` with:

```tsx
import { Stack } from "expo-router";
import { useScreenOptions, useSheetOptions } from "@/ui/navigation";

export const unstable_settings = {
  initialRouteName: "index",
};

export default function HomeLayout() {
  const sheet = useSheetOptions();
  return (
    <Stack screenOptions={useScreenOptions()}>
      <Stack.Screen name="index" />
      <Stack.Screen name="book/[key]/index" options={{ ...sheet, title: "Book details" }} />
      <Stack.Screen name="book/[key]/style" options={{ ...sheet, title: "Card style" }} />
      <Stack.Screen name="book/[key]/cover" options={{ ...sheet, title: "Cover" }} />
    </Stack>
  );
}
```

Declaring `index` first is what anchors the stack's initial route. See the comment in `(library)/_layout.tsx`.

- [ ] **Step 3: Verify**

Run `npm run typecheck --workspace mobile` and `npm test --workspace mobile`. Expected: pass.

**If expo-router rejects the array group** (a "conflicting screens" error at bundle time, or the sheet opens in the My shelf tab on the device check in Task 4), stop and report back with the exact error. Don't improvise another routing scheme.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add "mobile/src/app/(app)"
/usr/bin/git commit -m "Share book routes between the Home and library stacks"
```

The body should say why: a cover tapped on Home must open over Home, and back must return there.

---

### Task 3: Rewrite mobile Home

**Files:**
- Modify: `mobile/src/features/home/HomeScreen.tsx` (full rewrite)

**Interfaces:**
- Consumes: `buildDashboardCards`, `resolveQuote`, `bookKey` from `@scripta/shared`; `fetchDashboard` from `../community/api`; `FeedRow`, `digestRoute` from `./FeedRow`; `CoverImage` from `../library/components/CoverImage`.

- [ ] **Step 1: Rewrite `HomeScreen`**

Structure: `<Screen top={false}>`, the `Stack.Screen` with `title: "Home"`, then loading/error states as today, then a `ScrollView` with a `RefreshControl` that refetches library and dashboard. Sections in order:

1. **Reading now**, only when the `currentlyReading` card exists: a header row reading "Reading now" plus the count in dim text, then `BookRow` of those keys.
2. **Rediscover**: the existing card block, unchanged (quote, attribution, "Show another").
3. **Up next**, only when the `upNext` card exists: a header with the count, then `BookRow` of the first 10 keys.
4. **From people you follow**: the header text is `From people you follow` plus ` · ${newCount} new` when `newCount > 0`. Then the first 3 items of `dashboard.data.pages[0].items`, each rendered with `FeedRow` (`onOpen` → `router.push(digestRoute(item))`, `onFollowBack` → the same follow-back logic the activity screen uses, including its `following` state and error toast). Then a row labelled "All activity" → `router.push("/activity")`. With zero items, render only a row labelled "Find readers" → `router.push("/activity?tab=people")`.

Keep the empty-library state ("Start your library") exactly as it is today, in place of sections 1–4.

Use the same `useInfiniteQuery` options and `queryKey: ["community", "dashboard"]` that `ActivityScreen` uses, so they share a cache. Read only `pages[0]`. **Do not** call `markDashboardSeen` here.

`BookRow`, local to the file:

```tsx
function BookRow({ keys, books, onOpen }: { keys: string[]; books: Array<Record<string, unknown>>; onOpen: (key: string) => void }) {
  const byKey = new Map(books.map((book) => [bookKey(book), book] as const));
  const items = keys.flatMap((key) => { const book = byKey.get(key); return book ? [{ key, book }] : []; });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map(({ key, book }) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={`${String(book.Title ?? "Untitled")} by ${String(book.Attribution ?? "Unknown author")}`}
          onPress={() => onOpen(key)}
          style={styles.cover}
        >
          <CoverImage book={book} />
        </Pressable>
      ))}
    </ScrollView>
  );
}
```

Styles: `row: { gap: spacing.sm, paddingHorizontal: spacing.lg }`, `cover: { width: 72, aspectRatio: 2 / 3, borderRadius: radii.md, overflow: "hidden" }`. Section headers use `typography.body` bold for the title and `colors.textDim` for the count, with `paddingHorizontal: spacing.lg`. Use theme tokens only; no new colors.

`onOpen`: `router.push(\`/book/${encodeURIComponent(key)}\` as never)`.

- [ ] **Step 2: Verify**

Run `npm run typecheck --workspace mobile` and `npm test --workspace mobile`. Expected: pass. `grep -n "markDashboardSeen" mobile/src/features/home/HomeScreen.tsx` prints nothing.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add mobile/src/features/home
/usr/bin/git commit -m "Home leads with the reader's own books"
```

The body should say why: the 09-18 spec defined Home as reading state plus followers, and mobile had only shipped the second half.

---

### Task 4: Web covers open the book, then verify everything

**Files:**
- Modify: `frontend/src/pages/HomePage.tsx:44`
- Modify: `frontend/src/pages/LibraryPage.tsx:73` (`useSearchParams`), the detail sheet's `onClose` (`:659`), plus a new effect

- [ ] **Step 1: Link Home covers**

In `HomePage`, add `const navigate = useNavigate();` (from `react-router-dom`) and change the `BookCard` `onClick` to:

```tsx
onClick={() => navigate(`/dashboard/library?book=${encodeURIComponent(bookKey(book))}`)}
```

- [ ] **Step 2: Open the sheet from `?book=`**

In `LibraryPage`, change `const [searchParams] = useSearchParams();` to `const [searchParams, setSearchParams] = useSearchParams();`. Below the existing `searchParams` effect, add:

```ts
  const bookParam = searchParams.get("book");
  useEffect(() => {
    if (bookParam) setDetailBookKey(bookParam);
  }, [bookParam]);
```

Change the `BookDetailSheet` `onClose` to:

```tsx
onClose={() => {
  setDetailBookKey(null);
  if (searchParams.has("book")) {
    const next = new URLSearchParams(searchParams);
    next.delete("book");
    setSearchParams(next, { replace: true });
  }
}}
```

- [ ] **Step 3: Verify both clients**

```bash
npm run typecheck --workspace frontend
npm run lint --workspace frontend
npm test --workspace frontend
npm run typecheck --workspace mobile
npm test --workspace mobile
```
Expected: all pass.

- [ ] **Step 4: Device check (mobile)**

Run `node scripts/dev-status.mjs --json`. If an emulator is free, run `node scripts/dev-emulator.mjs` from the worktree, then check:
- Home shows Reading now (7 covers for the dev fixture) before the follower section.
- Tapping a cover opens the book sheet over Home, and back returns to Home. The tab bar must still show Home as active.
- "All activity" opens the Activity / Discover / Find people screen.

Save screenshots to the scratch folder, run `npm run dev:release` afterwards, and report what you saw. If no emulator is free, say so and skip; don't wait.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add frontend/src/pages/HomePage.tsx frontend/src/pages/LibraryPage.tsx
/usr/bin/git commit -m "Web: Home covers open the book in the library"
```
