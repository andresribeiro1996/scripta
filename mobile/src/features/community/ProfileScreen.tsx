import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { ensureBookBlockHeights, profileOnlyMural, type Mural } from "@scripta/shared";
import { Button, Dialog, EmptyState, ErrorState, Icon, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { MuralCanvas } from "../murals";
import { useMurals } from "../murals/useMurals";
import { reconstructBooks, reconstructTierlists } from "../public/adapters";
import { PublicLibraryGrid } from "../public/PublicLibraryGrid";
import type { GalleryImage } from "../gallery/api";
import { ActivityList } from "./ActivityList";
import { fetchProfile, fetchProfileLibrary, followUser, unfollowUser, type CommunityProfileView } from "./api";
import { contentDetail, contentKindLabel, contentTarget } from "./communityHome";

export function ProfileScreen({ username }: { username: string }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ["community", "profile", username],
    queryFn: () => fetchProfile(username),
    enabled: Boolean(username),
    retry: false,
  });

  const [tab, setTab] = useState<ProfileTab>("mural");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = profile.data;

  const muralData = view?.mural ?? null;
  const books = useMemo(() => (muralData ? reconstructBooks(muralData.library.books, muralData.library.currentlyReading, muralData.library.highlights) : []), [muralData]);
  const images = useMemo<GalleryImage[]>(() => (muralData ? Object.entries(muralData.imageUrls).filter((entry): entry is [string, string] => entry[1] !== null).map(([id, url]) => ({ id, url, filename: "", mimeType: "", width: 0, height: 0, byteSize: 0, createdAt: "" })) : []), [muralData]);
  const tierlists = useMemo(() => reconstructTierlists(muralData?.tierlists ?? {}), [muralData]);
  const library = useQuery({
    queryKey: ["community", "profile-library", username],
    queryFn: () => fetchProfileLibrary(username),
    enabled: profile.isSuccess,
    retry: false,
  });

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["community", "profile", username] });
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFollow() {
    if (!view) return;
    await run(async () => {
      if (view.profile.viewerFollows) await unfollowUser(view.profile.user.userId);
      else await followUser(view.profile.user.userId);
    });
  }

  if (profile.isPending) return <Centered><Skeleton height={180} /></Centered>;

  if (profile.isError) {
    return (
      <Centered>
        <Stack.Screen options={{ headerShown: true, title: username }} />
        <EmptyState title="This profile is private" body="Only published profiles are visible in the community." />
      </Centered>
    );
  }

  const mural: Mural | null = muralData
    ? {
        id: muralData.mural.id,
        name: muralData.mural.name,
        blocks: ensureBookBlockHeights(muralData.mural.blocks),
        createdAt: "",
        updatedAt: "",
        coverImageUrl: muralData.mural.coverImageUrl ?? undefined,
        shareToken: null,
        shareUrl: null,
        folderId: null,
      }
    : null;

  const profileUser = view!.profile.user;

  return (
    <Screen bottom top={false}>
      <Stack.Screen options={{ headerShown: true, title: profileUser.username }} />
      {error ? <Toast visible message={error} tone="error" /> : null}
      <SwipeableTabs
        accessibilityLabel="Profile sections"
        options={PROFILE_TABS}
        value={tab}
        onChange={setTab}
        renderPage={(value) => {
          if (value === "activity") return <ActivityList username={username} />;
          if (value === "library") {
            if (library.isPending) return <View style={styles.page}><Skeleton height={180} /></View>;
            if (library.isError) return <View style={styles.page}><ErrorState body="Couldn't load this library." actionLabel="Retry" onAction={() => void library.refetch()} /></View>;
            return <PublicLibraryGrid library={library.data.data} />;
          }
          return (
            <FlatList
              data={publishedRows(view!)}
              keyExtractor={(row) => `${row.kind}:${row.id}`}
              contentContainerStyle={styles.list}
              refreshing={profile.isRefetching}
              onRefresh={() => void profile.refetch()}
              ListHeaderComponent={
                <View style={styles.muralHeader}>
                  {mural && mural.blocks.length > 0 ? (
                    <MuralCanvas
                      mural={mural}
                      books={books}
                      images={images}
                      tierlists={tierlists}
                      profile={profileUser}
                      shelfThemeOverride={muralData?.library.shelfTheme}
                      statsOverride={muralData?.library.stats}
                    />
                  ) : (
                    <MuralCanvas mural={profileOnlyMural()} books={[]} images={[]} tierlists={[]} profile={profileUser} />
                  )}
                  <Button
                    label={view!.profile.viewerFollows === true ? "Following" : "Follow"}
                    variant={view!.profile.viewerFollows === true ? "secondary" : "primary"}
                    loading={busy}
                    onPress={() => void toggleFollow()}
                  />
                  <Text {...dynamicType} style={[typography.caption, styles.eyebrow, { color: colors.textDim }]}>
                    Published
                  </Text>
                </View>
              }
              ListEmptyComponent={<EmptyState title="Nothing published yet" body="Tier lists and tournaments show up here." />}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${item.name}`}
                  onPress={() => router.push(item.target as never)}
                  style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border }]}
                >
                  <View style={styles.grow}>
                    <Text {...dynamicType} style={[typography.caption, styles.eyebrow, { color: colors.accent }]}>
                      {item.label}
                    </Text>
                    <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>
                      {item.name}
                    </Text>
                    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                      {item.detail}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={16} color={colors.textDim} />
                </Pressable>
              )}
            />
          );
        }}
      />
    </Screen>
  );
}

const PROFILE_TABS = [
  { value: "mural", label: "Mural" },
  { value: "activity", label: "Activity" },
  { value: "library", label: "Library" },
] as const;

type ProfileTab = (typeof PROFILE_TABS)[number]["value"];

type PublishedRow = { kind: "tierlist" | "tournament"; id: string; name: string; detail: string; target: string; label: string };

function publishedRows(view: CommunityProfileView): PublishedRow[] {
  const rows: PublishedRow[] = [];
  for (const item of view.published.tierlists) {
    rows.push({ kind: "tierlist", id: item.id, name: item.name, detail: contentDetail(item), target: contentTarget(item), label: contentKindLabel(item) });
  }
  for (const item of view.published.tournaments) {
    rows.push({ kind: "tournament", id: item.id, name: item.name, detail: contentDetail(item), target: contentTarget(item), label: contentKindLabel(item) });
  }
  return rows;
}

function Centered({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.centered, { backgroundColor: colors.background }]}>{children}</View>;
}

export function MuralPicker({
  visible,
  busy,
  title,
  description,
  actionLabel,
  error,
  onClose,
  onPick,
}: {
  visible: boolean;
  busy: boolean;
  title: string;
  description: string;
  actionLabel: string;
  error?: string | null;
  onClose: () => void;
  onPick: (muralId: string) => void;
}) {
  const { colors } = useTheme();
  const murals = useMurals();
  const [selected, setSelected] = useState<string | null>(null);
  const items = murals.data ?? [];
  return (
    <Dialog visible={visible} title={title} onClose={onClose}>
      <View style={styles.dialogGap}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
          {description}
        </Text>
        {error ? <Toast visible message={error} tone="error" /> : null}
        {murals.isPending ? (
          <Skeleton height={120} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            style={styles.pickerList}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: selected === item.id }}
                onPress={() => setSelected(item.id)}
                style={[styles.pickerRow, { borderColor: colors.border, backgroundColor: selected === item.id ? colors.accentSoft : colors.surface }]}
              >
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text }]}>
                  {item.name}
                </Text>
              </Pressable>
            )}
          />
        )}
        <Button
          label={actionLabel}
          disabled={!selected}
          loading={busy}
          onPress={() => selected && onPick(selected)}
        />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  centered: { flex: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  page: { flex: 1, padding: spacing.lg },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.huge },
  eyebrow: { textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "600" },
  muralHeader: { gap: spacing.lg, marginBottom: spacing.xs },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radii.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  dialogGap: { gap: spacing.md },
  pickerList: { maxHeight: 240, flexGrow: 0 },
  pickerRow: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm },
});
