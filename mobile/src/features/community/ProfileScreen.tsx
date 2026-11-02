import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useAuth } from "../../core/auth";
import { Text } from "../../ui/Text";
import { followFailureMessage } from "@scripta/shared/community";
import { ensureBookBlockHeights, readerCardInputOf, type Mural } from "@scripta/shared";
import { Button, Dialog, EmptyState, ErrorState, Icon, IconButton, Screen, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { MuralCanvas } from "../murals";
import { useMurals } from "../murals/useMurals";
import { reconstructBooks, reconstructTierlists } from "../public/adapters";
import { useLibrarySection } from "../public/PublicLibraryGrid";
import type { GalleryImage } from "../gallery/api";
import { ProfileCardBackdrop, ProfileCardHero, ProfileHeroIdentity } from "../readerCard/ProfileCardHero";
import { DailyChapterProfileSection } from "../dailyChapter/daily-chapter-profile-section";
import { useActivitySection } from "./ActivityList";
import { AuthorAvatar } from "./AuthorAvatar";
import { fetchProfile, fetchProfileLibrary, followUser, unfollowUser, type CommunityProfileView } from "./api";
import { contentDetail, contentKindLabel, contentTarget } from "./communityHome";
import { ProfileScroller, elementSection, transparentHeader, usePlainHeader, type ProfileSection } from "./ProfileScroller";
import { useLocale, useT, type MessageKey } from "../../i18n";
import type { Locale } from "@scripta/shared/i18n";

export function ProfileScreen({ username }: { username: string }) {
  const locale = useLocale();
  const t = useT();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const plainHeader = usePlainHeader();
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
  const cardInput = useMemo(() => (view && !view.private && view.readerCard ? readerCardInputOf([], [], view.profile.user.username, locale, view.readerCard) : null), [view, locale]);
  const library = useQuery({
    queryKey: ["community", "profile-library", username],
    queryFn: () => fetchProfileLibrary(username),
    enabled: profile.isSuccess,
    retry: false,
  });
  const activitySection = useActivitySection(username);
  const librarySection = useLibrarySection(library.data?.data ?? null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["community", "profile", username] });
    } catch (reason) {
      setError(followFailureMessage(reason, t("community.somethingWentWrongRetry")));
    } finally {
      setBusy(false);
    }
  }

  async function toggleFollow() {
    if (!view) return;
    await run(async () => {
      if (view.profile.viewerFollows) await unfollowUser(view.profile.user.userId);
      else await followUser(view.profile.user.userId);
      await queryClient.invalidateQueries({ queryKey: ["community", "people"] });
    });
  }

  if (profile.isPending) {
    return (
      <Centered>
        <Stack.Screen options={{ headerShown: true, title: username, ...plainHeader }} />
        <Skeleton height={180} />
      </Centered>
    );
  }

  if (profile.isError) {
    return (
      <Centered>
        <Stack.Screen options={{ headerShown: true, title: username, ...plainHeader }} />
        <EmptyState title={t("community.profilePrivate")} body={t("community.profilePrivateBody")} />
      </Centered>
    );
  }

  if (view!.private) {
    return (
      <Centered>
        <Stack.Screen options={{ headerShown: true, title: view!.profile.user.username, ...plainHeader }} />
        <View style={styles.privateAvatar}>
          <AuthorAvatar username={view!.profile.user.username} avatarUrl={view!.profile.user.avatarUrl} size={72} />
        </View>
        <EmptyState title={t("community.profilePrivate")} />
      </Centered>
    );
  }

  const mural: Mural | null = muralData
    ? {
        id: muralData.mural.id,
        name: muralData.mural.name,
        theme: muralData.mural.theme,
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
  const following = view!.profile.viewerFollows === true;
  const followLabel = following ? t("book.following") : t("book.follow");

  const heroBody = (
    <>
      <ProfileHeroIdentity username={profileUser.username} glyph={profileUser.readerGlyph} finished={cardInput?.card.facts?.finished} />
      {profileUser.userId !== user?.id ? (
        <IconButton framed name={following ? "confirm" : "follow"} tone={following ? "default" : "accent"} label={followLabel} accessibilityLabel={followLabel} disabled={busy} onPress={() => void toggleFollow()} />
      ) : null}
    </>
  );

  const published = publishedRows(view!, locale);
  const muralSection: ProfileSection = {
    ...elementSection([
      ...(mural && mural.blocks.length > 0
        ? [
            <View key="canvas" style={[styles.row, styles.lead]}>
              <MuralCanvas
                mural={mural}
                books={books}
                images={images}
                tierlists={tierlists}
                profile={profileUser}
                profileInHero
                shelfThemeOverride={muralData?.library.shelfTheme}
                statsOverride={muralData?.library.stats}
              />
            </View>,
          ]
        : []),
      <Text key="published" {...dynamicType} style={[typography.caption, styles.eyebrow, styles.row, styles.lead, { color: colors.textDim }]}>
        {t("community.published")}
      </Text>,
      ...(published.length === 0
        ? [<View key="nothing" style={styles.row}><EmptyState title={t("community.nothingPublishedTitle")} body={t("community.nothingPublishedProfileBody")} /></View>]
        : published.map((item) => (
            <View key={`${item.kind}:${item.id}`} style={styles.row}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t("community.openTitle", { title: item.name })}
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
            </View>
          ))),
    ]),
    refreshing: profile.isRefetching,
    onRefresh: () => void profile.refetch(),
  };

  function sectionFor(value: ProfileTab): ProfileSection {
    if (value === "activity") return activitySection;
    if (value === "daily") return elementSection([<DailyChapterProfileSection key="daily" userId={profileUser.userId} own={false} />]);
    if (value === "library") {
      if (library.isPending) return elementSection([<View key="pending" style={styles.page}><Skeleton height={180} /></View>]);
      if (library.isError) return elementSection([<View key="error" style={styles.page}><ErrorState body={t("community.profileLibraryLoadFailed")} actionLabel={t("shell.retry")} onAction={() => void library.refetch()} /></View>]);
      return librarySection.section;
    }
    return muralSection;
  }

  return (
    <Screen bottom top={false}>
      <Stack.Screen options={{ headerShown: true, ...transparentHeader }} />
      <ProfileScroller
        notice={error ? <Toast visible message={error} tone="error" /> : null}
        accessibilityLabel={t("community.profileSections")}
        hero={cardInput ? <ProfileCardHero input={cardInput} width={width} withBackdrop={false}>{heroBody}</ProfileCardHero> : <View style={styles.plainHero}>{heroBody}</View>}
        backdrop={cardInput ? <ProfileCardBackdrop input={cardInput} /> : null}
        tabs={PROFILE_TABS.map((entry) => ({ value: entry.value, label: t(entry.labelKey) }))}
        value={tab}
        onChange={setTab}
        section={sectionFor(tab)}
      />
      {librarySection.sheet}
    </Screen>
  );
}

const PROFILE_TABS = [
  { value: "mural", labelKey: "community.tabMural" },
  { value: "activity", labelKey: "community.activity" },
  { value: "library", labelKey: "shell.tabLibrary" },
  { value: "daily", labelKey: "community.tabDaily" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

type ProfileTab = (typeof PROFILE_TABS)[number]["value"];

type PublishedRow = { kind: "tierlist" | "tournament" | "quiz"; id: string; name: string; detail: string; target: string; label: string };

function publishedRows(view: CommunityProfileView, locale: Locale): PublishedRow[] {
  const rows: PublishedRow[] = [];
  for (const item of view.published.tierlists) {
    rows.push({ kind: "tierlist", id: item.id, name: item.name, detail: contentDetail(item, locale), target: contentTarget(item), label: contentKindLabel(item, locale) });
  }
  for (const item of view.published.tournaments) {
    rows.push({ kind: "tournament", id: item.id, name: item.name, detail: contentDetail(item, locale), target: contentTarget(item), label: contentKindLabel(item, locale) });
  }
  for (const item of view.published.quizzes) {
    rows.push({ kind: "quiz", id: item.id, name: item.name, detail: contentDetail(item, locale), target: contentTarget(item), label: contentKindLabel(item, locale) });
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
  const t = useT();
  const { colors, id: theme } = useTheme();
  const murals = useMurals();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const working = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) setCreateError(null);
  }, [visible]);
  const items = murals.data ?? [];
  const noMurals = murals.isSuccess && items.length === 0;

  async function createMural() {
    if (working.current) return;
    working.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      const mural = await murals.create(t("community.untitledMural"), theme);
      onClose();
      router.push(`/murals/${mural.id}` as never);
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : t("community.muralCreateFailed"));
    } finally {
      working.current = false;
      setCreating(false);
    }
  }
  return (
    <Dialog visible={visible} title={title} onClose={onClose}>
      <View style={styles.dialogGap}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
          {description}
        </Text>
        {error || createError ? <Toast visible message={(error ?? createError)!} tone="error" /> : null}
        {murals.isPending ? (
          <Skeleton height={120} />
        ) : noMurals ? (
          <EmptyState title={t("community.noMuralsTitle")} actionLabel={creating ? t("community.creating") : t("community.createMural")} onAction={() => void createMural()} />
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
        {noMurals ? null : (
          <Button
            label={actionLabel}
            disabled={!selected}
            loading={busy}
            onPress={() => selected && onPick(selected)}
          />
        )}
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  privateAvatar: { alignItems: "center" },
  centered: { flex: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  page: { padding: spacing.lg },
  row: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  lead: { paddingTop: spacing.lg },
  eyebrow: { fontWeight: "600" },
  plainHero: { alignItems: "center", gap: spacing.md, padding: spacing.lg },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radii.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  dialogGap: { gap: spacing.md },
  pickerList: { maxHeight: 240, flexGrow: 0 },
  pickerRow: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm },
});
