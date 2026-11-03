import { useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type HostInstance } from "react-native";
import { Text } from "../../ui/Text";
import { Image } from "expo-image";
import { RNHostView } from "@expo/ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { buildMuralPreset, muralColors, muralThemeId, muralPresets, presetAvailability, type Mural, type MuralFolder, type MuralPresetId } from "@scripta/shared";
import { ActionSheet, Button, ConfirmDialog, dynamicType, EmptyState, ErrorState, Fab, Icon, IconButton, Input, minimumTouchTarget, ModalBody, Screen, Sheet, Toast } from "../../ui";
import { radii, spacing, typography, useTheme } from "../../ui/theme";
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
import { useLocale, useT } from "../../i18n";

export function MuralsScreen() {
  const locale = useLocale();
  const t = useT();
  const { colors, id: theme, mode } = useTheme();
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
  const frame = useRef<HostInstance>(null);
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
  const [deletingMural, setDeletingMural] = useState<Mural | null>(null);
  const [deletingMuralBusy, setDeletingMuralBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<MuralFolder | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
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
      const mural = await murals.create(t("murals.untitledMural"), theme, folderId ?? null);
      setPresets(false);
      router.push(`/murals/${mural.id}` as never);
    } catch (reason) {
      setPresetError(reason instanceof Error ? reason.message : t("murals.createFailed"));
    } finally {
      working.current = false;
    }
  }

  async function createFromPreset(id: MuralPresetId) {
    if (working.current) return;
    working.current = true;
    setPresetError(null);
    try {
      const preset = buildMuralPreset(id, libraryQuery.data?.data.books ?? [], locale, libraryQuery.data?.data.groups ?? []);
      const target = pendingPreset.current?.preset === id ? pendingPreset.current : { id: (await murals.create(preset.name, theme, folderId ?? null)).id, preset: id };
      pendingPreset.current = target;
      const updated = await murals.update(target.id, { blocks: preset.blocks });
      pendingPreset.current = null;
      setPresets(false);
      router.push(`/murals/${updated.id}` as never);
    } catch (reason) {
      setPresetError(reason instanceof Error ? reason.message : t("murals.createFailed"));
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

  async function deleteMural(mural: Mural) {
    setDeletingMuralBusy(true);
    try {
      await murals.remove(mural.id);
      setDeletingMural(null);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : t("murals.deleteFailed"));
    } finally {
      setDeletingMuralBusy(false);
    }
  }

  function editFolder(id: string) {
    const folder = flatFolders.find((item) => item.id === id);
    if (!folder) return;
    setFolderPicker(false);
    setFolderError(null);
    setEditingFolderId(id);
    setFolderName(folder.name);
  }

  function newFolder() {
    setFolderPicker(false);
    setFolderError(null);
    setEditingFolderId(null);
    setFolderName("");
  }

  function deleteFolder(folder: MuralFolder) {
    setDeletingFolder(null);
    setFolderError(null);
    void folders.remove(folder.id).then(() => {
      if (folderId === folder.id) setFolderId(undefined);
    }).catch((reason: unknown) => setFolderError(reason instanceof Error ? reason.message : t("murals.deleteFolderFailed")));
  }

  async function saveFolder() {
    const name = folderName.trim();
    if (!name || savingFolder) return;
    setFolderError(null);
    setSavingFolder(true);
    try {
      if (editingFolderId === null) await folders.create(name, null);
      else if (editingFolderId !== undefined) await folders.update(editingFolderId, { name });
      Keyboard.dismiss();
      setEditingFolderId(undefined);
      setFolderPicker(true);
    } catch (reason) {
      setFolderError(reason instanceof Error ? reason.message : t("murals.saveFolderFailed"));
    } finally {
      setSavingFolder(false);
    }
  }

  const folderChoices = [
    { id: undefined, name: t("murals.allMurals"), count: (murals.data ?? []).length },
    { id: null, name: t("murals.unfiled"), count: (murals.data ?? []).filter((mural) => mural.folderId === null).length },
    ...flatFolders.map((folder) => ({ id: folder.id, name: folder.name, count: (murals.data ?? []).filter((mural) => mural.folderId === folder.id).length })),
  ];
  const folderLabel = search.trim() ? t("murals.allFolders") : folderId === undefined ? t("murals.folders") : folderId === null ? t("murals.unfiled") : activeFolder?.name ?? t("murals.folders");

  if (murals.isError) return <ErrorState body={murals.error.message} actionLabel={t("shell.retry")} onAction={() => void murals.refetch()} />;
  return (
    <Screen top={false} style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("shell.youMurals"),
          headerTitle: () => <View><Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{t("shell.youMurals")}</Text>{folderId !== undefined && !search.trim() ? <Text {...dynamicType} numberOfLines={1} style={[typography.caption, { color: colors.textDim }]}>{folderLabel}</Text> : null}</View>,
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
            ListEmptyComponent={!murals.isPending ? <EmptyState title={search ? t("arena.nothingMatches") : t("murals.noMuralsHere")} body={search ? t("murals.searchEmptyBody") : t("murals.emptyBody")} actionLabel={search ? t("shell.clearSearch") : t("murals.startFromPreset")} onAction={search ? clearSearch : openPresets} /> : undefined}
            renderItem={({ item }) => {
              const muralTheme = muralThemeId(item.theme);
              const palette = muralColors(muralTheme, mode);
              return (
                <View style={[styles.card, { width: cardWidth, backgroundColor: palette.background, borderColor: palette.border }]}>
                  <Pressable accessibilityLabel={t("murals.openMural", { name: item.name })} accessibilityRole="button" style={({ pressed }) => [styles.open, { opacity: pressed ? 0.75 : 1 }]} onPress={() => router.push(`/murals/${item.id}` as never)}>
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
                      {ownProfile.data?.muralId === item.id ? <View pointerEvents="none" style={[styles.profileBadge, { backgroundColor: colors.surface }]}><Text numberOfLines={1} style={[typography.caption, { color: colors.accent }]}>{t("community.myShelf")}</Text></View> : null}
                      <View style={styles.caption} pointerEvents="none">
                        <Text {...dynamicType} numberOfLines={2} style={[typography.body, styles.title]}>{item.name}</Text>
                      </View>
                    </View>
                  </Pressable>
                  <View style={styles.menu}>
                    <ActionSheet
                      title={item.name}
                      groups={[
                        [
                          { label: t("murals.moveToFolder"), icon: "folder", onPress: () => setMoveFor(item) },
                          { label: t("book.changeCover"), icon: "image", onPress: () => setCoverFor(item) },
                        ],
                        [{ label: t("library.share"), icon: "share", onPress: () => setShareFor(item) }],
                        [{ label: t("library.delete"), icon: "delete", destructive: true, onPress: () => { setDeleteError(null); setDeletingMural(item); } }],
                      ]}
                    >
                      {(open) => <Pressable accessibilityRole="button" accessibilityLabel={t("murals.settingsFor", { name: item.name })} hitSlop={10} onPress={open} style={[styles.menuIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}><Icon name="settings" size={16} color={colors.textDim} /></Pressable>}
                    </ActionSheet>
                  </View>
                </View>
              );
            }}
          />
          <View pointerEvents="box-none" style={[styles.fabArea, { bottom: minimumTouchTarget + spacing.md * 2 + overlap }]}>
            <Fab label={t("murals.new")} accessibilityLabel={t("murals.newMural")} onPress={openPresets} />
          </View>
          <View style={[styles.searchRow, { bottom: overlap }]}>
            <View style={styles.grow}><Input icon="search" accessibilityLabel={t("murals.searchMurals")} value={search} onChangeText={setSearch} placeholder={t("murals.searchMurals")} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={styles.searchField} /></View>
            <IconButton name="folder" accessibilityLabel={t("murals.foldersLabel", { label: folderLabel })} tone={folderId === undefined || search.trim() ? "default" : "accent"} onPress={() => { Keyboard.dismiss(); setFolderPicker(true); }} />
          </View>
        </View>
      </KeyboardAvoidingView>
      <Sheet visible={presets} title={t("murals.newMural")} onClose={() => setPresets(false)}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
          {presetError ? <Toast visible message={presetError} tone="error" /> : null}
          <Button label={t("murals.blankMural")} onPress={() => void createBlank()} />
          {libraryQuery.isError ? <><Toast visible message={t("shell.libraryLoadFailed")} tone="error" /><Button label={t("shell.retry")} variant="secondary" onPress={() => void libraryQuery.refetch()} /></> : null}
          {muralPresets(locale).map((preset) => {
            const reason = libraryQuery.isPending ? t("murals.loadingLibrary") : libraryQuery.isError ? undefined : presetAvailability(preset.id, libraryQuery.data?.data.books ?? [], locale);
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
      <Sheet visible={coverFor !== null} title={t("murals.muralCover")} onClose={() => setCoverFor(null)}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>{coverFor?.coverImageId ? <Button label={t("murals.removeCover")} variant="destructive" onPress={() => void murals.clearCover(coverFor.id).then(() => setCoverFor(null))} /> : null}{(gallery.data ?? []).map((image) => <Pressable accessibilityLabel={t("murals.useAsCover", { filename: image.filename })} accessibilityRole="button" key={image.id} onPress={() => void murals.setCover(coverFor!.id, image.id, image.url).then(() => setCoverFor(null))}><Image source={{ uri: image.url }} style={styles.imageChoice} /></Pressable>)}</ScrollView></Sheet>
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
            <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{t("murals.folders")}</Text>
            <ScrollView style={styles.grow} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.folderList}>
              {folders.isError ? <ErrorState body={folders.error.message} actionLabel={t("shell.retry")} onAction={() => void folders.refetch()} /> : folderChoices.map((choice) => {
                const selected = search.trim() ? choice.id === undefined : folderId === choice.id;
                const folder = typeof choice.id === "string" ? flatFolders.find((item) => item.id === choice.id) : undefined;
                return (
                  <View key={choice.id ?? choice.name} style={[styles.folderRow, { backgroundColor: selected ? colors.accentSoft : "transparent" }]}>
                    <Pressable accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={t("murals.folderChoice", { name: choice.name, count: choice.count })} onPress={() => selectFolder(choice.id)} style={styles.folderChoice}>
                      <Icon name={choice.id === undefined ? "murals" : "folder"} size={20} color={selected ? colors.accent : colors.textDim} />
                      <Text {...dynamicType} numberOfLines={1} style={[typography.body, styles.grow, { color: colors.text, fontWeight: selected ? "700" : "400" }]}>{choice.name}</Text>
                      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{choice.count}</Text>
                      {selected ? <Icon name="confirm" size={18} color={colors.accent} /> : null}
                    </Pressable>
                    {folder ? <ActionSheet title={folder.name} groups={[[{ label: t("murals.renameFolder"), icon: "edit", onPress: () => editFolder(folder.id) }], [{ label: t("murals.deleteFolder"), icon: "delete", destructive: true, onPress: () => setDeletingFolder(folder) }]]}>{(open) => <Pressable accessibilityRole="button" accessibilityLabel={t("murals.settingsFor", { name: folder.name })} hitSlop={15} onPress={open}><Icon name="settings" size={18} color={colors.textDim} /></Pressable>}</ActionSheet> : null}
                  </View>
                );
              })}
            </ScrollView>
            {folderError ? <Text accessibilityRole="alert" {...dynamicType} style={[typography.caption, { color: colors.danger }]}>{folderError}</Text> : null}
            <Button label={t("murals.newFolder")} variant="secondary" onPress={newFolder} />
          </View>
        </RNHostView>
      </FolderSheet>
      <Sheet visible={moveFor !== null} title={t("murals.moveMural")} onClose={() => setMoveFor(null)}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}><Button label={t("murals.unfiled")} variant={moveFor?.folderId === null ? "primary" : "secondary"} onPress={() => void murals.update(moveFor!.id, { folderId: null }).then(() => setMoveFor(null))} />{flatFolders.map((folder) => <Button key={folder.id} label={folder.name} variant={moveFor?.folderId === folder.id ? "primary" : "secondary"} onPress={() => void murals.update(moveFor!.id, { folderId: folder.id }).then(() => setMoveFor(null))} />)}</ScrollView></Sheet>
      <Sheet visible={editingFolderId !== undefined} title={editingFolder ? t("murals.renameFolder") : t("murals.newFolder")} onClose={() => setEditingFolderId(undefined)}><ModalBody><Input label={t("murals.folderName")} value={folderName} onChangeText={setFolderName} placeholder={t("murals.folderNamePlaceholder")} autoCapitalize="sentences" returnKeyType="done" />{folderError ? <Text accessibilityRole="alert" {...dynamicType} style={[typography.caption, { color: colors.danger }]}>{folderError}</Text> : null}<Button label={editingFolder ? t("arena.saveName") : t("murals.createFolder")} disabled={!folderName.trim()} loading={savingFolder} onPress={() => void saveFolder()} /></ModalBody></Sheet>
      <ConfirmDialog
        visible={deletingMural !== null}
        title={t("murals.deleteTitle", { name: deletingMural?.name ?? "" })}
        body={[deletingMural?.shareToken ? t("murals.deleteSharedBody") : t("murals.deleteBody"), deleteError].filter(Boolean).join("\n\n")}
        confirmLabel={t("library.delete")}
        destructive
        loading={deletingMuralBusy}
        onConfirm={() => deletingMural && void deleteMural(deletingMural)}
        onCancel={() => setDeletingMural(null)}
      />
      <ConfirmDialog
        visible={deletingFolder !== null}
        title={t("murals.deleteTitle", { name: deletingFolder?.name ?? "" })}
        body={t("murals.deleteFolderBody")}
        confirmLabel={t("library.delete")}
        destructive
        onConfirm={() => deletingFolder && deleteFolder(deletingFolder)}
        onCancel={() => setDeletingFolder(null)}
      />
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
