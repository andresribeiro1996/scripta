import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ownProfileCard, readerCardInputOf } from "@scripta/shared";
import type { FeedCategory, FeedSettings } from "@scripta/shared/community";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import { fetchCardShare, fetchOwnProfile, publishProfile, setShelfMural, shareCard, unpublishProfile, unshareCard, updateFeedSettings } from "../api/community";
import { useAuth } from "../auth/AuthContext";
import { Avatar, avatarUrlFor } from "./Avatar";
import { EmptyState } from "./EmptyState";
import { Page } from "./page/Page";
import { BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "./page/buttonClasses";
import { MuralsIcon } from "./NavIcons";
import { MuralCanvas } from "./murals/MuralCanvas";
import { ProfileActivity } from "./ProfileActivity";
import { ProfileLibraryPanel } from "./ProfileLibraryPanel";
import { ProfileCardHero } from "./readerCard/ProfileCardHero";
import { ShareModal } from "./ShareModal";
import { Sheet } from "./Sheet";
import { SkeletonCardGrid } from "./Skeleton";
import { SwipeTabs } from "./SwipeTabs";
import { useCommunityActivity } from "../hooks/useCommunity";
import { useGalleryImages } from "../hooks/useGalleryImages";
import { useLibrary } from "../hooks/useLibrary";
import { useMurals } from "../hooks/useMurals";
import { useOwnCardStyle } from "../hooks/useReaderCard";
import { backTo } from "../lib/areas";
import { bookHref } from "../lib/libraryView";
import { bookKey } from "../lib/merge";
import { orderLibraryBooks } from "../lib/libraryOrder";
import { buildMuralPreset, shelfPresetSummary } from "../lib/muralPresets";
import type { Mural } from "../lib/murals";
import { useResolvedTheme } from "../lib/theme";
import { useLocale, useT } from "../i18n";

const OWN_SHELF_TABS = [
  { value: "mural", label: "library.shelfTabMural" },
  { value: "activity", label: "library.shelfTabActivity" },
  { value: "library", label: "library.shelfTabLibrary" }
] as const;

type OwnShelfTab = (typeof OWN_SHELF_TABS)[number]["value"];

const CARD_SHARE_KEY = ["community", "card-share"] as const;

export function OwnShelfView({ username }: { username: string }) {
  const locale = useLocale();
  const t = useT();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
  const murals = useMurals();
  const viewerTheme = useResolvedTheme();
  const libraryQuery = useLibrary();
  const library = libraryQuery.data;
  const { images } = useGalleryImages();
  const activity = useCommunityActivity(username);
  const [tab, setTab] = useState<OwnShelfTab>("mural");
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [sharingCard, setSharingCard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const books = useMemo(() => library?.data.books ?? [], [library]);
  const groups = useMemo(() => library?.data.groups ?? [], [library]);
  const ownStyle = useOwnCardStyle();
  const { input: cardInput, progress } = useMemo(() => ownProfileCard(readerCardInputOf(books, groups, username, locale, undefined, ownStyle)), [books, groups, username, locale, ownStyle]);
  const cardShare = useQuery({ queryKey: CARD_SHARE_KEY, queryFn: fetchCardShare });
  const ordered = useMemo(() => orderLibraryBooks(books, groups), [books, groups]);
  const preview = useMemo(() => buildMuralPreset("shelf", ordered, locale, groups), [ordered, locale, groups]);
  const previewMural: Mural = { id: "shelf-preview", name: preview.name, theme: viewerTheme, blocks: preview.blocks, createdAt: "", updatedAt: "", shareToken: null, shareUrl: null, folderId: null };
  const pendingShelf = useRef<string | null>(null);
  const working = useRef(false);

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
      setError(t("library.shelfActionFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function shareOwnCard() {
    const result = await shareCard();
    await queryClient.invalidateQueries({ queryKey: CARD_SHARE_KEY });
    return result;
  }

  async function unshareOwnCard() {
    await unshareCard();
    await queryClient.invalidateQueries({ queryKey: CARD_SHARE_KEY });
  }

  function publish(shareReading: boolean) {
    setPublishing(false);
    void run(() => publishProfile({ shareReading }));
  }

  async function shelfTargetId() {
    const id = own.data?.muralId ?? pendingShelf.current ?? (await murals.create(t("shell.myShelf"), viewerTheme)).id;
    pendingShelf.current = id;
    return id;
  }

  async function keepShelf() {
    if (working.current) return;
    working.current = true;
    try {
      await run(async () => {
        const id = await shelfTargetId();
        await murals.saveBlocks(id, preview.blocks);
        if (own.data?.muralId !== id) await setShelfMural(id);
      });
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
        if (own.data?.muralId !== id) await setShelfMural(id);
      });
      if (ok && id) navigate(`/dashboard/murals/${id}`);
    } finally {
      working.current = false;
    }
  }

  if (own.isPending || murals.isLoading) {
    return (
      <Page title={`@${username}`} back={backTo("profile")}>
        <SkeletonCardGrid count={2} label={t("library.shelfLoading")} tileClassName="min-h-[120px]" />
      </Page>
    );
  }

  if (own.isError || murals.isError) {
    return (
      <Page title={`@${username}`} back={backTo("profile")}>
        <EmptyState
          title={t("library.shelfUnavailable")}
          body={t("library.shelfLoadFailed")}
          action={
            <button
              onClick={() => {
                void own.refetch();
                void murals.refetch();
              }}
              className={BUTTON_SECONDARY}
            >
              {t("library.retry")}
            </button>
          }
        />
      </Page>
    );
  }

  const ownData = own.data;
  const shelfMural = murals.data?.find((item) => item.id === ownData.muralId) ?? null;
  const muralHasBlocks = Boolean(shelfMural && shelfMural.blocks.length > 0);
  const profile = session?.user.username
    ? { username: session.user.username, avatarUrl: session.user.avatarId ? avatarUrlFor(session.user.avatarId) : null }
    : undefined;

  return (
    <Page title={null} back={backTo("profile")}>
      <ProfileCardHero input={cardInput}>
        <div className="flex flex-wrap items-center gap-5">
          {session?.user && <Avatar user={session.user} size={72} />}
          <h1 className="font-display min-w-0 flex-1 basis-48 break-words text-3xl font-bold lg:text-[2.5rem] lg:leading-[3rem]">@{username}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-semibold ${
                ownData.published ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim)"
              }`}
            >
              {ownData.published ? t("library.published") : t("library.private")}
            </span>
            {!ownData.published && (
              <button
                onClick={() => setPublishing(true)}
                disabled={busy}
                className={BUTTON_PRIMARY}
              >
                {t("library.publish")}
              </button>
            )}
            {publishing && <PublishDialog username={username} onAnswer={publish} onCancel={() => setPublishing(false)} />}
            <OwnerControls
              busy={busy}
              published={ownData.published}
              currentMuralId={ownData.muralId}
              feedSettings={ownData.feedSettings}
              onSwitch={(muralId) => void run(() => setShelfMural(muralId))}
              onUnpublish={() => void run(() => unpublishProfile())}
              onSaveSettings={(settings) => void run(() => updateFeedSettings(settings))}
            />
          </div>
        </div>
        {progress ? <p className="mt-3 text-sm text-(--color-text-dim)">{progress}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => setSharingCard(true)} disabled={!cardShare.data} className={BUTTON_SECONDARY}>
            {t("readerCard.shareCard")}
          </button>
          <Link to="/dashboard/reader-card" className={BUTTON_SECONDARY}>
            {t("readerCard.editCard")}
          </Link>
          {cardShare.isError && <p className="text-sm text-(--color-danger)">{t("library.shelfActionFailed")}</p>}
        </div>
        {sharingCard && cardShare.data && (
          <ShareModal
            title={t("shell.areaReaderCard")}
            shareToken={cardShare.data.shareToken}
            shareUrl={cardShare.data.shareUrl}
            defaultCaption={t("shell.areaReaderCard")}
            onShare={shareOwnCard}
            onUnshare={unshareOwnCard}
            onClose={() => setSharingCard(false)}
          />
        )}
      </ProfileCardHero>
      <div className="mt-6">
        {error && <p className="mb-4 text-sm text-(--color-danger)">{error}</p>}
        <SwipeTabs tabs={OWN_SHELF_TABS.map((entry) => ({ value: entry.value, label: t(entry.label) }))} value={tab} onChange={setTab} label={t("library.shelfSections")}>
          {(panel) => {
            if (panel === "activity") return <ProfileActivity activity={activity} />;
            if (panel === "library") return <ProfileLibraryPanel library={library?.data} isLoading={libraryQuery.isPending} error={libraryQuery.error} onRetry={() => void libraryQuery.refetch()} onOpenBook={(book) => navigate(bookHref(bookKey(book), library?.works))} />;
            return (
              <div className="mb-8">
                {shelfMural && muralHasBlocks ? (
                  <MuralCanvas mural={shelfMural} editMode={false} groups={groups} books={books} images={images} profile={profile} />
                ) : libraryQuery.isPending ? (
                  <SkeletonCardGrid count={2} label={t("library.libraryLoadingOwn")} tileClassName="min-h-[120px]" />
                ) : libraryQuery.isError ? (
                  <EmptyState
                    title={t("library.libraryUnavailable")}
                    body={t("library.libraryLoadFailedOwn")}
                    action={
                      <button onClick={() => void libraryQuery.refetch()} className={BUTTON_SECONDARY}>
                        {t("library.retry")}
                      </button>
                    }
                  />
                ) : books.length === 0 ? (
                  <EmptyState
                    icon={MuralsIcon}
                    title={t("library.startLibraryTitle")}
                    body={t("library.startLibraryBody")}
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Link to="/dashboard/library?action=import" className={BUTTON_SECONDARY}>
                          {t("library.importHeading")}
                        </Link>
                        <Link to="/dashboard/library?action=add" className={BUTTON_SECONDARY}>
                          {t("library.addBook")}
                        </Link>
                      </div>
                    }
                  />
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-(--color-text-dim)">{shelfPresetSummary(books, ownData.published, locale)}</p>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => void keepShelf()} disabled={busy} className={BUTTON_SECONDARY}>
                        {t("library.keepShelf")}
                      </button>
                      <button onClick={() => void startBlank()} disabled={busy} className={BUTTON_SECONDARY}>
                        {t("library.startBlank")}
                      </button>
                    </div>
                    <MuralCanvas mural={previewMural} editMode={false} groups={groups} books={books} images={images} profile={profile} hideProfileName />
                  </div>
                )}
              </div>
            );
          }}
        </SwipeTabs>
      </div>
    </Page>
  );
}

function PublishDialog({ username, onAnswer, onCancel }: { username: string; onAnswer: (shareReading: boolean) => void; onCancel: () => void }) {
  const t = useT();
  return (
    <Sheet
      title={t("library.publishTitle")}
      onClose={onCancel}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onCancel} className={BUTTON_SECONDARY}>
            {t("shell.cancel")}
          </button>
          <button onClick={() => onAnswer(false)} className={BUTTON_SECONDARY}>
            {t("library.publishNoReading")}
          </button>
          <button onClick={() => onAnswer(true)} className={BUTTON_PRIMARY}>
            {t("library.publishShareReading")}
          </button>
        </div>
      }
    >
      <div className="px-3 pb-2">
        <p className="text-xs text-(--color-text-dim)">{t("library.publishBody", { username })}</p>
        <p className="mt-3 text-sm">{t("library.publishQuestion")}</p>
      </div>
    </Sheet>
  );
}

const FEED_SETTING_ROWS = [
  { key: "publications", label: "library.feedPublications" },
  { key: "reading", label: "library.feedReading" },
  { key: "votes", label: "library.feedVotes" },
  { key: "follows", label: "library.feedFollows" }
] as const satisfies ReadonlyArray<{ key: FeedCategory; label: string }>;

function OwnerControls({
  busy,
  currentMuralId,
  feedSettings,
  published,
  onSwitch,
  onUnpublish,
  onSaveSettings
}: {
  busy: boolean;
  currentMuralId: string | null;
  feedSettings?: FeedSettings;
  published: boolean;
  onSwitch: (muralId: string) => void;
  onUnpublish: () => void;
  onSaveSettings: (settings: FeedSettings) => void;
}) {
  const t = useT();
  const { data: murals } = useMurals();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [muralId, setMuralId] = useState<string>(currentMuralId ?? "");
  const [next, setNext] = useState<FeedSettings>(feedSettings ?? DEFAULT_FEED_SETTINGS);
  const sectionLabel = "px-3 pt-4 pb-2 text-sm font-semibold text-(--color-text-dim)";
  return (
    <>
      <button
        onClick={() => {
          setMuralId(currentMuralId ?? murals?.[0]?.id ?? "");
          setNext(feedSettings ?? DEFAULT_FEED_SETTINGS);
          setConfirming(false);
          setOpen(true);
        }}
        className={BUTTON_SECONDARY}
      >
        {t("library.manageProfile")}
      </button>
      {open && (
        <Sheet
          title={t("library.manageProfile")}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button onClick={() => setOpen(false)} className={BUTTON_SECONDARY}>
                {t("shell.cancel")}
              </button>
              <button onClick={() => onSaveSettings(next)} disabled={busy} className={BUTTON_PRIMARY}>
                {busy ? t("shell.saving") : t("library.saveFeedSettings")}
              </button>
            </>
          }
        >
          <p className={sectionLabel}>{t("library.shelfMural")}</p>
          <div className="flex items-center gap-2 px-3">
            <select
              value={muralId}
              onChange={(e) => setMuralId(e.target.value)}
              aria-label={t("library.shelfMural")}
              className={`${FIELD_CLASS} min-w-0 flex-1`}
            >
              {(murals ?? []).map((mural) => (
                <option key={mural.id} value={mural.id}>
                  {mural.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => muralId && muralId !== currentMuralId && onSwitch(muralId)}
              disabled={busy || !muralId || muralId === currentMuralId}
              className={BUTTON_SECONDARY}
            >
              {busy ? t("shell.working") : t("library.switch")}
            </button>
          </div>
          <p className={sectionLabel}>{t("library.whatOthersSee")}</p>
          {FEED_SETTING_ROWS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setNext((settings) => ({ ...settings, [key]: !settings[key] }))}
              aria-pressed={next[key]}
              className={`flex min-h-12 w-full items-center justify-between rounded-lg px-3 text-left text-[15px] hover:bg-(--color-surface-hover) ${
                next[key] ? "" : "text-(--color-text-dim)"
              }`}
            >
              {t(label)}
              {next[key] && (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
          {published && (
            <div className="mt-4 border-t border-(--color-border) p-3">
              {confirming ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-(--color-text-dim)">{t("library.hideProfileQuestion")}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <button onClick={() => setConfirming(false)} className="min-h-11 px-2 text-sm text-(--color-text-dim) hover:text-(--color-text)">
                      {t("shell.cancel")}
                    </button>
                    <button onClick={onUnpublish} disabled={busy} className={BUTTON_DANGER}>
                      {t("library.unpublish")}
                    </button>
                  </span>
                </div>
              ) : (
                <button onClick={() => setConfirming(true)} className="min-h-11 text-sm font-semibold text-(--color-danger)">
                  {t("library.unpublishProfile")}
                </button>
              )}
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
