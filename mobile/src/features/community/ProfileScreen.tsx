import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { ensureBookBlockHeights, type Mural } from "@scripta/shared";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import { ApiError } from "../../core/api";
import { useAuth } from "../../core/auth";
import { Button, Dialog, EmptyState, ErrorState, Screen, Segmented, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { MuralCanvas } from "../murals";
import { useMurals } from "../murals/useMurals";
import { reconstructBooks, reconstructTierlists } from "../public/adapters";
import type { GalleryImage } from "../gallery/api";
import { ActivityList } from "./ActivityList";
import { FeedSettingsDialog } from "./FeedSettingsDialog";
import { fetchProfile, followUser, publishProfile, unfollowUser, unpublishProfile, type CommunityProfileView } from "./api";
import { contentDetail, contentKindLabel, contentTarget } from "./communityHome";

export function ProfileScreen({ username }: { username: string }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ["community", "profile", username],
    queryFn: () => fetchProfile(username),
    enabled: Boolean(username),
    retry: false,
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<ProfileTab>("mural");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUnpublished = profile.error instanceof ApiError && profile.error.status === 404;
  const view = profile.data;
  const isSelf = view?.profile.user.userId === user?.id;
  const isOwnHandle = user?.username === username;

  const muralData = view?.mural ?? null;
  const books = useMemo(() => (muralData ? reconstructBooks(muralData.library.books, muralData.library.currentlyReading, muralData.library.highlights) : []), [muralData]);
  const images = useMemo<GalleryImage[]>(() => (muralData ? Object.entries(muralData.imageUrls).filter((entry): entry is [string, string] => entry[1] !== null).map(([id, url]) => ({ id, url, filename: "", mimeType: "", width: 0, height: 0, byteSize: 0, createdAt: "" })) : []), [muralData]);
  const tierlists = useMemo(() => reconstructTierlists(muralData?.tierlists ?? {}), [muralData]);

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
    if (isOwnHandle && isUnpublished) {
      return (
        <Centered>
          <Stack.Screen options={{ headerShown: true, title: "My profile" }} />
          <EmptyState title="Your profile isn't published" body="Publish one of your murals to appear in the community." />
          <Button label="Publish profile" loading={busy} onPress={() => setPickerOpen(true)} />
          {error ? <Toast visible message={error} tone="error" /> : null}
          <MuralPicker
            visible={pickerOpen}
            busy={busy}
            onClose={() => setPickerOpen(false)}
            onPick={(muralId) => run(async () => {
              await publishProfile(muralId);
              setPickerOpen(false);
            })}
          />
        </Centered>
      );
    }
    if (isOwnHandle) {
      return (
        <Centered>
          <ErrorState title="Profile unavailable" body="Couldn't load your profile." actionLabel="Retry" onAction={() => void profile.refetch()} />
        </Centered>
      );
    }
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

  const header = (
    <View style={styles.header}>
      <View style={styles.identityRow}>
        {view!.profile.user.avatarUrl ? (
          <Image source={{ uri: view!.profile.user.avatarUrl }} contentFit="cover" style={styles.bigAvatar} />
        ) : (
          <View style={[styles.bigAvatar, styles.avatarFallback, { backgroundColor: colors.accentSoft }]}>
            <Text {...dynamicType} style={[typography.title, { color: colors.accent }]}>
              {view!.profile.user.username.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.grow}>
          <Text {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>
            {view!.profile.user.username}
          </Text>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
            {view!.profile.followerCount} {view!.profile.followerCount === 1 ? "follower" : "followers"} · {view!.profile.followingCount} following
          </Text>
        </View>
      </View>
      {isSelf ? (
        <View style={styles.ownerRow}>
          <Button label="Switch mural" variant="secondary" loading={busy} onPress={() => setPickerOpen(true)} />
          <Button label="Feed settings" variant="secondary" onPress={() => setSettingsOpen(true)} />
          <Button label="Unpublish" variant="destructive" loading={busy} onPress={() => setConfirmingUnpublish(true)} />
        </View>
      ) : (
        <Button
          label={view!.profile.viewerFollows ? "Following" : "Follow"}
          variant={view!.profile.viewerFollows ? "secondary" : "primary"}
          loading={busy}
          onPress={() => void toggleFollow()}
        />
      )}
      <Segmented accessibilityLabel="Profile section" options={PROFILE_TABS} value={tab} onChange={setTab} />
      {tab === "mural" && mural && mural.blocks.length > 0 ? (
        <MuralCanvas
          mural={mural}
          books={books}
          images={images}
          tierlists={tierlists}
          profile={view!.profile.user}
          shelfThemeOverride={muralData?.library.shelfTheme}
          statsOverride={muralData?.library.stats}
        />
      ) : null}
      {tab === "mural" ? (
        <Text {...dynamicType} style={[typography.title, styles.strong, styles.sectionTitle, { color: colors.text }]}>
          Published
        </Text>
      ) : null}
    </View>
  );

  return (
    <Screen bottom>
      <Stack.Screen options={{ headerShown: true, title: view!.profile.user.username }} />
      {error ? <Toast visible message={error} tone="error" /> : null}
      {tab === "mural" ? (
        <FlatList
          style={{ flex: 1 }}
          data={publishedRows(view!)}
          keyExtractor={(row) => `${row.kind}:${row.id}`}
          contentContainerStyle={styles.list}
          refreshing={profile.isRefetching}
          onRefresh={() => void profile.refetch()}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title="Nothing published yet" body="Tier lists and tournaments show up here." />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open ${item.name}`}
              onPress={() => router.push(item.target as never)}
            >
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>
                  {item.label}
                </Text>
                <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>
                  {item.name}
                </Text>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                  {item.detail}
                </Text>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <ActivityList username={username} ListHeaderComponent={header} />
      )}
      <MuralPicker
        visible={pickerOpen}
        busy={busy}
        onClose={() => setPickerOpen(false)}
        onPick={(muralId) => run(async () => {
          await publishProfile(muralId);
          setPickerOpen(false);
        })}
      />
      <FeedSettingsDialog
        visible={settingsOpen}
        settings={view!.feedSettings ?? DEFAULT_FEED_SETTINGS}
        onClose={() => {
          setSettingsOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["community", "profile", username] });
        }}
      />
      <Dialog visible={confirmingUnpublish} title="Unpublish your profile?" onClose={() => setConfirmingUnpublish(false)}>
        <View style={styles.dialogGap}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
            Your page disappears and people stop finding you in search. You can publish again any time.
          </Text>
          <Button label="Unpublish" variant="destructive" loading={busy} onPress={() => run(async () => {
            await unpublishProfile();
            setConfirmingUnpublish(false);
          })} />
        </View>
      </Dialog>
    </Screen>
  );
}

const PROFILE_TABS = [
  { value: "mural", label: "Mural" },
  { value: "activity", label: "Activity" },
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

function MuralPicker({
  visible,
  busy,
  onClose,
  onPick,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onPick: (muralId: string) => void;
}) {
  const { colors } = useTheme();
  const murals = useMurals();
  const [selected, setSelected] = useState<string | null>(null);
  const items = murals.data ?? [];
  return (
    <Dialog visible={visible} title="Publish profile" onClose={onClose}>
      <View style={styles.dialogGap}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
          Pick the mural that becomes your public page.
        </Text>
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
          label="Publish"
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
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.huge },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  identityRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  bigAvatar: { width: 64, height: 64, borderRadius: radii.full },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  ownerRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sectionTitle: { marginTop: spacing.md },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
  dialogGap: { gap: spacing.md },
  pickerList: { maxHeight: 240, flexGrow: 0 },
  pickerRow: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm },
});
