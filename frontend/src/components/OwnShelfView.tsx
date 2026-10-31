import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedCategory, FeedSettings } from "@scripta/shared/community";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import { fetchOwnProfile, publishProfile, setShelfMural, unpublishProfile, updateFeedSettings } from "../api/community";
import { useAuth } from "../auth/AuthContext";
import { Avatar, avatarUrlFor } from "./Avatar";
import { EmptyState } from "./EmptyState";
import { Page } from "./page/Page";
import { BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "./page/buttonClasses";
import { MuralsIcon } from "./NavIcons";
import { MuralCanvas } from "./murals/MuralCanvas";
import { ProfileActivity } from "./ProfileActivity";
import { ProfileLibraryPanel } from "./ProfileLibraryPanel";
import { Sheet } from "./Sheet";
import { SkeletonCardGrid } from "./Skeleton";
import { SwipeTabs } from "./SwipeTabs";
import { useCommunityActivity } from "../hooks/useCommunity";
import { useGalleryImages } from "../hooks/useGalleryImages";
import { useLibrary } from "../hooks/useLibrary";
import { useMurals } from "../hooks/useMurals";
import { backTo } from "../lib/areas";
import { bookHref } from "../lib/libraryView";
import { bookKey } from "../lib/merge";
import { orderLibraryBooks } from "../lib/libraryOrder";
import { buildMuralPreset, shelfPresetSummary } from "../lib/muralPresets";
import type { Mural } from "../lib/murals";
import { useResolvedTheme } from "../lib/theme";
import { useLocale } from "../i18n";

const OWN_SHELF_TABS = [
  { value: "mural", label: "Mural" },
  { value: "activity", label: "Activity" },
  { value: "library", label: "Library" }
] as const;

type OwnShelfTab = (typeof OWN_SHELF_TABS)[number]["value"];

export function OwnShelfView({ username }: { username: string }) {
  const locale = useLocale();
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
  const [error, setError] = useState<string | null>(null);
  const books = useMemo(() => library?.data.books ?? [], [library]);
  const groups = useMemo(() => library?.data.groups ?? [], [library]);
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
      setError("Something went wrong. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function publish(shareReading: boolean) {
    setPublishing(false);
    void run(() => publishProfile({ shareReading }));
  }

  async function shelfTargetId() {
    const id = own.data?.muralId ?? pendingShelf.current ?? (await murals.create("My shelf", viewerTheme)).id;
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
        <SkeletonCardGrid count={2} label="Loading your shelf" tileClassName="min-h-[120px]" />
      </Page>
    );
  }

  if (own.isError || murals.isError) {
    return (
      <Page title={`@${username}`} back={backTo("profile")}>
        <EmptyState
          title="Shelf unavailable."
          body="Couldn't load your shelf."
          action={
            <button
              onClick={() => {
                void own.refetch();
                void murals.refetch();
              }}
              className={BUTTON_SECONDARY}
            >
              Retry
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
      <div className="flex flex-wrap items-center gap-5">
        {session?.user && <Avatar user={session.user} size={72} />}
        <h1 className="font-display min-w-0 flex-1 basis-48 break-words text-3xl font-bold lg:text-[2.5rem] lg:leading-[3rem]">@{username}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-semibold ${
              ownData.published ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim)"
            }`}
          >
            {ownData.published ? "Published" : "Private"}
          </span>
          {!ownData.published && (
            <button
              onClick={() => setPublishing(true)}
              disabled={busy}
              className={BUTTON_PRIMARY}
            >
              Publish…
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
      <div className="mt-6">
        {error && <p className="mb-4 text-sm text-(--color-danger)">{error}</p>}
        <SwipeTabs tabs={OWN_SHELF_TABS} value={tab} onChange={setTab} label="Shelf sections">
          {(panel) => {
            if (panel === "activity") return <ProfileActivity activity={activity} />;
            if (panel === "library") return <ProfileLibraryPanel library={library?.data} isLoading={libraryQuery.isPending} error={libraryQuery.error} onRetry={() => void libraryQuery.refetch()} onOpenBook={(book) => navigate(bookHref(bookKey(book), library?.works))} />;
            return (
              <div className="mb-8">
                {shelfMural && muralHasBlocks ? (
                  <MuralCanvas mural={shelfMural} editMode={false} groups={groups} books={books} images={images} profile={profile} />
                ) : libraryQuery.isPending ? (
                  <SkeletonCardGrid count={2} label="Loading your library" tileClassName="min-h-[120px]" />
                ) : libraryQuery.isError ? (
                  <EmptyState
                    title="Library unavailable."
                    body="Couldn't load your library."
                    action={
                      <button onClick={() => void libraryQuery.refetch()} className={BUTTON_SECONDARY}>
                        Retry
                      </button>
                    }
                  />
                ) : books.length === 0 ? (
                  <EmptyState
                    icon={MuralsIcon}
                    title="Start your library"
                    body="Import your existing collection, or add your first book manually."
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Link to="/dashboard/library?action=import" className={BUTTON_SECONDARY}>
                          Import library
                        </Link>
                        <Link to="/dashboard/library?action=add" className={BUTTON_SECONDARY}>
                          Add a book
                        </Link>
                      </div>
                    }
                  />
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-(--color-text-dim)">{shelfPresetSummary(books, ownData.published, locale)}</p>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => void keepShelf()} disabled={busy} className={BUTTON_SECONDARY}>
                        Keep this shelf
                      </button>
                      <button onClick={() => void startBlank()} disabled={busy} className={BUTTON_SECONDARY}>
                        Start blank
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
  return (
    <Sheet
      title="Publish your shelf?"
      onClose={onCancel}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onCancel} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button onClick={() => onAnswer(false)} className={BUTTON_SECONDARY}>
            Don't share my reading
          </button>
          <button onClick={() => onAnswer(true)} className={BUTTON_PRIMARY}>
            Share my reading
          </button>
        </div>
      }
    >
      <div className="px-3 pb-2">
        <p className="text-xs text-(--color-text-dim)">{`It becomes a public page at /u/${username} with your library, and readers can find and follow you.`}</p>
        <p className="mt-3 text-sm">Share what you add and finish on your page and with followers?</p>
      </div>
    </Sheet>
  );
}

const FEED_SETTING_ROWS: Array<{ key: FeedCategory; label: string }> = [
  { key: "publications", label: "Publications" },
  { key: "reading", label: "Reading activity" },
  { key: "votes", label: "Votes" },
  { key: "follows", label: "Follows" }
];

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
        Manage profile
      </button>
      {open && (
        <Sheet
          title="Manage profile"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button onClick={() => setOpen(false)} className={BUTTON_SECONDARY}>
                Cancel
              </button>
              <button onClick={() => onSaveSettings(next)} disabled={busy} className={BUTTON_PRIMARY}>
                {busy ? "Saving…" : "Save feed settings"}
              </button>
            </>
          }
        >
          <p className={sectionLabel}>Shelf mural</p>
          <div className="flex items-center gap-2 px-3">
            <select
              value={muralId}
              onChange={(e) => setMuralId(e.target.value)}
              aria-label="Shelf mural"
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
              {busy ? "Working…" : "Switch"}
            </button>
          </div>
          <p className={sectionLabel}>What other readers see</p>
          {FEED_SETTING_ROWS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setNext((settings) => ({ ...settings, [key]: !settings[key] }))}
              aria-pressed={next[key]}
              className={`flex min-h-12 w-full items-center justify-between rounded-lg px-3 text-left text-[15px] hover:bg-(--color-surface-hover) ${
                next[key] ? "" : "text-(--color-text-dim)"
              }`}
            >
              {label}
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
                  <span className="text-sm text-(--color-text-dim)">Hide your profile from the community?</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <button onClick={() => setConfirming(false)} className="min-h-11 px-2 text-sm text-(--color-text-dim) hover:text-(--color-text)">
                      Cancel
                    </button>
                    <button onClick={onUnpublish} disabled={busy} className={BUTTON_DANGER}>
                      Unpublish
                    </button>
                  </span>
                </div>
              ) : (
                <button onClick={() => setConfirming(true)} className="min-h-11 text-sm font-semibold text-(--color-danger)">
                  Unpublish profile
                </button>
              )}
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
