import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { contentDetail, contentKindLabel, contentTarget } from "@scripta/shared/community";
import { followUser, unfollowUser } from "../api/community";
import type { GalleryImage } from "../api/gallery";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { CommunityIcon } from "../components/NavIcons";
import { MuralCanvas } from "../components/murals/MuralCanvas";
import { OwnShelfView } from "../components/OwnShelfView";
import { ProfileActivity } from "../components/ProfileActivity";
import { PublicLibraryGrid } from "../components/PublicLibraryGrid";
import { SkeletonCardGrid } from "../components/Skeleton";
import { SwipeTabs } from "../components/SwipeTabs";
import { useCommunityActivity, useCommunityLibrary, useCommunityProfile } from "../hooks/useCommunity";
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
  const { view, isLoading, isNotFound } = useCommunityProfile(username ?? "");
  const activity = useCommunityActivity(username ?? "");
  const library = useCommunityLibrary(username ?? "", Boolean(view));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>("mural");

  const isOwnHandle = Boolean(username) && session?.user.username === username;

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

  if (isOwnHandle) {
    return <OwnShelfView username={username ?? ""} />;
  }

  if (!session || isLoading || (!view && !isNotFound && !error)) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <SkeletonCardGrid count={2} label="Loading profile" tileClassName="min-h-[120px]" />
      </div>
    );
  }

  if (isNotFound || !view) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <PrivateProfileState />
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
