import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { PersonResult } from "@scripta/shared/community";
import { AuthorAvatar } from "../components/CommunityAuthorAvatar";
import { EmptyState } from "../components/EmptyState";
import { CommunityIcon } from "../components/NavIcons";
import { SkeletonCardGrid } from "../components/Skeleton";
import { followUser, unfollowUser } from "../api/community";
import { useCommunityPeople } from "../hooks/useCommunity";

const searchInput =
  "mb-3 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm outline-none focus:border-(--color-accent)";

function retryButton(refetch: () => void) {
  return (
    <button onClick={() => void refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">
      Retry
    </button>
  );
}

export function PeoplePage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="mb-6 text-lg font-bold">People</h2>
      <PeoplePane />
    </div>
  );
}

function PeoplePane() {
  const [search, setSearch] = useState("");
  const needle = search.trim();
  const { people, isLoading, error, refetch } = useCommunityPeople(needle);
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(person: PersonResult) {
    setBusyId(person.user.userId);
    try {
      if (person.viewerFollows) await unfollowUser(person.user.userId);
      else await followUser(person.user.userId);
      await queryClient.invalidateQueries({ queryKey: ["community", "people"] });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by username" aria-label="Search people by username" className={searchInput} />
      {needle.length === 0 && <EmptyState icon={CommunityIcon} title="Find people." body="Search a username to follow them." />}
      {needle.length > 0 && isLoading && <SkeletonCardGrid count={2} label="Searching" tileClassName="min-h-[72px]" />}
      {needle.length > 0 && !isLoading && error && <EmptyState title="Couldn't search." action={retryButton(refetch)} />}
      {needle.length > 0 && !isLoading && !error && people.length === 0 && <EmptyState title="No people found." body="Try another username." />}
      {needle.length > 0 && !isLoading && !error && people.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          {people.map((person) => (
            <div key={person.user.userId} className="flex items-center justify-between gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
              <Link to={`/community/u/${person.user.username}`} className="flex items-center gap-2">
                <AuthorAvatar author={person.user} size={32} />
                <span>
                  <span className="block text-sm font-semibold">{person.user.username}</span>
                  <span className="block text-xs text-(--color-text-dim)">
                    {person.followerCount} {person.followerCount === 1 ? "follower" : "followers"}
                  </span>
                </span>
              </Link>
              <button
                onClick={() => void toggle(person)}
                disabled={busyId === person.user.userId}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                  person.viewerFollows ? "border-(--color-border) text-(--color-text-dim)" : "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)"
                }`}
              >
                {busyId === person.user.userId ? "…" : person.viewerFollows ? "Following" : "Follow"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
