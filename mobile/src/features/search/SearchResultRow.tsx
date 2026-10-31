import { Pressable, StyleSheet, View } from "react-native";
import { router, useSegments } from "expo-router";
import { bookKey, searchResultByline, seriesLabel, type BookSearchResult, type LibraryBook } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Button, ErrorState, IconButton, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { DiscoverRow, StatusBadge } from "../community/DiscoverRow";
import { PersonRow } from "../community/PersonRow";
import type { useFollowToggle } from "../community/useFollowToggle";
import { CoverImage } from "../library/components/CoverImage";
import { workPath } from "../works/workPath";
import { SCOPE_OF, SECTION_ERRORS, SECTION_TITLES, libraryStatus, type ResultSection, type SearchRow, type SearchScope } from "./searchModel";
import { useLocale } from "../../i18n";

export type ResultActions = {
  query: string;
  follow: ReturnType<typeof useFollowToggle>;
  onOpen: () => void;
  onAdd: (result: BookSearchResult) => void;
  onSeeAll: (scope: SearchScope) => void;
  onRetry: (section: ResultSection) => void;
  onSearchOpenLibrary: () => void;
  onRetryOpenLibrary: () => void;
};

export function SearchResultRow({ row, actions }: { row: SearchRow; actions: ResultActions }) {
  const { colors } = useTheme();
  switch (row.kind) {
    case "header":
      return (
        <SectionTitle
          title={SECTION_TITLES[row.section]}
          caption={row.section === "books" ? "Tap for details, + to add" : undefined}
          action={row.seeAll ? { label: "See all", onPress: () => actions.onSeeAll(SCOPE_OF[row.section]) } : undefined}
        />
      );
    case "library":
      return <LibraryResultRow book={row.book} onOpen={actions.onOpen} />;
    case "book":
      return <BookResultRow result={row.result} onOpen={actions.onOpen} onAdd={actions.onAdd} />;
    case "person":
      return (
        <View style={styles.pad}>
          <PersonRow person={row.person} busy={actions.follow.busyId === row.person.user.userId} onToggleFollow={() => void actions.follow.toggle(row.person)} onOpen={actions.onOpen} />
        </View>
      );
    case "game":
      return <DiscoverRow item={row.item} linkAuthor onOpen={actions.onOpen} />;
    case "loading":
      return <View style={styles.pad}><Skeleton height={60} /></View>;
    case "failed":
      return <View style={styles.pad}><ErrorState body={SECTION_ERRORS[row.section]} actionLabel="Retry" onAction={() => actions.onRetry(row.section)} /></View>;
    case "catalogEmpty":
      return (
        <View style={[styles.pad, styles.stack]}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Nothing in the catalog yet.</Text>
          <Button label="Search Open Library" variant="secondary" onPress={actions.onSearchOpenLibrary} />
        </View>
      );
    case "openLibrary":
      return row.state === "pending" ? (
        <Text {...dynamicType} style={[typography.caption, styles.pad, styles.line, { color: colors.textDim }]}>Still searching Open Library…</Text>
      ) : (
        <View style={[styles.pad, styles.stack]}>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Couldn't reach Open Library.</Text>
          <Button label="Retry" variant="secondary" onPress={actions.onRetryOpenLibrary} />
        </View>
      );
    case "addByHand":
      return (
        <Pressable accessibilityRole="link" onPress={() => router.push(`/add-book?q=${encodeURIComponent(actions.query)}` as never)} style={[styles.pad, styles.link]}>
          <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text, textDecorationLine: "underline" }]}>Not here? Add it by hand</Text>
        </Pressable>
      );
    case "noResults":
      return <Text {...dynamicType} style={[typography.body, styles.pad, styles.line, { color: colors.textDim }]}>No results for “{actions.query}”.</Text>;
  }
}

export function SectionTitle({ title, caption, action }: { title: string; caption?: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useTheme();
  return (
    <View style={styles.title}>
      <Text accessibilityRole="header" {...dynamicType} numberOfLines={1} style={[typography.body, styles.strong, styles.shrink, { color: colors.text }]}>{title}</Text>
      {caption ? <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.shrink, styles.right, { color: colors.textDim }]}>{caption}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="button" hitSlop={12} onPress={action.onPress} style={caption ? undefined : styles.right}>
          <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function LibraryResultRow({ book, onOpen }: { book: LibraryBook; onOpen: () => void }) {
  const { colors } = useTheme();
  const title = String(book.Title ?? "Untitled");
  const author = String(book.Attribution ?? "Unknown author");
  const status = libraryStatus(book);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} by ${author}, ${status.label}`}
      onPress={() => {
        onOpen();
        router.push(`/book/${encodeURIComponent(bookKey(book))}` as never);
      }}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}
    >
      <View style={[styles.cover, { backgroundColor: colors.border }]}><CoverImage book={book} /></View>
      <View style={styles.grow}>
        <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{title}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{author}</Text>
      </View>
      <StatusBadge label={status.label} tone={status.tone} />
    </Pressable>
  );
}

function BookResultRow({ result, onOpen, onAdd }: { result: BookSearchResult; onOpen: () => void; onAdd: (result: BookSearchResult) => void }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const segments = useSegments();
  const byline = searchResultByline(result);
  const series = result.series ? seriesLabel(result.series, locale) : null;
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[result.title, series, byline].filter(Boolean).join(", ")}
        onPress={() => {
          onOpen();
          if (result.workId) router.push(workPath(result.workId, segments, result.bookId) as never);
          else onAdd(result);
        }}
        style={styles.bookOpen}
      >
        <BookCover cover={result.coverUrl} title={result.title} width={40} height={60} />
        <View style={styles.grow}>
          <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{result.title}</Text>
          {series ? <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{series}</Text> : null}
          {byline ? <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{byline}</Text> : null}
        </View>
      </Pressable>
      <IconButton name="add" accessibilityLabel={`Add ${result.title}`} onPress={() => onAdd(result)} />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  strong: { fontWeight: "700" },
  pad: { paddingHorizontal: spacing.lg },
  line: { paddingVertical: spacing.sm },
  stack: { gap: spacing.sm, paddingVertical: spacing.sm },
  link: { minHeight: 44, justifyContent: "center" },
  title: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  right: { marginLeft: "auto" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  bookOpen: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60 },
  cover: { width: 40, aspectRatio: 2 / 3, borderRadius: radii.sm, overflow: "hidden" },
});
