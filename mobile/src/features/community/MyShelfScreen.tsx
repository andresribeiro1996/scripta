import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../../ui/Text";
import { buildMuralPreset, ensureBookBlockHeights, orderLibraryBooks, ownProfileCard, readerCardInputOf, shelfPresetSummary, type Mural } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { API_URL } from "../../core/config";
import { ActionSheet, Button, Dialog, dynamicType, EmptyState, ErrorState, HeaderActions, IconButton, Screen, Skeleton, spacing, Toast, typography, useTheme, type ActionItem } from "../../ui";
import { fetchGalleryImages } from "../gallery/api";
import { useLibrary } from "../library/hooks/useLibrary";
import { MuralCanvas } from "../murals";
import { NO_GROUPS } from "../murals/MuralCanvas";
import { PLATE_RATIO, ReaderCardImage } from "../murals/ReaderCardImage";
import { fetchMural } from "../murals/api";
import { useMurals } from "../murals/useMurals";
import { ProfileCardBackdrop, ProfileCardHero, ProfileCardSkeleton, ProfileHeroIdentity } from "../readerCard/ProfileCardHero";
import { useOwnCardStyle, useReaderCardStyle } from "../readerCard/useReaderCardStyle";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import { fetchTierlists } from "../tierlists/api";
import { DailyChapterProfileSection } from "../dailyChapter/daily-chapter-profile-section";
import { useActivitySection } from "./ActivityList";
import { FeedSettingsDialog } from "./FeedSettingsDialog";
import { ProfileScroller, elementSection, transparentHeader, usePlainHeader, type ProfileSection } from "./ProfileScroller";
import { ShelfPreview } from "./ShelfPreview";
import { fetchCardShare, fetchOwnProfile, publishProfile, setShelfMural, shareCard, unpublishProfile, unshareCard } from "./api";
import { MuralPicker } from "./ProfileScreen";
import { useLocale, useT, type MessageKey } from "../../i18n";

const MY_SHELF_TABS = [
  { value: "shelf", labelKey: "community.tabShelf" },
  { value: "activity", labelKey: "community.activity" },
  { value: "daily", labelKey: "community.tabDaily" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

type MyShelfTab = (typeof MY_SHELF_TABS)[number]["value"];

let lastTab: MyShelfTab = "shelf";

const CARD_SHARE_KEY = ["community", "card-share"] as const;
const NO_BOOKS: Array<Record<string, unknown>> = [];
const SHARE_CARD_WIDTH = 300;
const SHARE_SHEET_CHROME_HEIGHT = 400;
const SHARE_SHEET_CHROME_WIDTH = 72;

export function MyShelfScreen() {
  const locale = useLocale();
  const t = useT();
  const { colors, id: theme } = useTheme();
  const { user } = useAuth();
  const { width, height } = useWindowDimensions();
  const queryClient = useQueryClient();
  const username = user?.username ?? "";

  const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
  const mural = useQuery({
    queryKey: ["murals", own.data?.muralId],
    queryFn: () => fetchMural(own.data!.muralId!),
    enabled: Boolean(own.data?.muralId),
  });
  const libraryQuery = useLibrary();
  const library = libraryQuery.data;
  const gallery = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });
  const tierlistsQuery = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists });
  const murals = useMurals();
  const styleQuery = useReaderCardStyle();
  const ownStyle = useOwnCardStyle();
  const cardShare = useQuery({ queryKey: CARD_SHARE_KEY, queryFn: fetchCardShare });
  const activitySection = useActivitySection(username);
  const plainHeader = usePlainHeader();

  const [tab, setTab] = useState<MyShelfTab>(lastTab);
  const [switchingMural, setSwitchingMural] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sharingCard, setSharingCard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const books = library?.data.books ?? NO_BOOKS;
  const groups = library?.data.groups ?? NO_GROUPS;
  const images = gallery.data ?? [];
  const tierlists = tierlistsQuery.data ?? [];
  const profile = user?.username
    ? { username: user.username, avatarUrl: user.avatarId ? `${API_URL}/auth/avatar/${user.avatarId}/file` : null }
    : undefined;

  const card = useMemo(() => (libraryQuery.isSuccess ? ownProfileCard(readerCardInputOf(books, groups, username, locale, undefined, ownStyle)) : null), [libraryQuery.isSuccess, books, groups, username, locale, ownStyle]);
  const ordered = useMemo(() => orderLibraryBooks(books, groups), [books, groups]);
  const preview = useMemo(() => buildMuralPreset("shelf", ordered, locale, groups), [ordered, locale, groups]);
  const previewMural: Mural = { id: "shelf-preview", name: preview.name, theme, blocks: preview.blocks, createdAt: "", updatedAt: "", shareToken: null, shareUrl: null, folderId: null };
  const pendingShelf = useRef<string | null>(null);
  const working = useRef(false);

  function handleTabChange(next: MyShelfTab) {
    lastTab = next;
    setTab(next);
  }

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["community", "own-profile"] });
      await queryClient.invalidateQueries({ queryKey: ["community", "profile", username] });
      await queryClient.invalidateQueries({ queryKey: ["community", "activity", username] });
      return true;
    } catch {
      setError(t("community.somethingWentWrongRetry"));
      await queryClient.invalidateQueries({ queryKey: ["community", "own-profile"] });
      await queryClient.invalidateQueries({ queryKey: ["murals"] });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function enableCardLink() {
    const { shareUrl } = await shareCard();
    await queryClient.invalidateQueries({ queryKey: CARD_SHARE_KEY });
    return shareUrl;
  }

  async function disableCardLink() {
    await unshareCard();
    await queryClient.invalidateQueries({ queryKey: CARD_SHARE_KEY });
  }

  function handleChipPress() {
    if (!own.data) return;
    if (own.data.published) setConfirmingUnpublish(true);
    else setConfirmingPublish(true);
  }

  if (own.isPending) {
    return (
      <Screen top={false}>
        <Stack.Screen options={{ headerShown: true, title: t("community.myShelf"), ...plainHeader }} />
        <View style={styles.tabPad}><Skeleton height={180} /></View>
      </Screen>
    );
  }

  if (own.isError) {
    return (
      <Screen top={false}>
        <Stack.Screen options={{ headerShown: true, title: t("community.myShelf"), ...plainHeader }} />
        <ErrorState title={t("community.shelfUnavailable")} body={t("community.shelfLoadFailed")} actionLabel={t("shell.retry")} onAction={() => void own.refetch()} />
      </Screen>
    );
  }

  const ownData = own.data;
  const hasMural = Boolean(ownData.muralId);
  const muralHasBlocks = Boolean(mural.data && mural.data.blocks.length > 0);

  async function shelfTargetId() {
    const id = ownData.muralId ?? pendingShelf.current ?? (await murals.create(t("community.myShelf"), theme)).id;
    pendingShelf.current = id;
    return id;
  }

  async function keepShelf() {
    if (working.current) return;
    working.current = true;
    try {
      const ok = await run(async () => {
        const id = await shelfTargetId();
        await murals.update(id, { blocks: preview.blocks });
        if (ownData.muralId !== id) await setShelfMural(id);
      });
      if (ok) await queryClient.invalidateQueries({ queryKey: ["murals"] });
    } finally {
      working.current = false;
    }
  }

  async function startBlank() {
    if (working.current) return;
    working.current = true;
    try {
      let id: string | null = null;
      const ok = await run(async () => {
        id = await shelfTargetId();
        if (ownData.muralId !== id) await setShelfMural(id);
      });
      if (ok && id) router.push(`/murals/${id}` as never);
    } finally {
      working.current = false;
    }
  }

  async function publish(shareReading: boolean) {
    setAnswer(shareReading);
    await run(async () => {
      await publishProfile({ shareReading });
      setConfirmingPublish(false);
    });
    setAnswer(null);
  }

  function shelfBody() {
    if (hasMural && mural.isPending) return <View style={styles.tabPad}><Skeleton height={240} /></View>;
    if (hasMural && mural.isError) return <ErrorState body={t("community.shelfLoadFailed")} actionLabel={t("shell.retry")} onAction={() => void mural.refetch()} />;
    if (hasMural && muralHasBlocks) {
      return (
        <View style={styles.canvasScroll}>
          <MuralCanvas
            mural={{ ...mural.data!, blocks: ensureBookBlockHeights(mural.data!.blocks) }}
            books={books}
            groups={groups}
            images={images}
            tierlists={tierlists}
            profile={profile}
            profileInHero
          />
        </View>
      );
    }
    if (libraryQuery.isPending) return <View style={styles.tabPad}><Skeleton height={240} /></View>;
    if (libraryQuery.isError) return <ErrorState body={t("shell.libraryLoadFailed")} actionLabel={t("shell.retry")} onAction={() => void libraryQuery.refetch()} />;
    if (!books.length) {
      return (
        <EmptyState
          title={t("library.startTitle")}
          body={t("community.startLibraryManualBody")}
          actionLabel={t("shell.importLibrary")}
          onAction={() => router.push("/import" as never)}
          secondaryActionLabel={t("shell.addBook")}
          onSecondaryAction={() => router.push("/add-book" as never)}
        />
      );
    }
    return <ShelfPreview mural={previewMural} summary={shelfPresetSummary(books, ownData.published, locale)} busy={busy} books={books} groups={groups} images={images} tierlists={tierlists} profile={profile} onKeep={() => void keepShelf()} onBlank={() => void startBlank()} />;
  }

  const glyph = ownData.published && ownData.feedSettings.readerGlyph && card?.input.card.state === "settled" ? card.input.card.identity ?? undefined : undefined;
  const cardActions = card ? (
    <>
      <ProfileHeroIdentity username={username} avatarUrl={profile?.avatarUrl ?? null} glyph={glyph} finished={card.input.card.facts?.finished} />
      {card.progress ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{card.progress}</Text> : null}
      {cardShare.isError ? <Text accessibilityRole="alert" {...dynamicType} style={[typography.caption, { color: colors.danger }]}>{t("community.somethingWentWrongRetry")}</Text> : null}
    </>
  ) : null;

  const hero = card && styleQuery.isSuccess ? (
    <ProfileCardHero
      input={card.input}
      width={width}
      withBackdrop={false}
      badge={<IconButton name="share" tone="accent" accessibilityLabel={t("readerCard.shareCard")} disabled={!cardShare.data} onPress={() => setSharingCard(true)} />}
      onEdit={() => router.push("/reader-card" as never)}
    >
      {cardActions}
    </ProfileCardHero>
  ) : card && styleQuery.isError ? (
    <View style={styles.cardError}>
      <Text accessibilityRole="alert" {...dynamicType} style={[typography.caption, { color: colors.danger }]}>{t("community.somethingWentWrongRetry")}</Text>
      <Button label={t("shell.retry")} variant="secondary" onPress={() => void styleQuery.refetch()} />
      {cardActions}
    </View>
  ) : libraryQuery.isError ? null : (
    <ProfileCardSkeleton width={width} />
  );

  function sectionFor(value: MyShelfTab): ProfileSection {
    if (value === "daily") return elementSection([<DailyChapterProfileSection key="daily" userId={user!.id} own />]);
    if (value === "activity") return activitySection;
    return elementSection([<View key="shelf">{shelfBody()}</View>]);
  }

  const menuGroups: ActionItem[][] = [
    [
      ...(card ? [{ label: t("murals.editCard"), icon: "edit" as const, onPress: () => router.push("/reader-card" as never) }] : []),
      ...(hasMural ? [{ label: t("community.editShelf"), icon: "edit" as const, onPress: () => router.push(`/murals/${ownData.muralId}` as never) }] : []),
      { label: t("community.switchShelfMural"), icon: "murals", onPress: () => setSwitchingMural(true) },
    ],
    [{ label: t("community.feedSettings"), icon: "settings", onPress: () => setSettingsOpen(true) }],
  ];

  const headerRight = () => (
    <HeaderActions>
      <IconButton
        name={ownData.published ? "public" : "lock"}
        accessibilityLabel={ownData.published ? t("community.publishedTapUnpublish") : t("community.privateTapPublish")}
        onPress={handleChipPress}
      />
      <ActionSheet title={t("community.myShelf")} groups={menuGroups}>
        {(open) => <IconButton accessibilityLabel={t("community.shelfOptions")} name="more" onPress={open} />}
      </ActionSheet>
    </HeaderActions>
  );

  return (
    <Screen top={false}>
      <Stack.Screen options={{ headerShown: true, ...transparentHeader, headerRight }} />
      <ProfileScroller
        notice={error ? <Toast visible message={error} tone="error" /> : null}
        accessibilityLabel={t("community.myShelfSections")}
        hero={hero}
        backdrop={card && styleQuery.isSuccess ? <ProfileCardBackdrop input={card.input} /> : null}
        tabs={MY_SHELF_TABS.map((entry) => ({ value: entry.value, label: t(entry.labelKey) }))}
        value={tab}
        onChange={handleTabChange}
        section={sectionFor(tab)}
      />
      {card ? (
        <ContentShareSheet
          visible={sharingCard}
          onClose={() => setSharingCard(false)}
          title={t("readerCard.title")}
          url={cardShare.data?.shareUrl}
          onEnableLink={enableCardLink}
          onDisableLink={disableCardLink}
        >
          {styleQuery.isSuccess ? <View style={styles.sharePreview}><ReaderCardImage input={card.input} width={Math.min(SHARE_CARD_WIDTH, width - SHARE_SHEET_CHROME_WIDTH, (height - SHARE_SHEET_CHROME_HEIGHT) / PLATE_RATIO)} /></View> : null}
        </ContentShareSheet>
      ) : null}
      <MuralPicker
        visible={switchingMural}
        busy={busy}
        title={t("community.chooseShelf")}
        description={t("community.chooseShelfBody")}
        actionLabel={t("community.useThisMural")}
        error={error}
        onClose={() => setSwitchingMural(false)}
        onPick={(muralId) => void run(async () => {
          await setShelfMural(muralId);
          setSwitchingMural(false);
        })}
      />
      <Dialog visible={confirmingPublish} title={t("community.publishShelfTitle")} onClose={() => setConfirmingPublish(false)}>
        <View style={styles.dialogGap}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
            {t("community.publishShelfBody", { username })}
          </Text>
          <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>
            {t("community.shareReadingQuestion")}
          </Text>
          {error ? <Toast visible message={error} tone="error" /> : null}
          <Button label={t("community.shareMyReading")} variant="secondary" loading={answer === true} disabled={busy} onPress={() => void publish(true)} />
          <Button label={t("community.dontShareMyReading")} variant="secondary" loading={answer === false} disabled={busy} onPress={() => void publish(false)} />
        </View>
      </Dialog>
      <Dialog visible={confirmingUnpublish} title={t("community.unpublishTitle")} onClose={() => setConfirmingUnpublish(false)}>
        <View style={styles.dialogGap}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
            {t("community.unpublishBody")}
          </Text>
          {error ? <Toast visible message={error} tone="error" /> : null}
          <Button
            label={t("community.unpublish")}
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
  tabPad: { flex: 1, padding: spacing.lg },
  canvasScroll: { paddingHorizontal: spacing.sm, paddingTop: spacing.lg },
  cardError: { padding: spacing.lg, gap: spacing.md },
  sharePreview: { alignItems: "center" },
  dialogGap: { gap: spacing.md },
});
