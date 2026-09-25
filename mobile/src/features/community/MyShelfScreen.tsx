import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ensureBookBlockHeights } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { API_URL } from "../../core/config";
import { Button, Dialog, dynamicType, EmptyState, ErrorState, IconButton, Menu, radii, Screen, Skeleton, spacing, SwipeableTabs, Toast, typography, useTheme, type MenuItem } from "../../ui";
import { fetchGalleryImages } from "../gallery/api";
import { useLibrary } from "../library/hooks/useLibrary";
import { MuralCanvas } from "../murals";
import { fetchMural } from "../murals/api";
import { useMurals } from "../murals/useMurals";
import { fetchTierlists } from "../tierlists/api";
import { ActivityList } from "./ActivityList";
import { FeedSettingsDialog } from "./FeedSettingsDialog";
import { OwnLibraryPane } from "./OwnLibraryPane";
import { fetchOwnProfile, publishProfile, setShelfMural, unpublishProfile } from "./api";
import { MuralPicker } from "./ProfileScreen";

const MY_SHELF_TABS = [
  { value: "shelf", label: "Shelf" },
  { value: "library", label: "Library" },
  { value: "activity", label: "Activity" },
] as const;

type MyShelfTab = (typeof MY_SHELF_TABS)[number]["value"];

let lastTab: MyShelfTab = "shelf";

export function MyShelfScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const username = user?.username ?? "";

  const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
  const mural = useQuery({
    queryKey: ["murals", own.data?.muralId],
    queryFn: () => fetchMural(own.data!.muralId!),
    enabled: Boolean(own.data?.muralId),
  });
  const { data: library } = useLibrary();
  const gallery = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });
  const tierlistsQuery = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists });
  const murals = useMurals();

  const [tab, setTab] = useState<MyShelfTab>(lastTab);
  const [pickerMode, setPickerMode] = useState<"publish" | "switch" | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const books = library?.data.books ?? [];
  const groups = library?.data.groups ?? [];
  const images = gallery.data ?? [];
  const tierlists = tierlistsQuery.data ?? [];
  const profile = user?.username
    ? { username: user.username, avatarUrl: user.avatarId ? `${API_URL}/auth/avatar/${user.avatarId}/file` : null }
    : undefined;

  function handleTabChange(next: MyShelfTab) {
    lastTab = next;
    setTab(next);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["community", "own-profile"] });
      await queryClient.invalidateQueries({ queryKey: ["community", "profile", username] });
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleChipPress() {
    if (!own.data) return;
    if (own.data.published) setConfirmingUnpublish(true);
    else if (own.data.muralId) setConfirmingPublish(true);
    else setPickerMode("publish");
  }

  async function createShelf() {
    if (own.data?.muralId) {
      router.push(`/murals/${own.data.muralId}` as never);
      return;
    }
    let createdId: string | null = null;
    await run(async () => {
      const created = await murals.create("My shelf");
      createdId = created.id;
      await setShelfMural(created.id);
    });
    if (createdId) router.push(`/murals/${createdId}` as never);
  }

  if (own.isPending) {
    return (
      <Screen bottom top={false}>
        <Stack.Screen options={{ headerShown: true, title: "My shelf" }} />
        <View style={styles.tabPad}><Skeleton height={180} /></View>
      </Screen>
    );
  }

  if (own.isError) {
    return (
      <Screen bottom top={false}>
        <Stack.Screen options={{ headerShown: true, title: "My shelf" }} />
        <ErrorState title="Shelf unavailable" body="Couldn't load your shelf." actionLabel="Retry" onAction={() => void own.refetch()} />
      </Screen>
    );
  }

  const ownData = own.data;
  const hasMural = Boolean(ownData.muralId);
  const muralHasBlocks = Boolean(mural.data && mural.data.blocks.length > 0);

  const menuItems: MenuItem[] = [
    ...(hasMural ? [{ label: "Edit shelf", onPress: () => router.push(`/murals/${ownData.muralId}` as never) }] : []),
    { label: "Manage library…", onPress: () => router.push("/library" as never) },
    { label: "Switch shelf mural…", onPress: () => setPickerMode("switch") },
    { label: "Feed settings…", onPress: () => setSettingsOpen(true) },
  ];

  const headerRight = () => (
    <View style={styles.headerRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ownData.published ? "Published. Tap to unpublish" : "Private. Tap to publish"}
        onPress={handleChipPress}
        style={({ pressed }) => [styles.chip, { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : colors.surface }]}
      >
        <Text {...dynamicType} style={[typography.caption, styles.strong, { color: ownData.published ? colors.accent : colors.textDim }]}>
          {ownData.published ? "Published" : "Private"}
        </Text>
      </Pressable>
      <Menu title="My shelf" items={menuItems}>
        <IconButton framed accessibilityLabel="Shelf options" name="more" />
      </Menu>
    </View>
  );

  return (
    <Screen bottom top={false}>
      <Stack.Screen options={{ headerShown: true, title: "My shelf", headerRight }} />
      {error ? <Toast visible message={error} tone="error" /> : null}
      <SwipeableTabs
        accessibilityLabel="My shelf sections"
        options={MY_SHELF_TABS}
        value={tab}
        onChange={handleTabChange}
        renderPage={(value) => {
          if (value === "library") return <OwnLibraryPane />;
          if (value === "activity") return <ActivityList username={username} />;
          if (hasMural && mural.isPending) return <View style={styles.tabPad}><Skeleton height={240} /></View>;
          if (hasMural && muralHasBlocks) {
            return (
              <ScrollView contentContainerStyle={styles.canvasScroll}>
                <MuralCanvas
                  mural={{ ...mural.data!, blocks: ensureBookBlockHeights(mural.data!.blocks) }}
                  books={books}
                  groups={groups}
                  images={images}
                  tierlists={tierlists}
                  profile={profile}
                />
              </ScrollView>
            );
          }
          return (
            <EmptyState
              title="Your shelf is empty"
              body="Build a private page from your books. Only you can see it until you publish."
              actionLabel="Create your shelf"
              onAction={() => void createShelf()}
            />
          );
        }}
      />
      <MuralPicker
        visible={pickerMode !== null}
        busy={busy}
        title={pickerMode === "switch" ? "Choose your shelf" : "Publish profile"}
        description={pickerMode === "switch" ? "Pick the mural that becomes your shelf." : "Pick the mural that becomes your public page."}
        actionLabel={pickerMode === "switch" ? "Use this mural" : "Publish"}
        onClose={() => setPickerMode(null)}
        onPick={(muralId) => {
          if (pickerMode === "switch") {
            void run(async () => {
              await setShelfMural(muralId);
              setPickerMode(null);
            });
          } else {
            void run(async () => {
              await publishProfile(muralId);
              setPickerMode(null);
            });
          }
        }}
      />
      <Dialog visible={confirmingPublish} title="Publish your shelf?" onClose={() => setConfirmingPublish(false)}>
        <View style={styles.dialogGap}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
            {`It becomes a public page at /u/${username}, and people can follow you.`}
          </Text>
          <Button
            label="Publish"
            loading={busy}
            onPress={() => void run(async () => {
              await publishProfile(ownData.muralId!);
              setConfirmingPublish(false);
            })}
          />
        </View>
      </Dialog>
      <Dialog visible={confirmingUnpublish} title="Unpublish your profile?" onClose={() => setConfirmingUnpublish(false)}>
        <View style={styles.dialogGap}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
            Your page disappears and people stop finding you in search. You can publish again any time.
          </Text>
          <Button
            label="Unpublish"
            variant="destructive"
            loading={busy}
            onPress={() => void run(async () => {
              await unpublishProfile();
              setConfirmingUnpublish(false);
            })}
          />
        </View>
      </Dialog>
      <FeedSettingsDialog
        visible={settingsOpen}
        settings={ownData.feedSettings}
        onClose={() => {
          setSettingsOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["community", "own-profile"] });
          void queryClient.invalidateQueries({ queryKey: ["community", "profile", username] });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  strong: { fontWeight: "700" },
  tabPad: { flex: 1, padding: spacing.lg },
  canvasScroll: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chip: { height: 32, paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dialogGap: { gap: spacing.md },
});
