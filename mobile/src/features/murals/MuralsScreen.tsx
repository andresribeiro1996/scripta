import { useMemo, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { buildMuralPreset, buildTree, MURAL_PRESETS, type Mural } from "@scripta/shared";
import { Button, EmptyState, ErrorState, IconButton, Input, Menu, Screen, Sheet } from "../../ui";
import { radii, spacing, typography, useTheme } from "../../ui/theme";
import { fetchGalleryImages } from "../gallery/api";
import { useLibrary } from "../library/hooks/useLibrary";
import { ShareActions } from "../socials";
import { useMuralFolders, useMurals } from "./useMurals";

export function MuralsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const murals = useMurals();
  const folders = useMuralFolders();
  const { data: library } = useLibrary();
  const gallery = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });
  const [folderId, setFolderId] = useState<string | null | undefined>(undefined);
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

  async function saveFolder() {
    if (!editingFolder) return;
    try {
      await folders.update(editingFolder.id, { name: folderName.trim() || editingFolder.name, parentId: folderParentId });
      setEditingFolderId(null);
    } catch (reason) {
      Alert.alert(reason instanceof Error ? reason.message : "Couldn't update that folder.");
    }
  }

  if (murals.isError) return <ErrorState body={murals.error.message} actionLabel="Retry" onAction={() => void murals.refetch()} />;
  return (
    <Screen style={styles.screen}>
      <View style={styles.header}><Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Murals</Text><Button label="Presets" variant="secondary" onPress={() => setPresets(true)} /><Button label="New mural" onPress={() => void murals.create("Untitled mural", folderId ?? null).then((mural) => router.push(`/murals/${mural.id}` as never))} /></View>
      <Input label="Search murals" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
      <ScrollView horizontal contentContainerStyle={styles.folders}><Button label="All" variant={folderId === undefined ? "primary" : "secondary"} onPress={() => setFolderId(undefined)} /><Button label="Unfiled" variant={folderId === null ? "primary" : "secondary"} onPress={() => setFolderId(null)} />{tree.map(({ folder, depth }) => <Button key={folder.id} label={`${"  ".repeat(depth)}${folder.name}`} variant={folderId === folder.id ? "primary" : "secondary"} onPress={() => setFolderId(folder.id)} />)}<Button label="New folder" variant="secondary" onPress={() => void folders.create("New folder", folderId ?? null).then((folder) => { setEditingFolderId(folder.id); setFolderName(folder.name); setFolderParentId(folder.parentId); })} />{typeof folderId === "string" ? <><Button label="Edit folder" variant="secondary" onPress={() => editFolder(folderId)} /><Button label="Delete folder" variant="destructive" onPress={() => Alert.alert("Delete folder?", "Murals and subfolders move up one level.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void folders.remove(folderId).then(() => setFolderId(undefined)) }])} /></> : null}</ScrollView>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={murals.isRefetching}
        onRefresh={() => void murals.refetch()}
        ListEmptyComponent={!murals.isPending ? <EmptyState title={search ? "Nothing matches" : "No murals here"} body="Create a freeform mural or start from a preset." /> : null}
        renderItem={({ item }) => <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable accessibilityLabel={`Open ${item.name}`} accessibilityRole="button" style={styles.open} onPress={() => router.push(`/murals/${item.id}` as never)}>{item.coverImageUrl ? <Image source={{ uri: item.coverImageUrl }} style={styles.cover} contentFit="cover" /> : null}<View style={styles.grow}><Text style={[typography.title, { color: colors.text, fontWeight: "700" }]}>{item.name}</Text><Text style={[typography.caption, { color: colors.textDim }]}>{item.blocks.length} blocks</Text></View></Pressable>
          <Menu
            title={item.name}
            items={[
              { label: "Move to folder…", onPress: () => setMoveFor(item) },
              { label: "Change cover…", onPress: () => setCoverFor(item) },
              { label: "Share…", onPress: () => setShareFor(item) },
              { label: "Delete", destructive: true, onPress: () => confirmDelete(item) },
            ]}
          >
            <IconButton accessibilityLabel={`Actions for ${item.name}`} name="ellipsis-horizontal" />
          </Menu>
        </View>}
      />
      <Sheet visible={presets} title="Start with a preset" onClose={() => setPresets(false)}><View style={styles.sheet}>{MURAL_PRESETS.map((preset) => <Button key={preset.id} label={preset.name} variant="secondary" onPress={() => void createFromPreset(preset.id)} />)}</View></Sheet>
      <Sheet visible={coverFor !== null} title="Mural cover" onClose={() => setCoverFor(null)}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>{coverFor?.coverImageId ? <Button label="Remove cover" variant="destructive" onPress={() => void murals.clearCover(coverFor.id).then(() => setCoverFor(null))} /> : null}{(gallery.data ?? []).map((image) => <Pressable accessibilityLabel={`Use ${image.filename} as mural cover`} accessibilityRole="button" key={image.id} onPress={() => void murals.setCover(coverFor!.id, image.id, image.url).then(() => setCoverFor(null))}><Image source={{ uri: image.url }} style={styles.imageChoice} /></Pressable>)}</ScrollView></Sheet>
      <Sheet visible={shareFor !== null} title="Share mural" onClose={() => setShareFor(null)}><View style={styles.sheet}>{shareFor?.shareUrl ? <><ShareActions message={shareFor.shareUrl} title={shareFor.name} /><Button label="Stop sharing" variant="destructive" onPress={() => void murals.unshare(shareFor.id).then(() => setShareFor(null))} /></> : <Button label="Create share link" onPress={() => void murals.share(shareFor!.id).then(setShareFor)} />}</View></Sheet>
      <Sheet visible={moveFor !== null} title="Move mural" onClose={() => setMoveFor(null)}><View style={styles.sheet}><Button label="Unfiled" variant="secondary" onPress={() => void murals.update(moveFor!.id, { folderId: null }).then(() => setMoveFor(null))} />{tree.map(({ folder, depth }) => <Button key={folder.id} label={`${"  ".repeat(depth)}${folder.name}`} variant="secondary" onPress={() => void murals.update(moveFor!.id, { folderId: folder.id }).then(() => setMoveFor(null))} />)}</View></Sheet>
      <Sheet visible={editingFolderId !== null} title="Edit folder" onClose={() => setEditingFolderId(null)}><View style={styles.sheet}><Input label="Folder name" value={folderName} onChangeText={setFolderName} /><Text style={[typography.caption, { color: colors.textDim }]}>Parent folder</Text><Button label="Top level" variant={folderParentId === null ? "primary" : "secondary"} onPress={() => setFolderParentId(null)} />{tree.filter(({ folder }) => folder.id !== editingFolderId).map(({ folder, depth }) => <Button key={folder.id} label={`${"  ".repeat(depth)}${folder.name}`} variant={folderParentId === folder.id ? "primary" : "secondary"} onPress={() => setFolderParentId(folder.id)} />)}<Button label="Save folder" onPress={() => void saveFolder()} /></View></Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { ...typography.heading, fontWeight: "700", flex: 1 },
  folders: { gap: spacing.sm },
  list: { gap: spacing.md, paddingBottom: spacing.huge },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm, flexDirection: "row", alignItems: "center" },
  open: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  cover: { width: 64, height: 64, borderRadius: radii.md },
  grow: { flex: 1 },
  sheet: { gap: spacing.sm, paddingBottom: spacing.xl },
  imageChoice: { width: "100%", height: 120, borderRadius: radii.md },
});
