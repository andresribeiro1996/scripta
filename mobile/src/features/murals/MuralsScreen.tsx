// The native Murals tab — mirrors frontend's pages/MuralsListPage.tsx. The web
// page carries its folder tree in a sidebar; on a phone that strip of pills
// (All, Unfiled, every folder, New folder, and the selected folder's Edit and
// Delete) cost about a third of the screen and pushed its own actions off the
// right edge. Search is a field at the top of the list and the folder choice and
// its management live on the overflow menu, the same treatment the Library
// screen got — the header title carries which folder is in view, so the list
// keeps the whole screen.

import { useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { buildMuralPreset, buildTree, MURAL_PRESETS, presetAvailability, type Mural, type MuralFolder, type MuralPresetId } from "@scripta/shared";
import { Button, dynamicType, EmptyState, ErrorState, HeaderActions, IconButton, Input, Menu, ModalBody, Screen, Sheet, Toast, type MenuItem } from "../../ui";
import { radii, spacing, typography, useTheme } from "../../ui/theme";
import { fetchGalleryImages } from "../gallery/api";
import { fetchTierlists } from "../tierlists/api";
import { useLibrary } from "../library/hooks/useLibrary";
import { API_URL } from "../../core/config";
import { useAuth } from "../../core/auth";
import { fetchOwnProfile } from "../community/api";
import { MuralShareSheet } from "./MuralShareSheet";
import { useMuralFolders, useMurals } from "./useMurals";

export function MuralsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const murals = useMurals();
  const folders = useMuralFolders();
  const { user } = useAuth();
  const ownProfile = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
  const libraryQuery = useLibrary();
  const { data: library } = libraryQuery;
  const gallery = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });
  const tierlists = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists });
  const [folderId, setFolderId] = useState<string | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [presets, setPresets] = useState(false);
  const pendingPreset = useRef<{ id: string; preset: MuralPresetId } | null>(null);
  const working = useRef(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [coverFor, setCoverFor] = useState<Mural | null>(null);
  const [shareFor, setShareFor] = useState<Mural | null>(null);
  const [moveFor, setMoveFor] = useState<Mural | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderParentId, setFolderParentId] = useState<string | null>(null);
  const tree = buildTree(folders.data ?? []);
  const editingFolder = (folders.data ?? []).find((folder) => folder.id === editingFolderId);
  const activeFolder = typeof folderId === "string" ? (folders.data ?? []).find((folder) => folder.id === folderId) : undefined;
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (murals.data ?? []).filter((mural) => needle ? mural.name.toLowerCase().includes(needle) : folderId === undefined || mural.folderId === folderId).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [murals.data, folderId, search]);

  function openPresets() {
    setPresetError(null);
    setPresets(true);
  }

  async function createFromPreset(id: MuralPresetId) {
    if (working.current) return;
    working.current = true;
    setPresetError(null);
    try {
      const preset = buildMuralPreset(id, libraryQuery.data?.data.books ?? [], libraryQuery.data?.data.groups ?? []);
      const target = pendingPreset.current?.preset === id ? pendingPreset.current : { id: (await murals.create(preset.name, folderId ?? null)).id, preset: id };
      pendingPreset.current = target;
      const updated = await murals.update(target.id, { blocks: preset.blocks });
      pendingPreset.current = null;
      setPresets(false);
      router.push(`/murals/${updated.id}` as never);
    } catch (reason) {
      setPresetError(reason instanceof Error ? reason.message : "Couldn't create the mural. Try again.");
    } finally {
      working.current = false;
    }
  }

  function clearSearch() {
    setSearch("");
  }

  function confirmDelete(mural: Mural) {
    Alert.alert(`Delete “${mural.name}”?`, "This can't be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void murals.remove(mural.id) }]);
  }

  function editFolder(id: string) {
    const folder = (folders.data ?? []).find((item) => item.id === id);
    if (!folder) return;
    setEditingFolderId(id);
    setFolderName(folder.name);
    setFolderParentId(folder.parentId);
  }

  function newFolder() {
    void folders.create("New folder", folderId ?? null).then((folder) => {
      setEditingFolderId(folder.id);
      setFolderName(folder.name);
      setFolderParentId(folder.parentId);
    }).catch((reason: unknown) => Alert.alert(reason instanceof Error ? reason.message : "Couldn't create that folder."));
  }

  function confirmDeleteFolder(folder: MuralFolder) {
    Alert.alert(`Delete “${folder.name}”?`, "Murals and subfolders move up one level.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void folders.remove(folder.id).then(() => setFolderId(undefined)) }]);
  }

  async function saveFolder() {
    if (!editingFolder) return;
    try {
      await folders.update(editingFolder.id, { name: folderName.trim() || editingFolder.name, parentId: folderParentId });
      setEditingFolderId(null);
    } catch (reason) {
      Alert.alert(reason instanceof Error ? reason.message : "Couldn't update that folder.");
    }
  }

  const folderItems: MenuItem[] = [
    { label: "All murals", selected: folderId === undefined, onPress: () => setFolderId(undefined) },
    { label: "Unfiled", selected: folderId === null, onPress: () => setFolderId(null) },
    ...tree.map(({ folder, depth }) => ({ label: `${"  ".repeat(depth)}${folder.name}`, selected: folderId === folder.id, onPress: () => setFolderId(folder.id) })),
  ];
  const actionItems: MenuItem[] = [
    { label: "Folder", items: folderItems },
    { label: activeFolder ? `New folder in “${activeFolder.name}”…` : "New folder…", onPress: newFolder },
    ...(activeFolder ? [
      { label: "Rename or move folder…", onPress: () => editFolder(activeFolder.id) },
      { label: "Delete folder", destructive: true, onPress: () => confirmDeleteFolder(activeFolder) },
    ] : []),
  ];
  const title = search.trim() || folderId === undefined ? "Murals" : folderId === null ? "Unfiled" : activeFolder?.name ?? "Murals";

  if (murals.isError) return <ErrorState body={murals.error.message} actionLabel="Retry" onAction={() => void murals.refetch()} />;
  return (
    <Screen top={false} style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerRight: () => (
            <HeaderActions>
              <Menu
                title="New mural"
                items={[
                  { label: "Blank mural", onPress: () => void murals.create("Untitled mural", folderId ?? null).then((mural) => router.push(`/murals/${mural.id}` as never)) },
                  { label: "Start from a preset…", onPress: openPresets },
                ]}
              >
                <IconButton framed accessibilityLabel="New mural" label="New" name="add" />
              </Menu>
              <Menu title={title} items={actionItems}>
                <IconButton framed accessibilityLabel="Folders" name="more" />
              </Menu>
            </HeaderActions>
          ),
        }}
      />
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(murals.data ?? []).length > 0 ? <Input icon="search" accessibilityLabel="Search murals" value={search} onChangeText={setSearch} placeholder="Search murals" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" /> : null}
        refreshing={murals.isRefetching}
        onRefresh={() => void murals.refetch()}
        ListEmptyComponent={!murals.isPending ? <EmptyState title={search ? "Nothing matches" : "No murals here"} body={search ? "Search covers every folder — nothing in your murals matches this." : "Create a freeform mural or start from a preset."} actionLabel={search ? "Clear search" : "Start from a preset"} onAction={search ? clearSearch : openPresets} /> : null}
        renderItem={({ item }) => <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable accessibilityLabel={`Open ${item.name}`} accessibilityRole="button" style={styles.open} onPress={() => router.push(`/murals/${item.id}` as never)}>{item.coverImageUrl ? <Image source={{ uri: item.coverImageUrl }} style={styles.cover} contentFit="cover" /> : null}<View style={styles.grow}><View style={styles.nameRow}><Text numberOfLines={1} style={[typography.title, styles.name, { color: colors.text, fontWeight: "700" }]}>{item.name}</Text>{ownProfile.data?.muralId === item.id ? <View style={[styles.profileBadge, { borderColor: colors.border, backgroundColor: colors.accentSoft }]}><Text numberOfLines={1} style={[typography.caption, { color: colors.accent }]}>My shelf</Text></View> : null}</View><Text style={[typography.caption, { color: colors.textDim }]}>{item.blocks.length} blocks</Text></View></Pressable>
          <Menu
            title={item.name}
            items={[
              { label: "Move to folder…", onPress: () => setMoveFor(item) },
              { label: "Change cover…", onPress: () => setCoverFor(item) },
              { label: "Share…", onPress: () => setShareFor(item) },
              { label: "Delete", destructive: true, onPress: () => confirmDelete(item) },
            ]}
          >
            <IconButton accessibilityLabel={`Actions for ${item.name}`} name="more" />
          </Menu>
        </View>}
      />
      <Sheet visible={presets} title="Start from a preset" onClose={() => setPresets(false)}>
        <View style={styles.sheet}>
          {presetError ? <Toast visible message={presetError} tone="error" /> : null}
          {libraryQuery.isError ? <><Toast visible message="Couldn't load your library." tone="error" /><Button label="Retry" variant="secondary" onPress={() => void libraryQuery.refetch()} /></> : null}
          {MURAL_PRESETS.map((preset) => {
            const reason = libraryQuery.isPending ? "Loading library…" : libraryQuery.isError ? undefined : presetAvailability(preset.id, libraryQuery.data?.data.books ?? []);
            return (
              <View key={preset.id} style={styles.presetRow}>
                <Button label={preset.name} variant="secondary" disabled={libraryQuery.isPending || libraryQuery.isError || Boolean(reason)} onPress={() => void createFromPreset(preset.id)} />
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{preset.description}</Text>
                {reason ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{reason}</Text> : null}
              </View>
            );
          })}
        </View>
      </Sheet>
      <Sheet visible={coverFor !== null} title="Mural cover" onClose={() => setCoverFor(null)}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>{coverFor?.coverImageId ? <Button label="Remove cover" variant="destructive" onPress={() => void murals.clearCover(coverFor.id).then(() => setCoverFor(null))} /> : null}{(gallery.data ?? []).map((image) => <Pressable accessibilityLabel={`Use ${image.filename} as mural cover`} accessibilityRole="button" key={image.id} onPress={() => void murals.setCover(coverFor!.id, image.id, image.url).then(() => setCoverFor(null))}><Image source={{ uri: image.url }} style={styles.imageChoice} /></Pressable>)}</ScrollView></Sheet>
      <MuralShareSheet mural={shareFor} books={library?.data.books ?? []} groups={library?.data.groups ?? []} images={gallery.data ?? []} tierlists={tierlists.data ?? []} profile={user?.username ? { username: user.username, avatarUrl: user.avatarId ? `${API_URL}/auth/avatar/${user.avatarId}/file` : null } : undefined} contentReady={!libraryQuery.isPending && !gallery.isPending && !tierlists.isPending} contentError={libraryQuery.error?.message ?? gallery.error?.message ?? tierlists.error?.message ?? undefined} onRetryContent={() => { void libraryQuery.refetch(); void gallery.refetch(); void tierlists.refetch(); }} onClose={() => setShareFor(null)} onEnableLink={async () => {
        if (!shareFor) return;
        const updated = await murals.share(shareFor.id);
        setShareFor(updated);
        return updated.shareUrl ?? undefined;
      }} onDisableLink={async () => {
        if (!shareFor) return;
        setShareFor(await murals.unshare(shareFor.id));
      }} />
      <Sheet visible={moveFor !== null} title="Move mural" onClose={() => setMoveFor(null)}><ModalBody><Button label="Unfiled" variant={moveFor?.folderId === null ? "primary" : "secondary"} onPress={() => void murals.update(moveFor!.id, { folderId: null }).then(() => setMoveFor(null))} />{tree.map(({ folder, depth }) => <Button key={folder.id} label={`${"  ".repeat(depth)}${folder.name}`} variant={moveFor?.folderId === folder.id ? "primary" : "secondary"} onPress={() => void murals.update(moveFor!.id, { folderId: folder.id }).then(() => setMoveFor(null))} />)}</ModalBody></Sheet>
      <Sheet visible={editingFolderId !== null} title="Folder" onClose={() => setEditingFolderId(null)}><ModalBody><Input label="Folder name" value={folderName} onChangeText={setFolderName} /><Text style={[typography.caption, { color: colors.textDim }]}>Parent folder</Text><Button label="Top level" variant={folderParentId === null ? "primary" : "secondary"} onPress={() => setFolderParentId(null)} />{tree.filter(({ folder }) => folder.id !== editingFolderId).map(({ folder, depth }) => <Button key={folder.id} label={`${"  ".repeat(depth)}${folder.name}`} variant={folderParentId === folder.id ? "primary" : "secondary"} onPress={() => setFolderParentId(folder.id)} />)}<Button label="Save folder" onPress={() => void saveFolder()} /></ModalBody></Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  list: { gap: spacing.md, paddingBottom: spacing.huge, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm, flexDirection: "row", alignItems: "center" },
  open: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  cover: { width: 64, height: 64, borderRadius: radii.md },
  grow: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { flexShrink: 1 },
  profileBadge: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  sheet: { gap: spacing.sm, paddingBottom: spacing.xl },
  presetRow: { gap: spacing.xs },
  imageChoice: { width: "100%", height: 120, borderRadius: radii.md },
});
