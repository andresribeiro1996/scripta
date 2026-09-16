import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { contentDetail, contentKindLabel, contentTarget } from "@scripta/shared/community";
import { followUser, publishProfile, unfollowUser, unpublishProfile } from "../api/community";
import type { GalleryImage } from "../api/gallery";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { CommunityIcon } from "../components/NavIcons";
import { MuralCanvas } from "../components/murals/MuralCanvas";
import { SkeletonCardGrid } from "../components/Skeleton";
import { useCommunityProfile } from "../hooks/useCommunity";
import { useHome } from "../hooks/useHome";
import { useMurals } from "../hooks/useMurals";
import { ensureBookBlockHeights, type Mural } from "../lib/murals";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <EmptyState icon={CommunityIcon} title="Not published." body="This reader hasn't published a profile." />
        )}
      </div>
    );
  }

  if (!view) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState title="Profile unavailable." body="Couldn't load this profile." action={retryButton(refetch)} />
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

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {view.profile.user.avatarUrl ? (
            <img src={view.profile.user.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-(--color-accent-soft) text-lg font-bold text-(--color-accent)">
              {view.profile.user.username.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span>
            <span className="block text-lg font-bold">{view.profile.user.username}</span>
            <span className="block text-sm text-(--color-text-dim)">
              {view.profile.followerCount} {view.profile.followerCount === 1 ? "follower" : "followers"} · {view.profile.followingCount} following
            </span>
          </span>
        </div>
        {isSelf ? (
          <OwnerControls
            busy={busy}
            currentMuralId={muralData?.mural.id ?? null}
            onSwitch={(muralId) => run(async () => void (await publishProfile(muralId)))}
            onUnpublish={() => run(async () => void (await unpublishProfile()))}
          />
        ) : (
          <FollowControls
            busy={busy}
            following={view.profile.viewerFollows === true}
            onToggle={(next) =>
              run(async () => {
                if (next === "unfollow") await unfollowUser(view.profile.user.userId);
                else await followUser(view.profile.user.userId);
              })
            }
          />
        )}
      </div>
      {error && <p className="mb-4 text-sm text-(--color-danger)">{error}</p>}
      {mural && mural.blocks.length > 0 && muralData && (
        <div className="mb-8">
          <MuralCanvas
            mural={mural}
            editMode={false}
            books={books}
            images={images}
            profile={view.profile.user}
            shelfThemeOverride={muralData.library.shelfTheme}
            statsOverride={muralData.library.stats}
            tierlistData={(tierlistId) => muralData.tierlists[tierlistId]}
          />
        </div>
      )}
      <h3 className="mb-3 text-lg font-bold">Published</h3>
      {publishedRows.length === 0 ? (
        <EmptyState title="Nothing published yet." body="Tier lists and tournaments show up here." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {publishedRows.map((row) => (
            <Link key={`${row.kind}:${row.target}`} to={row.target} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)">
              <p className="text-xs font-semibold text-(--color-accent)">{row.kind}</p>
              <h4 className="font-semibold">{row.name}</h4>
              <p className="text-sm text-(--color-text-dim)">{row.detail}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
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
  const { data: homeMural } = useHome();
  const [muralId, setMuralId] = useState<string>("");
  const effectiveId = muralId || homeMural?.id || murals?.[0]?.id || "";
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

function OwnerControls({
  busy,
  currentMuralId,
  onSwitch,
  onUnpublish
}: {
  busy: boolean;
  currentMuralId: string | null;
  onSwitch: (muralId: string) => void;
  onUnpublish: () => void;
}) {
  const { data: murals } = useMurals();
  const [confirming, setConfirming] = useState(false);
  const [muralId, setMuralId] = useState<string>(currentMuralId ?? "");
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <select
          value={muralId}
          onChange={(e) => setMuralId(e.target.value)}
          aria-label="Profile mural"
          className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
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
          className="rounded-lg border border-(--color-border) px-3 py-2 text-sm hover:border-(--color-accent) disabled:opacity-50"
        >
          {busy ? "Working…" : "Switch mural"}
        </button>
      </div>
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--color-text-dim)">Hide your profile?</span>
          <button onClick={onUnpublish} disabled={busy} className="rounded-lg bg-(--color-danger) px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            Unpublish
          </button>
          <button onClick={() => setConfirming(false)} className="text-xs text-(--color-text-dim) hover:text-(--color-text)">
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className="text-xs text-(--color-text-dim) hover:text-(--color-text)">
          Unpublish profile
        </button>
      )}
    </div>
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
