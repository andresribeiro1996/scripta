import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedCategory, FeedSettings } from "@scripta/shared/community";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import { fetchOwnProfile, publishProfile, setShelfMural, unpublishProfile, updateFeedSettings } from "../api/community";
import { useAuth } from "../auth/AuthContext";
import { avatarUrlFor } from "./Avatar";
import { useConfirm } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { MuralsIcon } from "./NavIcons";
import { MuralCanvas } from "./murals/MuralCanvas";
import { ProfileActivity } from "./ProfileActivity";
import { Sheet } from "./Sheet";
import { SkeletonCardGrid } from "./Skeleton";
import { SwipeTabs } from "./SwipeTabs";
import { useCommunityActivity } from "../hooks/useCommunity";
import { useGalleryImages } from "../hooks/useGalleryImages";
import { useLibrary } from "../hooks/useLibrary";
import { useMurals } from "../hooks/useMurals";

const OWN_SHELF_TABS = [
  { value: "mural", label: "Mural" },
  { value: "activity", label: "Activity" }
] as const;

type OwnShelfTab = (typeof OWN_SHELF_TABS)[number]["value"];

export function OwnShelfView({ username }: { username: string }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
  const murals = useMurals();
  const { data: library } = useLibrary();
  const { images } = useGalleryImages();
  const activity = useCommunityActivity(username);
  const [tab, setTab] = useState<OwnShelfTab>("mural");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["community", "own-profile"] });
      await queryClient.invalidateQueries({ queryKey: ["community", "profile", username] });
      return true;
    } catch {
      setError("Something went wrong. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    const muralId = own.data?.muralId;
    if (!muralId) return;
    const confirmed = await confirm({
      title: "Publish your shelf?",
      body: `It becomes a public page at /u/${username}, and people can follow you.`,
      confirmLabel: "Publish",
      danger: false
    });
    if (!confirmed) return;
    await run(() => publishProfile(muralId));
  }

  async function createShelf() {
    if (own.data?.muralId) {
      navigate(`/dashboard/murals/${own.data.muralId}`);
      return;
    }
    let targetId: string | null = null;
    const ok = await run(async () => {
      const existing = murals.data?.find((item) => item.name === "My shelf");
      const target = existing ?? (await murals.create("My shelf"));
      targetId = target.id;
      await setShelfMural(target.id);
    });
    if (ok && targetId) navigate(`/dashboard/murals/${targetId}`);
  }

  if (own.isPending || murals.isLoading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <SkeletonCardGrid count={2} label="Loading your shelf" tileClassName="min-h-[120px]" />
      </div>
    );
  }

  if (own.isError || murals.isError) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState
          title="Shelf unavailable."
          body="Couldn't load your shelf."
          action={
            <button
              onClick={() => {
                void own.refetch();
                void murals.refetch();
              }}
              className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)"
            >
              Retry
            </button>
          }
        />
      </div>
    );
  }

  const ownData = own.data;
  const shelfMural = murals.data?.find((item) => item.id === ownData.muralId) ?? null;
  const muralHasBlocks = Boolean(shelfMural && shelfMural.blocks.length > 0);
  const books = library?.data.books ?? [];
  const groups = library?.data.groups ?? [];
  const profile = session?.user.username
    ? { username: session.user.username, avatarUrl: session.user.avatarId ? avatarUrlFor(session.user.avatarId) : null }
    : undefined;

  return (
    <div className="mx-auto max-w-4xl px-4 pt-3 pb-10 sm:px-6 sm:pt-6">
      <header className="flex items-center justify-between gap-4 pb-3">
        <h1 className="min-w-0 truncate text-xl font-bold tracking-tight sm:text-2xl">{username}</h1>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
              ownData.published ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim)"
            }`}
          >
            {ownData.published ? "Published" : "Private"}
          </span>
          {!ownData.published && (
            <button
              onClick={() => void handlePublish()}
              disabled={busy || !ownData.muralId}
              className="rounded-full bg-(--color-accent) px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Publishing…" : "Publish…"}
            </button>
          )}
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
      </header>
      {error && <p className="mb-4 text-sm text-(--color-danger)">{error}</p>}
      <SwipeTabs tabs={OWN_SHELF_TABS} value={tab} onChange={setTab} label="Shelf sections">
        {(panel) => {
          if (panel === "activity") return <ProfileActivity activity={activity} />;
          return (
            <div className="mb-8">
              {shelfMural && muralHasBlocks ? (
                <MuralCanvas mural={shelfMural} editMode={false} groups={groups} books={books} images={images} profile={profile} />
              ) : (
                <EmptyState
                  icon={MuralsIcon}
                  title="Your shelf is empty"
                  body="Build a private page from your books. Only you can see it until you publish."
                  action={
                    <button onClick={() => void createShelf()} className="rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-white">
                      Create your shelf
                    </button>
                  }
                />
              )}
            </div>
          );
        }}
      </SwipeTabs>
    </div>
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
  const sectionLabel = "px-3 pt-4 pb-2 text-[11px] font-semibold tracking-wider text-(--color-text-dim) uppercase";
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-full border border-(--color-border) bg-(--color-surface) px-4 py-1.5 text-sm font-semibold hover:border-(--color-accent)"
      >
        Manage profile
      </button>
      {open && (
        <Sheet title="Manage profile" onClose={() => setOpen(false)}>
          <p className={sectionLabel}>Shelf mural</p>
          <div className="flex items-center gap-2 px-3">
            <select
              value={muralId}
              onChange={(e) => setMuralId(e.target.value)}
              aria-label="Shelf mural"
              className="min-w-0 flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
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
              className="rounded-lg border border-(--color-border) px-3 py-2 text-sm font-semibold hover:border-(--color-accent) disabled:opacity-50"
            >
              {busy ? "Working…" : "Switch"}
            </button>
          </div>
          <p className={sectionLabel}>Shown in your feed</p>
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
          <div className="px-3 pt-2">
            <button
              onClick={() => onSaveSettings(next)}
              disabled={busy}
              className="w-full rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save feed settings"}
            </button>
          </div>
          {published && (
            <div className="mt-4 border-t border-(--color-border) p-3">
              {confirming ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-(--color-text-dim)">Hide your profile from the community?</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <button onClick={() => setConfirming(false)} className="px-2 py-1.5 text-sm text-(--color-text-dim) hover:text-(--color-text)">
                      Cancel
                    </button>
                    <button onClick={onUnpublish} disabled={busy} className="rounded-lg bg-(--color-danger) px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                      Unpublish
                    </button>
                  </span>
                </div>
              ) : (
                <button onClick={() => setConfirming(true)} className="text-sm font-semibold text-(--color-danger)">
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
