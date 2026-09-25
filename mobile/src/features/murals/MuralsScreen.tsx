// The native Murals tab — mirrors frontend's pages/MuralsListPage.tsx. The web
// page carries its folder tree in a sidebar; on a phone that strip of pills
// (All, Unfiled, every folder, New folder, and the selected folder's Edit and
// Delete) cost about a third of the screen and pushed its own actions off the
// right edge. Search is the header's own search bar and the folder choice and
// its management live on the overflow menu, the same treatment the Library
// screen got — the header title carries which folder is in view, so the list
// keeps the whole screen.

import { useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import type { SearchBarCommands } from "react-native-screens";
import { buildMuralPreset, buildTree, MURAL_PRESETS, type Mural, type MuralFolder } from "@scripta/shared";
import { Button, EmptyState, ErrorState, IconButton, Input, Menu, ModalBody, Screen, Sheet, type MenuItem } from "../../ui";
import { radii, spacing, typography, useTheme } from "../../ui/theme";
import { fetchGalleryImages } from "../gallery/api";
import { useLibrary } from "../library/hooks/useLibrary";
import { ShareActions } from "../socials";
import { fetchOwnProfile } from "../community/api";
import { useMuralFolders, useMurals } from "./useMurals";

export function MuralsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const murals = useMurals();
  const folders = useMuralFolders();
  const ownProfile = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
  const { data: library } = useLibrary();
  const gallery = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });
  const [folderId, setFolderId] = useState<string | null | undefined>(undefined);
  const searchBar = useRef<SearchBarCommands>(null);
  const [search, setSearch] = useState("");
  const [presets, setPresets] = useState(false);
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

  async function createFromPreset(id: (typeof MURAL_PRESETS)[number]["id"]) {
    const preset = buildMuralPreset(id, library?.data.books ?? []);
    const mural = await murals.create(preset.name, folderId ?? null);
    const updated = await murals.update(mural.id, { blocks: preset.blocks });
    setPresets(false);
    router.push(`/murals/${updated.id}` as never);
  }

  function clearSearch() {
    searchBar.current?.clearText();
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
          headerSearchBarOptions: (murals.data ?? []).length > 0
            ? {
                ref: searchBar,
                autoCapitalize: "none",
                placeholder: "Search murals",
                hideWhenScrolling: true,
                onChangeText: (event) => setSearch(event.nativeEvent.text),
                onCancelButtonPress: () => setSearch(""),
              }
            : undefined,
          headerRight: () => (
            <View style={styles.headerActions}>
              <Menu title={title} items={actionItems}>
                <IconButton framed accessibilityLabel="Folders" name="more" />
              </Menu>
              <Menu
                title="New mural"
                items={[
                  { label: "Blank mural", onPress: () => void murals.create("Untitled mural", folderId ?? null).then((mural) => router.push(`/murals/${mural.id}` as never)) },
                  { label: "Start from a preset…", onPress: () => setPresets(true) },
                ]}
              >
                <IconButton framed accessibilityLabel="New mural" label="New" name="add" />
              </Menu>
            </View>
          ),
        }}
      />
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={murals.isRefetching}
        onRefresh={() => void murals.refetch()}
        ListEmptyComponent={!murals.isPending ? <EmptyState title={search ? "Nothing matches" : "No murals here"} body={search ? "Search covers every folder — nothing in your murals matches this." : "Create a freeform mural or start from a preset."} actionLabel={search ? "Clear search" : undefined} onAction={search ? clearSearch : undefined} /> : null}
        renderItem={({ item }) => <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable accessibilityLabel={`Open ${item.name}`} accessibilityRole="button" style={styles.open} onPress={() => router.push(`/murals/${item.id}` as never)}>{item.coverImageUrl ? <Image source={{ uri: item.coverImageUrl }} style={styles.cover} contentFit="cover" /> : null}<View style={styles.grow}><View style={styles.nameRow}><Text numberOfLines={1} style={[typography.title, styles.name, { color: colors.text, fontWeight: "700" }]}>{item.name}</Text>{ownProfile.data?.muralId === item.id ? <View style={[styles.profileBadge, { borderColor: colors.border, backgroundColor: colors.accentSoft }]}><Text style={[typography.caption, { color: colors.accent }]}>My shelf</Text></View> : null}</View><Text style={[typography.caption, { color: colors.textDim }]}>{item.blocks.length} blocks</Text></View></Pressable>
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
      <Sheet visible={presets} title="Start with a preset" onClose={() => setPresets(false)}><View style={styles.sheet}>{MURAL_PRESETS.map((preset) => <Button key={preset.id} label={preset.name} variant="secondary" onPress={() => void createFromPreset(preset.id)} />)}</View></Sheet>
      <Sheet visible={coverFor !== null} title="Mural cover" onClose={() => setCoverFor(null)}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>{coverFor?.coverImageId ? <Button label="Remove cover" variant="destructive" onPress={() => void murals.clearCover(coverFor.id).then(() => setCoverFor(null))} /> : null}{(gallery.data ?? []).map((image) => <Pressable accessibilityLabel={`Use ${image.filename} as mural cover`} accessibilityRole="button" key={image.id} onPress={() => void murals.setCover(coverFor!.id, image.id, image.url).then(() => setCoverFor(null))}><Image source={{ uri: image.url }} style={styles.imageChoice} /></Pressable>)}</ScrollView></Sheet>
      <Sheet visible={shareFor !== null} title="Share mural" onClose={() => setShareFor(null)}><View style={styles.sheet}>{shareFor?.shareUrl ? <><ShareActions message={shareFor.shareUrl} title={shareFor.name} /><Button label="Stop sharing" variant="destructive" onPress={() => void murals.unshare(shareFor.id).then(() => setShareFor(null))} /></> : <Button label="Create share link" onPress={() => void murals.share(shareFor!.id).then(setShareFor)} />}</View></Sheet>
      <Sheet visible={moveFor !== null} title="Move mural" onClose={() => setMoveFor(null)}><ModalBody><Button label="Unfiled" variant={moveFor?.folderId === null ? "primary" : "secondary"} onPress={() => void murals.update(moveFor!.id, { folderId: null }).then(() => setMoveFor(null))} />{tree.map(({ folder, depth }) => <Button key={folder.id} label={`${"  ".repeat(depth)}${folder.name}`} variant={moveFor?.folderId === folder.id ? "primary" : "secondary"} onPress={() => void murals.update(moveFor!.id, { folderId: folder.id }).then(() => setMoveFor(null))} />)}</ModalBody></Sheet>
      <Sheet visible={editingFolderId !== null} title="Folder" onClose={() => setEditingFolderId(null)}><ModalBody><Input label="Folder name" value={folderName} onChangeText={setFolderName} /><Text style={[typography.caption, { color: colors.textDim }]}>Parent folder</Text><Button label="Top level" variant={folderParentId === null ? "primary" : "secondary"} onPress={() => setFolderParentId(null)} />{tree.filter(({ folder }) => folder.id !== editingFolderId).map(({ folder, depth }) => <Button key={folder.id} label={`${"  ".repeat(depth)}${folder.name}`} variant={folderParentId === folder.id ? "primary" : "secondary"} onPress={() => setFolderParentId(folder.id)} />)}<Button label="Save folder" onPress={() => void saveFolder()} /></ModalBody></Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  list: { gap: spacing.md, paddingBottom: spacing.huge, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm, flexDirection: "row", alignItems: "center" },
  open: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  cover: { width: 64, height: 64, borderRadius: radii.md },
  grow: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { flexShrink: 1 },
  profileBadge: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  sheet: { gap: spacing.sm, paddingBottom: spacing.xl },
  imageChoice: { width: "100%", height: 120, borderRadius: radii.md },
});
