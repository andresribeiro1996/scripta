import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Dimensions, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Text } from "../../ui/Text";
import { Image } from "expo-image";
import { RNHostView } from "@expo/ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { buildMuralPreset, muralThemeId, MURAL_PRESETS, presetAvailability, type Mural, type MuralFolder, type MuralPresetId } from "@scripta/shared";
import { Button, dynamicType, EmptyState, ErrorState, Fab, Icon, IconButton, Input, Menu, minimumTouchTarget, ModalBody, Screen, Sheet, Toast } from "../../ui";
import { radii, spacing, typography, useTheme } from "../../ui/theme";
import { themes } from "@scripta/shared/themes";
import { MuralThumbnail } from "./MuralCanvas";
import { fetchGalleryImages } from "../gallery/api";
import { fetchTierlists } from "../tierlists/api";
import { useLibrary } from "../library/hooks/useLibrary";
import { API_URL } from "../../core/config";
import { useAuth } from "../../core/auth";
import { fetchOwnProfile } from "../community/api";
import { MuralShareSheet } from "./MuralShareSheet";
import { useMuralFolders, useMurals } from "./useMurals";
import { FolderSheet } from "./FolderSheet";

export function MuralsScreen() {
  const { colors, id: theme } = useTheme();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cardWidth = (width - spacing.lg * 2 - spacing.md) / 2;
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
  const frame = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);
  const [presets, setPresets] = useState(false);
  const pendingPreset = useRef<{ id: string; preset: MuralPresetId } | null>(null);
  const working = useRef(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [coverFor, setCoverFor] = useState<Mural | null>(null);
  const [shareFor, setShareFor] = useState<Mural | null>(null);
  const [moveFor, setMoveFor] = useState<Mural | null>(null);
  const [folderPicker, setFolderPicker] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null | undefined>(undefined);
  const [savingFolder, setSavingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const flatFolders = [...(folders.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const editingFolder = (folders.data ?? []).find((folder) => folder.id === editingFolderId);
  const activeFolder = typeof folderId === "string" ? (folders.data ?? []).find((folder) => folder.id === folderId) : undefined;
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (murals.data ?? []).filter((mural) => needle ? mural.name.toLowerCase().includes(needle) : folderId === undefined || mural.folderId === folderId).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [murals.data, folderId, search]);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) => {
      frame.current?.measureInWindow((_x, y, _width, height) => {
        setOverlap(Math.max(0, Math.min(height, y + height - (Dimensions.get("window").height - event.endCoordinates.height))));
      });
    });
    const hidden = Keyboard.addListener("keyboardDidHide", () => setOverlap(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  function openPresets() {
    setPresetError(null);
    setPresets(true);
  }

  async function createBlank() {
    if (working.current) return;
    working.current = true;
    setPresetError(null);
    try {
      const mural = await murals.create("Untitled mural", theme, folderId ?? null);
      setPresets(false);
      router.push(`/murals/${mural.id}` as never);
    } catch (reason) {
      setPresetError(reason instanceof Error ? reason.message : "Couldn't create the mural. Try again.");
    } finally {
      working.current = false;
    }
  }

  async function createFromPreset(id: MuralPresetId) {
    if (working.current) return;
    working.current = true;
    setPresetError(null);
    try {
      const preset = buildMuralPreset(id, libraryQuery.data?.data.books ?? [], libraryQuery.data?.data.groups ?? []);
      const target = pendingPreset.current?.preset === id ? pendingPreset.current : { id: (await murals.create(preset.name, theme, folderId ?? null)).id, preset: id };
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

  function selectFolder(id: string | null | undefined) {
    setSearch("");
    setFolderId(id);
    setFolderPicker(false);
  }

  function confirmDelete(mural: Mural) {
    Alert.alert(`Delete “${mural.name}”?`, "This can't be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void murals.remove(mural.id) }]);
  }

  function editFolder(id: string) {
    const folder = flatFolders.find((item) => item.id === id);
    if (!folder) return;
    setFolderPicker(false);
    setEditingFolderId(id);
    setFolderName(folder.name);
  }

  function newFolder() {
    setFolderPicker(false);
    setEditingFolderId(null);
    setFolderName("");
  }

  function confirmDeleteFolder(folder: MuralFolder) {
    Alert.alert(`Delete “${folder.name}”?`, "The murals stay in your library.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => {
      void folders.remove(folder.id).then(() => {
        if (folderId === folder.id) setFolderId(undefined);
      }).catch((reason: unknown) => Alert.alert(reason instanceof Error ? reason.message : "Couldn't delete that folder."));
    } }]);
  }

  async function saveFolder() {
    const name = folderName.trim();
    if (!name || savingFolder) return;
    setSavingFolder(true);
    try {
      if (editingFolderId === null) await folders.create(name, null);
      else if (editingFolderId !== undefined) await folders.update(editingFolderId, { name });
      Keyboard.dismiss();
      setEditingFolderId(undefined);
      setFolderPicker(true);
    } catch (reason) {
      Alert.alert(reason instanceof Error ? reason.message : "Couldn't save that folder.");
    } finally {
      setSavingFolder(false);
    }
  }

  const folderChoices = [
    { id: undefined, name: "All murals", count: (murals.data ?? []).length },
    { id: null, name: "Unfiled", count: (murals.data ?? []).filter((mural) => mural.folderId === null).length },
    ...flatFolders.map((folder) => ({ id: folder.id, name: folder.name, count: (murals.data ?? []).filter((mural) => mural.folderId === folder.id).length })),
  ];
  const folderLabel = search.trim() ? "All folders" : folderId === undefined ? "Folders" : folderId === null ? "Unfiled" : activeFolder?.name ?? "Folders";

  if (murals.isError) return <ErrorState body={murals.error.message} actionLabel="Retry" onAction={() => void murals.refetch()} />;
  return (
    <Screen top={false} style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Murals",
          headerTitle: () => <View><Text {...dynamicType} style={[typography.title, { color: colors.text }]}>Murals</Text>{folderId !== undefined && !search.trim() ? <Text {...dynamicType} numberOfLines={1} style={[typography.caption, { color: colors.textDim }]}>{folderLabel}</Text> : null}</View>,
        }}
      />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.grow}>
        <View ref={frame} style={styles.grow}>
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.columns}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshing={murals.isRefetching}
            onRefresh={() => void murals.refetch()}
            ListEmptyComponent={!murals.isPending ? <EmptyState title={search ? "Nothing matches" : "No murals here"} body={search ? "Search covers every folder — nothing in your murals matches this." : "Create a freeform mural or start from a preset."} actionLabel={search ? "Clear search" : "Start from a preset"} onAction={search ? clearSearch : openPresets} /> : null}
            renderItem={({ item }) => {
              const muralTheme = muralThemeId(item.theme);
              const palette = themes[muralTheme].colors;
              return (
                <View style={[styles.card, { width: cardWidth, backgroundColor: palette.background, borderColor: palette.border }]}>
                  <Pressable accessibilityLabel={`Open ${item.name}`} accessibilityRole="button" style={({ pressed }) => [styles.open, { opacity: pressed ? 0.75 : 1 }]} onPress={() => router.push(`/murals/${item.id}` as never)}>
                    <View style={[styles.preview, { backgroundColor: palette.background }]}>
                      <View style={styles.previewContent}>
                        {item.coverImageUrl ? <Image source={{ uri: item.coverImageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : item.blocks.length ? <MuralThumbnail mural={item} canvasWidth={width - spacing.sm * 2} books={library?.data.books ?? []} groups={library?.data.groups ?? []} images={gallery.data ?? []} tierlists={tierlists.data ?? []} profile={user?.username ? { username: user.username, avatarUrl: user.avatarId ? `${API_URL}/auth/avatar/${user.avatarId}/file` : null } : undefined} /> : <Icon name="murals" size={48} color={palette.accent} />}
                      </View>
                      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.fade, { height: cardWidth / 3 }]}>
                        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
                          <Defs><LinearGradient id="muralFade" x1="0" y1="1" x2="0" y2="0">
                            <Stop offset="0" stopColor="#0a0806" stopOpacity={0.78} />
                            <Stop offset="0.25" stopColor="#0a0806" stopOpacity={0.73} />
                            <Stop offset="0.5" stopColor="#0a0806" stopOpacity={0.58} />
                            <Stop offset="0.75" stopColor="#0a0806" stopOpacity={0.33} />
                            <Stop offset="1" stopColor="#0a0806" stopOpacity={0} />
                          </LinearGradient></Defs>
                          <Rect width="1" height="1" fill="url(#muralFade)" />
                        </Svg>
                      </View>
                      {ownProfile.data?.muralId === item.id ? <View pointerEvents="none" style={[styles.profileBadge, { backgroundColor: colors.surface }]}><Text numberOfLines={1} style={[typography.caption, { color: colors.accent }]}>My shelf</Text></View> : null}
                      <View style={styles.caption} pointerEvents="none">
                        <Text {...dynamicType} numberOfLines={2} style={[typography.body, styles.title]}>{item.name}</Text>
                      </View>
                    </View>
                  </Pressable>
                  <View style={styles.menu}>
                    <Menu
                      title={item.name}
                      items={[
                        { label: "Move to folder…", onPress: () => setMoveFor(item) },
                        { label: "Change cover…", onPress: () => setCoverFor(item) },
                        { label: "Share…", onPress: () => setShareFor(item) },
                        { label: "Delete", destructive: true, onPress: () => confirmDelete(item) },
                      ]}
                    >
                      <View accessible accessibilityRole="button" accessibilityLabel={`Settings for ${item.name}`} style={[styles.menuIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}><Icon name="settings" size={16} color={colors.textDim} /></View>
                    </Menu>
                  </View>
                </View>
              );
            }}
          />
          <View pointerEvents="box-none" style={[styles.fabArea, { bottom: minimumTouchTarget + spacing.md * 2 + overlap }]}>
            <Fab label="New" accessibilityLabel="New mural" onPress={openPresets} />
          </View>
          <View style={[styles.searchRow, { bottom: overlap }]}>
            <View style={styles.grow}><Input icon="search" accessibilityLabel="Search murals" value={search} onChangeText={setSearch} placeholder="Search murals" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" style={styles.searchField} /></View>
            <IconButton name="folder" accessibilityLabel={`Folders, ${folderLabel}`} framed tone={folderId === undefined || search.trim() ? "default" : "accent"} onPress={() => { Keyboard.dismiss(); setFolderPicker(true); }} />
          </View>
        </View>
      </KeyboardAvoidingView>
      <Sheet visible={presets} title="New mural" onClose={() => setPresets(false)}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
          {presetError ? <Toast visible message={presetError} tone="error" /> : null}
          <Button label="Blank mural" onPress={() => void createBlank()} />
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
        </ScrollView>
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
      <FolderSheet visible={folderPicker} onClose={() => setFolderPicker(false)}>
        <RNHostView matchContents={Platform.OS === "android" ? true : undefined}>
          <View style={{ width, height: Platform.OS === "android" ? height * 0.7 - spacing.huge : 0, flexGrow: Platform.OS === "android" ? 0 : 1, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: Math.max(insets.bottom, spacing.lg), gap: spacing.md }}>
            <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>Folders</Text>
            <ScrollView style={styles.grow} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.folderList}>
              {folders.isError ? <ErrorState body={folders.error.message} actionLabel="Retry" onAction={() => void folders.refetch()} /> : folderChoices.map((choice) => {
                const selected = search.trim() ? choice.id === undefined : folderId === choice.id;
                const folder = typeof choice.id === "string" ? flatFolders.find((item) => item.id === choice.id) : undefined;
                return (
                  <View key={choice.id ?? choice.name} style={[styles.folderRow, { backgroundColor: selected ? colors.accentSoft : "transparent" }]}>
                    <Pressable accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${choice.name}, ${choice.count} ${choice.count === 1 ? "mural" : "murals"}`} onPress={() => selectFolder(choice.id)} style={styles.folderChoice}>
                      <Icon name={choice.id === undefined ? "murals" : "folder"} size={20} color={selected ? colors.accent : colors.textDim} />
                      <Text {...dynamicType} numberOfLines={1} style={[typography.body, styles.grow, { color: colors.text, fontWeight: selected ? "700" : "400" }]}>{choice.name}</Text>
                      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{choice.count}</Text>
                      {selected ? <Icon name="confirm" size={18} color={colors.accent} /> : null}
                    </Pressable>
                    {folder ? <Menu title={folder.name} items={[{ label: "Rename folder…", onPress: () => editFolder(folder.id) }, { label: "Delete folder", destructive: true, onPress: () => confirmDeleteFolder(folder) }]}><View accessible accessibilityRole="button" accessibilityLabel={`Settings for ${folder.name}`}><Icon name="settings" size={18} color={colors.textDim} /></View></Menu> : null}
                  </View>
                );
              })}
            </ScrollView>
            <Button label="New folder" variant="secondary" onPress={newFolder} />
          </View>
        </RNHostView>
      </FolderSheet>
      <Sheet visible={moveFor !== null} title="Move mural" onClose={() => setMoveFor(null)}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}><Button label="Unfiled" variant={moveFor?.folderId === null ? "primary" : "secondary"} onPress={() => void murals.update(moveFor!.id, { folderId: null }).then(() => setMoveFor(null))} />{flatFolders.map((folder) => <Button key={folder.id} label={folder.name} variant={moveFor?.folderId === folder.id ? "primary" : "secondary"} onPress={() => void murals.update(moveFor!.id, { folderId: folder.id }).then(() => setMoveFor(null))} />)}</ScrollView></Sheet>
      <Sheet visible={editingFolderId !== undefined} title={editingFolder ? "Rename folder" : "New folder"} onClose={() => setEditingFolderId(undefined)}><ModalBody><Input label="Folder name" value={folderName} onChangeText={setFolderName} placeholder="e.g. Reading lists" autoCapitalize="sentences" returnKeyType="done" /><Button label={editingFolder ? "Save name" : "Create folder"} disabled={!folderName.trim()} loading={savingFolder} onPress={() => void saveFolder()} /></ModalBody></Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 0 },
  grow: { flex: 1 },
  list: { padding: spacing.lg, gap: spacing.lg, paddingBottom: minimumTouchTarget + spacing.md * 2 + spacing.huge * 2, flexGrow: 1 },
  columns: { gap: spacing.md },
  fabArea: { position: "absolute", top: 0, left: 0, right: 0 },
  searchRow: { position: "absolute", left: 0, right: 0, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  searchField: { borderRadius: radii.full },
  folderList: { gap: spacing.xs, paddingBottom: spacing.lg },
  folderRow: { flexDirection: "row", alignItems: "center", borderRadius: radii.lg },
  folderChoice: { flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, overflow: "hidden", boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)" },
  open: { flex: 1 },
  preview: { aspectRatio: 1 },
  previewContent: { position: "absolute", top: spacing.md, right: spacing.md, bottom: spacing.md, left: spacing.md, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  fade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  caption: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  title: { color: "#ffffff", fontWeight: "700", textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  menu: { position: "absolute", top: 0, left: spacing.xs },
  menuIcon: { width: 24, height: 24, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", borderRadius: radii.full },
  profileBadge: { position: "absolute", top: spacing.md, right: spacing.sm, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  sheet: { gap: spacing.sm, paddingBottom: spacing.xl },
  presetRow: { gap: spacing.xs },
  imageChoice: { width: "100%", height: 120, borderRadius: radii.md },
});
