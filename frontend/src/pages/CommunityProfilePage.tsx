import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { FeedCategory, FeedSettings } from "@scripta/shared/community";
import { contentDetail, contentKindLabel, contentTarget, DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import { followUser, publishProfile, unfollowUser, unpublishProfile, updateFeedSettings } from "../api/community";
import type { GalleryImage } from "../api/gallery";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { CommunityIcon, MuralsIcon } from "../components/NavIcons";
import { MuralCanvas } from "../components/murals/MuralCanvas";
import { ProfileActivity } from "../components/ProfileActivity";
import { PublicLibraryGrid } from "../components/PublicLibraryGrid";
import { Sheet } from "../components/Sheet";
import { SkeletonCardGrid } from "../components/Skeleton";
import { SwipeTabs } from "../components/SwipeTabs";
import { useCommunityActivity, useCommunityLibrary, useCommunityProfile } from "../hooks/useCommunity";
import { useMurals } from "../hooks/useMurals";
import { ensureBookBlockHeights, profileOnlyMural, type Mural } from "../lib/murals";
import { buildReconstructedBooks } from "../lib/sharedMural";

function retryButton(refetch: () => void) {
  return (
    <button onClick={() => void refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">
      Retry
    </button>
  );
}

export function CommunityProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { view, isLoading, isNotFound, refetch } = useCommunityProfile(username ?? "");
  const activity = useCommunityActivity(username ?? "");
  const library = useCommunityLibrary(username ?? "", Boolean(view));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>("mural");

  const isOwnHandle = Boolean(username) && session?.user.username === username;
  const isSelf = view?.profile.user.userId === session?.user.id;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["community", "profile", username] });
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!session || isLoading || (!view && !isNotFound && !error)) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <SkeletonCardGrid count={2} label="Loading profile" tileClassName="min-h-[120px]" />
      </div>
    );
  }

  if (isNotFound) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        {isOwnHandle ? (
          <UnpublishedOwnProfile
            busy={busy}
            error={error}
            onPublish={(muralId) => run(async () => void (await publishProfile(muralId)))}
          />
        ) : (
          <PrivateProfileState />
        )}
      </div>
    );
  }

  if (!view) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        {isOwnHandle ? (
          <EmptyState title="Profile unavailable." body="Couldn't load your profile." action={retryButton(refetch)} />
        ) : (
          <PrivateProfileState />
        )}
      </div>
    );
  }

  const muralData = view.mural;
  const books = muralData ? buildReconstructedBooks(muralData.library.books, muralData.library.currentlyReading, muralData.library.highlights) : [];
  const images: GalleryImage[] = muralData
    ? Object.entries(muralData.imageUrls)
        .filter((entry): entry is [string, string] => entry[1] !== null)
        .map(([id, url]) => ({ id, url, filename: "", mimeType: "", width: 0, height: 0, byteSize: 0, createdAt: "" }))
    : [];
  const mural: Mural | null = muralData
    ? {
        id: muralData.mural.id,
        name: muralData.mural.name,
        blocks: ensureBookBlockHeights(muralData.mural.blocks),
        createdAt: "",
        updatedAt: "",
        coverImageUrl: muralData.mural.coverImageUrl ?? undefined,
        shareToken: null,
        shareUrl: null,
        folderId: null
      }
    : null;
  const publishedRows = [
    ...view.published.tierlists.map((item) => ({ kind: contentKindLabel(item), name: item.name, detail: contentDetail(item), target: contentTarget(item) })),
    ...view.published.tournaments.map((item) => ({ kind: contentKindLabel(item), name: item.name, detail: contentDetail(item), target: contentTarget(item) }))
  ];

  const user = view.profile.user;

  return (
    <div className="mx-auto max-w-4xl px-4 pt-3 pb-10 sm:px-6 sm:pt-6">
      <header className="flex items-center justify-between gap-4 pb-3">
        <h1 className="min-w-0 truncate text-xl font-bold tracking-tight sm:text-2xl">{user.username}</h1>
        {isSelf ? (
          <OwnerControls
            busy={busy}
            currentMuralId={muralData?.mural.id ?? null}
            feedSettings={view.feedSettings}
            onSwitch={(muralId) => run(async () => void (await publishProfile(muralId)))}
            onUnpublish={() => run(async () => void (await unpublishProfile()))}
            onSaveSettings={(settings) => run(async () => void (await updateFeedSettings(settings)))}
          />
        ) : (
          <FollowControls
            busy={busy}
            following={view.profile.viewerFollows === true}
            onToggle={(next) =>
              run(async () => {
                if (next === "unfollow") await unfollowUser(user.userId);
                else await followUser(user.userId);
              })
            }
          />
        )}
      </header>
      {error && <p className="mb-4 text-sm text-(--color-danger)">{error}</p>}
      <SwipeTabs tabs={PROFILE_TABS} value={tab} onChange={setTab} label="Profile sections">
        {(panel) => {
          if (panel === "activity") return <ProfileActivity activity={activity} />;
          if (panel === "library") {
            if (library.isLoading) return <SkeletonCardGrid count={6} label="Loading library" tileClassName="aspect-[2/3]" />;
            if (library.error || !library.library) {
              return library.error ? <EmptyState title="Couldn't load this library." action={retryButton(library.refetch)} /> : <p className="text-sm text-(--color-text-dim)">This library is empty.</p>;
            }
            return <PublicLibraryGrid library={library.library} />;
          }
          return (
            <>
              <div className="mb-8">
                {mural && mural.blocks.length > 0 && muralData ? (
                  <MuralCanvas
                    mural={mural}
                    editMode={false}
                    books={books}
                    images={images}
                    profile={user}
                    shelfThemeOverride={muralData.library.shelfTheme}
                    statsOverride={muralData.library.stats}
                    tierlistData={(tierlistId) => muralData.tierlists[tierlistId]}
                  />
                ) : isSelf ? (
                  <EmptyState
                    icon={MuralsIcon}
                    title={mural ? "Your mural is empty." : "No profile mural yet."}
                    body="Your mural is the first thing people see on your profile."
                    action={
                      <Link to={mural ? `/dashboard/murals/${mural.id}` : "/dashboard/murals"} className="rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-white">
                        {mural ? "Edit mural" : "Create a mural"}
                      </Link>
                    }
                  />
                ) : (
                  <MuralCanvas mural={profileOnlyMural()} editMode={false} books={[]} images={[]} profile={user} />
                )}
              </div>
              <h2 className="mb-3 text-[11px] font-semibold tracking-wider text-(--color-text-dim) uppercase">Published</h2>
              {publishedRows.length === 0 ? (
                <EmptyState title="Nothing published yet." body="Tier lists and tournaments show up here." />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {publishedRows.map((row) => (
                    <Link
                      key={`${row.kind}:${row.target}`}
                      to={row.target}
                      className="group flex items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) px-4 py-3.5 transition-colors hover:border-(--color-accent)"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold tracking-wider text-(--color-accent) uppercase">{row.kind}</span>
                        <span className="block truncate font-semibold">{row.name}</span>
                        <span className="block text-sm text-(--color-text-dim)">{row.detail}</span>
                      </span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-(--color-text-dim) transition-transform group-hover:translate-x-0.5" aria-hidden>
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </Link>
                  ))}
                </div>
              )}
            </>
          );
        }}
      </SwipeTabs>
    </div>
  );
}

const PROFILE_TABS = [
  { value: "mural", label: "Mural" },
  { value: "activity", label: "Activity" },
  { value: "library", label: "Library" }
] as const;

type ProfileTab = (typeof PROFILE_TABS)[number]["value"];

function PrivateProfileState() {
  return <EmptyState icon={CommunityIcon} title="This profile is private." body="Only published profiles are visible in the community." />;
}

function UnpublishedOwnProfile({
  busy,
  error,
  onPublish
}: {
  busy: boolean;
  error: string | null;
  onPublish: (muralId: string) => void;
}) {
  const { data: murals } = useMurals();
  const [muralId, setMuralId] = useState<string>("");
  const effectiveId = muralId || murals?.[0]?.id || "";
  return (
    <div className="mx-auto max-w-md text-center">
      <EmptyState icon={CommunityIcon} title="Your profile isn't published." body="Publish one of your murals to appear in the community." />
      {error && <p className="mb-3 text-sm text-(--color-danger)">{error}</p>}
      <div className="flex items-center justify-center gap-2">
        <select
          value={effectiveId}
          onChange={(e) => setMuralId(e.target.value)}
          aria-label="Mural to publish"
          className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
        >
          {(murals ?? []).map((mural) => (
            <option key={mural.id} value={mural.id}>
              {mural.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => effectiveId && onPublish(effectiveId)}
          disabled={!effectiveId || busy}
          className="rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Publishing…" : "Publish profile"}
        </button>
      </div>
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
  onSwitch,
  onUnpublish,
  onSaveSettings
}: {
  busy: boolean;
  currentMuralId: string | null;
  feedSettings?: FeedSettings;
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
          <p className={sectionLabel}>Profile mural</p>
          <div className="flex items-center gap-2 px-3">
            <select
              value={muralId}
              onChange={(e) => setMuralId(e.target.value)}
              aria-label="Profile mural"
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
        </Sheet>
      )}
    </>
  );
}

function FollowControls({
  busy,
  following,
  onToggle
}: {
  busy: boolean;
  following: boolean;
  onToggle: (next: "follow" | "unfollow") => void;
}) {
  return (
    <button
      onClick={() => onToggle(following ? "unfollow" : "follow")}
      disabled={busy}
      className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold disabled:opacity-50 ${
        following ? "border-(--color-border) text-(--color-text-dim)" : "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)"
      }`}
    >
      {busy ? "…" : following ? "Following" : "Follow"}
    </button>
  );
}
