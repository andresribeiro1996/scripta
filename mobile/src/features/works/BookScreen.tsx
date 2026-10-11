import { useState } from "react";
import { router } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { bookKey, editionLabel, readSnapshot, type BookScreenModel, type BookScreenTabKey, type ReadStatus, type WorkPage } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Button, Menu, Segmented, dynamicType, radii, spacing, typography, useTheme, type MenuItem } from "../../ui";
import { useLibraryActions } from "../library/hooks/useLibraryActions";
import { BookCover } from "../arena/BookCover";
import { AuthorAvatar, openProfile } from "../community/AuthorAvatar";
import { ReaderGlyph } from "../community/ReaderGlyph";

export function bookMenuItems(model: BookScreenModel, key: string): MenuItem[] {
  const to = (suffix: string) => () => router.push(`/book/${encodeURIComponent(key)}/${suffix}` as never);
  return model.menu.flatMap((item) => (item === "style" ? [{ label: "Card style", onPress: to("style") }] : item === "cover" ? [{ label: "Change cover", onPress: to("cover") }] : []));
}

function confirmDeleteNote(onConfirm: () => void) {
  Alert.alert("Delete this note?", "This can't be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: onConfirm },
  ]);
}

function OwnerRow({ book, model }: { book: Record<string, unknown>; model: BookScreenModel }) {
  const { colors } = useTheme();
  const { setStatus, setRating } = useLibraryActions();

  async function changeStatus(status: ReadStatus) {
    const before = readSnapshot(book);
    const wasFinished = book.ReadStatus === 2;
    const saved = await setStatus(book, status);
    if (saved && status === 2 && !wasFinished) router.push(`/book/${encodeURIComponent(bookKey(book))}/finished?before=${encodeURIComponent(JSON.stringify(before))}` as never);
  }

  const { status, feeling } = model;
  if (!status) return null;
  return (
    <View style={styles.primaryRow}>
      <Menu title="Reading status" items={status.options.map((o) => ({ label: o.label, selected: o.selected, onPress: o.selected ? () => {} : () => void changeStatus(o.value) }))}>
        <View style={[styles.menuButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
          <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.accent }]}>{status.label} ▾</Text>
        </View>
      </Menu>
      {feeling ? (
        <Menu title="How it landed" items={feeling.options.map((o) => ({ label: o.label, selected: o.selected, onPress: o.selected ? () => {} : () => void setRating(book, o.rating) }))}>
          <View style={[styles.menuButton, { borderColor: colors.border }]}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text }]}>{feeling.label} ▾</Text>
          </View>
        </Menu>
      ) : null}
    </View>
  );
}

function DeleteNote({ book, bookmarkId }: { book: Record<string, unknown>; bookmarkId: string }) {
  const { colors } = useTheme();
  const { deleteNote } = useLibraryActions();
  return (
    <Text accessibilityRole="button" {...dynamicType} onPress={() => confirmDeleteNote(() => void deleteNote(book, bookmarkId))} style={[typography.caption, styles.strong, { color: colors.danger }]}>
      Delete
    </Text>
  );
}

export function BookScreen({ page, book, model, signedIn, onAdd }: { page: WorkPage | null; book: Record<string, unknown> | null; model: BookScreenModel; signedIn: boolean; onAdd: () => void }) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<BookScreenTabKey | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [editionsOpen, setEditionsOpen] = useState(false);
  const tab = model.tabs.some((t) => t.key === selected) ? selected : model.tabs[0]?.key;
  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  const heading = (title: string) => (
    <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{title}</Text>
  );
  const cover = (typeof book?._coverUrl === "string" ? book._coverUrl : null) ?? page?.work.coverUrl ?? null;
  const { about, community } = model;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heroCentered}>
        <BookCover cover={cover} title={model.title} width={112} height={168} />
        <Text {...dynamicType} style={[typography.heading, styles.centeredText, { color: colors.text }]}>{model.title}</Text>
        <Text {...dynamicType} style={[typography.body, styles.centeredText, { color: colors.textDim }]}>{model.author}</Text>
        {model.genres.length > 0 ? (
          <View style={styles.chips}>
            {model.genres.map((genre) => (
              <View key={genre} style={[styles.chip, { borderColor: colors.border }]}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{genre}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {model.meta ? <Text {...dynamicType} style={[typography.caption, styles.centeredText, { color: colors.textDim }]}>{model.meta}</Text> : null}
      </View>

      {model.primary === "add" ? <Button label="Add to library" variant="primary" onPress={onAdd} /> : null}
      {model.primary === "owner" && book ? <OwnerRow book={book} model={model} /> : null}

      {model.tabs.length > 1 && tab ? (
        <Segmented accessibilityLabel="Book sections" options={model.tabs.map((t) => ({ value: t.key, label: t.label }))} value={tab} onChange={setSelected} />
      ) : null}

      {tab === "about" && about ? (
        <>
          {about.summary ? (
            <View style={styles.section}>
              {heading("About this book")}
              <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{aboutOpen || !about.preview ? about.summary : about.preview}</Text>
              {about.preview ? <Button label={aboutOpen ? "Show less" : "Show more"} variant="secondary" onPress={() => setAboutOpen(!aboutOpen)} /> : null}
            </View>
          ) : null}
          {about.editions.length > 0 ? (
            <View style={styles.section}>
              {heading("Editions")}
              {(editionsOpen ? about.editions : about.editionsPreview).map((edition) => (
                <Text key={edition.bookId} {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
                  <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{edition.title}</Text>
                  {` · ${editionLabel(edition)}${edition.mine ? " · Yours" : ""}`}
                </Text>
              ))}
              {about.editions.length > about.editionsPreview.length ? (
                <Button label={editionsOpen ? "Show fewer" : `Show all ${about.editions.length}`} variant="secondary" onPress={() => setEditionsOpen(!editionsOpen)} />
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      {tab === "highlights" ? (
        <View style={styles.section}>
          {model.highlights.length === 0 ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>No highlights yet.</Text> : null}
          {model.highlights.map((h, i) => (
            <View key={String(h.BookmarkID ?? i)} style={[styles.highlight, { borderColor: colors.border }]}>
              <Text {...dynamicType} style={[typography.body, styles.quote, { color: colors.text }]}>{String(h.Text)}</Text>
              {String(h.Annotation ?? "").trim() !== "" ? (
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{String(h.Annotation)}</Text>
              ) : null}
              {book && String(h.BookmarkID ?? "").startsWith("note:") ? <DeleteNote book={book} bookmarkId={String(h.BookmarkID)} /> : null}
            </View>
          ))}
        </View>
      ) : null}

      {tab === "community" && community ? (
        <>
          <View style={styles.section}>
            <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{community.countsLabel}</Text>
            {community.groups.map((group) => (
              <View key={group.key} style={styles.group}>
                {group.title ? <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.textDim }]}>{group.title}</Text> : null}
                {group.rows.map((row) => {
                  const body = (
                    <>
                      <AuthorAvatar username={row.username} avatarUrl={row.avatarUrl} />
                      <View style={styles.nameRow}>
                        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.name, { color: colors.text }]}>{row.username}</Text>
                        <ReaderGlyph identity={row.readerGlyph} />
                      </View>
                      <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{row.status}</Text>
                    </>
                  );
                  return row.linksToProfile && signedIn ? (
                    <Pressable key={row.username} accessibilityRole="button" accessibilityLabel={`Open ${row.username}'s profile, ${row.status}`} onPress={() => openProfile(row.username)} style={[card, styles.row]}>
                      {body}
                    </Pressable>
                  ) : (
                    <View key={row.username} style={[card, styles.row]}>{body}</View>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.section}>
            {heading("Games")}
            {community.games.length === 0 ? (
              <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>No public games use this book yet.</Text>
            ) : (
              community.games.map((game) => (
                <Pressable key={game.key} accessibilityRole="button" accessibilityLabel={`${game.title}, ${game.detail}`} onPress={() => router.push(game.path as never)} style={card}>
                  <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{game.title}</Text>
                  <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{game.detail}</Text>
                </Pressable>
              ))
            )}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge },
  heroCentered: { alignItems: "center", gap: spacing.xs },
  centeredText: { textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, justifyContent: "center" },
  chip: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm },
  section: { gap: spacing.sm },
  group: { gap: spacing.sm },
  primaryRow: { flexDirection: "row", gap: spacing.sm },
  menuButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  strong: { fontWeight: "700" },
  quote: { fontStyle: "italic" },
  highlight: { borderLeftWidth: 2, paddingLeft: spacing.md, gap: spacing.xs },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center" },
  nameRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  name: { flexShrink: 1 },
});
