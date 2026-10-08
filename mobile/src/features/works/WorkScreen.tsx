import { useEffect, useState } from "react";
import { router, Stack, useSegments } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { editionLabel } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { isPermanentError } from "../../core/apiClient";
import { Button, ErrorState, HeaderActions, IconButton, Screen, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { AddBookSheet } from "../community/AddBookSheet";
import { AuthorAvatar, openProfile } from "../community/AuthorAvatar";
import { ReaderGlyph } from "../community/ReaderGlyph";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import { publicContentUrl } from "../sharing/links";
import { fetchWork } from "./api";
import { workScreenSections } from "./workScreenModel";

export function WorkScreen({ id }: { id: string }) {
  const { colors } = useTheme();
  const [adding, setAdding] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const inTabs = useSegments()[0] === "(app)";
  const query = useQuery({ queryKey: ["works", id], queryFn: () => fetchWork(id), retry: false });
  const canonicalId = query.data?.work.id;

  useEffect(() => {
    if (canonicalId && canonicalId !== id) router.replace(`/work/${canonicalId}` as never);
  }, [canonicalId, id]);

  const untitled = <Stack.Screen options={{ headerShown: true, title: "" }} />;
  if (!query.data && query.isError) {
    const permanent = isPermanentError(query.error);
    return (
      <Screen bottom top={false} style={styles.centered}>
        {untitled}
        <ErrorState
          title="Book unavailable"
          body={query.error instanceof Error ? query.error.message : "Couldn't load this book."}
          actionLabel={permanent ? "Back" : "Retry"}
          onAction={permanent ? () => (router.canGoBack() ? router.back() : router.replace("/")) : () => void query.refetch()}
        />
      </Screen>
    );
  }
  if (!query.data || query.data.work.id !== id) return <Screen bottom top={false} style={styles.centered}>{untitled}<Skeleton height={160} /></Screen>;

  const page = query.data;
  const { work } = page;
  const model = workScreenSections(page);
  const firstEdition = work.editions.find((edition) => edition.isbn) ?? work.editions[0];

  async function share() {
    setShareError(null);
    try {
      setShareUrl(await publicContentUrl(`/work/${encodeURIComponent(work.id)}`));
    } catch (reason) {
      setShareError(reason instanceof Error ? reason.message : "Couldn't create the share link.");
    }
  }

  const heading = (title: string) => (
    <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{title}</Text>
  );
  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <Screen bottom top={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: work.title,
          headerRight: () => (
            <HeaderActions>
              <IconButton framed name="share" accessibilityLabel="Share book" onPress={() => void share()} />
            </HeaderActions>
          ),
        }}
      />
      {shareError ? <Toast visible message={shareError} tone="error" /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <BookCover cover={work.coverUrl} title={work.title} width={96} height={138} />
          <View style={styles.grow}>
            <Text {...dynamicType} style={[typography.heading, { color: colors.text }]}>{work.title}</Text>
            <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{work.author}</Text>
          </View>
        </View>

        {model.about ? (
          <View style={styles.section}>
            {heading("About this book")}
            <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{aboutOpen || !model.aboutPreview ? model.about : model.aboutPreview}</Text>
            {model.aboutPreview ? <Button label={aboutOpen ? "Show less" : "Show more"} variant="secondary" onPress={() => setAboutOpen(!aboutOpen)} /> : null}
          </View>
        ) : null}

        <View style={styles.section}>
          {heading("Editions")}
          {work.editions.map((edition) => (
            <Text key={edition.bookId} {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
              <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{edition.title}</Text>
              {` · ${editionLabel(edition)}${edition.mine ? " · Yours" : ""}`}
            </Text>
          ))}
        </View>

        <View style={styles.section}>
          {heading("Your copy")}
          {model.mine ? (
            <View style={card}>
              <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{model.mine.status}</Text>
              <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{model.mine.detail}</Text>
            </View>
          ) : (
            <View style={card}>
              <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Not in your library</Text>
              <Button label="Add to library" variant="primary" onPress={() => setAdding(true)} />
            </View>
          )}
        </View>

        <View style={styles.section}>
          {heading("Readers")}
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{model.countsLabel}</Text>
          {model.readerGroups.map((group) => (
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
                return row.linksToProfile && inTabs ? (
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
          {model.gamesEmpty ? (
            <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>No public games use this book yet.</Text>
          ) : (
            model.games.map((game) => (
              <Pressable key={game.key} accessibilityRole="button" accessibilityLabel={`${game.title}, ${game.detail}`} onPress={() => router.push(game.path as never)} style={card}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{game.title}</Text>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{game.detail}</Text>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
      <ContentShareSheet visible={shareUrl !== null} onClose={() => setShareUrl(null)} title={work.title} url={shareUrl} />
      {adding ? (
        <AddBookSheet
          book={{ title: work.title, author: work.author, isbn: firstEdition?.isbn ?? null, coverUrl: work.coverUrl }}
          onClose={() => {
            setAdding(false);
            void query.refetch();
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.lg, gap: spacing.md },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge },
  hero: { flexDirection: "row", gap: spacing.lg },
  grow: { flex: 1, gap: spacing.xs },
  section: { gap: spacing.sm },
  group: { gap: spacing.sm },
  strong: { fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center" },
  nameRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  name: { flexShrink: 1 },
});
