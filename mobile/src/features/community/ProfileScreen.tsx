import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { bookKey, ensureBookBlockHeights, profileOnlyMural, type Mural } from "@scripta/shared";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import { ApiError } from "../../core/api";
import { useAuth } from "../../core/auth";
import { Button, Dialog, EmptyState, ErrorState, Icon, IconButton, Menu, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { MuralCanvas } from "../murals";
import { useMurals } from "../murals/useMurals";
import { reconstructBooks, reconstructTierlists } from "../public/adapters";
import { PublicLibraryGrid } from "../public/PublicLibraryGrid";
import type { GalleryImage } from "../gallery/api";
import { ActivityList } from "./ActivityList";
import { FeedSettingsDialog } from "./FeedSettingsDialog";
import { fetchProfile, fetchProfileLibrary, followUser, publishProfile, unfollowUser, unpublishProfile, type CommunityProfileView } from "./api";
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
    if (isOwnHandle && isUnpublished) {
      return (
        <Centered>
          <Stack.Screen options={{ headerShown: true, title: "My profile" }} />
          <EmptyState title="Your profile isn't published" body="Publish one of your murals to appear in the community." />
          <Button label="Publish profile" loading={busy} onPress={() => setPickerOpen(true)} />
          <Button label="Open your library" variant="secondary" onPress={() => router.push("/library" as never)} />
          {error ? <Toast visible message={error} tone="error" /> : null}
          <MuralPicker
            visible={pickerOpen}
            busy={busy}
            title="Publish profile"
            description="Pick the mural that becomes your public page."
            actionLabel="Publish"
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

  const profileUser = view!.profile.user;

  return (
    <Screen bottom top={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: profileUser.username,
          headerRight: isSelf
            ? () => (
                <Menu
                  title="Your profile"
                  items={[
                    { label: "Manage library…", onPress: () => router.push("/library" as never) },
                    { label: "Switch mural…", onPress: () => setPickerOpen(true) },
                    { label: "Feed settings…", onPress: () => setSettingsOpen(true) },
                    { label: "Unpublish profile…", destructive: true, onPress: () => setConfirmingUnpublish(true) },
                  ]}
                >
                  <IconButton framed accessibilityLabel="Profile options" name="more" />
                </Menu>
              )
            : () => <FollowPill following={view!.profile.viewerFollows === true} busy={busy} onPress={() => void toggleFollow()} />,
        }}
      />
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
            return <PublicLibraryGrid library={library.data.data} onPressBook={isSelf ? (book) => router.push(`/book/${encodeURIComponent(bookKey(book))}` as never) : undefined} />;
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
                  ) : isSelf ? (
                    <View style={[styles.muralPrompt, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                      <View style={styles.muralPromptRow}>
                        <Icon name="murals" size={22} color={colors.accent} />
                        <View style={styles.grow}>
                          <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>
                            {mural ? "Your mural is empty" : "No profile mural yet"}
                          </Text>
                          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                            It's the first thing people see on your profile.
                          </Text>
                        </View>
                      </View>
                      <Button label={mural ? "Edit mural" : "Create a mural"} onPress={() => router.push((mural ? `/murals/${mural.id}` : "/murals") as never)} />
                    </View>
                  ) : (
                    <MuralCanvas mural={profileOnlyMural()} books={[]} images={[]} tierlists={[]} profile={profileUser} />
                  )}
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
      <MuralPicker
        visible={pickerOpen}
        busy={busy}
        title="Publish profile"
        description="Pick the mural that becomes your public page."
        actionLabel="Publish"
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

function FollowPill({ following, busy, onPress }: { following: boolean; busy: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const tint = following ? colors.text : colors.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={following ? "Following. Tap to unfollow" : "Follow"}
      accessibilityState={{ busy, selected: following }}
      disabled={busy}
      hitSlop={spacing.sm}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        following
          ? { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border }
          : { backgroundColor: colors.accent, borderColor: colors.accent, opacity: pressed ? 0.85 : 1 },
        busy ? { opacity: 0.55 } : null,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={tint} /> : <>
        <Icon name={following ? "confirm" : "add"} size={14} color={tint} />
        <Text {...dynamicType} style={[typography.caption, styles.strong, { color: tint }]}>{following ? "Following" : "Follow"}</Text>
      </>}
    </Pressable>
  );
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
  onClose,
  onPick,
}: {
  visible: boolean;
  busy: boolean;
  title: string;
  description: string;
  actionLabel: string;
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
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, height: 32, paddingHorizontal: spacing.md + 2, borderRadius: radii.full, borderWidth: 1 },
  eyebrow: { textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "600" },
  muralHeader: { gap: spacing.lg, marginBottom: spacing.xs },
  muralPrompt: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  muralPromptRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radii.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  dialogGap: { gap: spacing.md },
  pickerList: { maxHeight: 240, flexGrow: 0 },
  pickerRow: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm },
});
