import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { followFailureMessage, personCaption, type PersonResult, type SuggestedReader } from "@scripta/shared/community";
import { AuthorAvatar } from "../components/CommunityAuthorAvatar";
import { EmptyState } from "../components/EmptyState";
import { CommunityIcon } from "../components/NavIcons";
import { ReaderGlyph } from "../components/ReaderGlyph";
import { Page } from "../components/page/Page";
import { SkeletonCardGrid } from "../components/Skeleton";
import { followUser, unfollowUser } from "../api/community";
import { invalidateAfterFollow, useCommunityPeople, useSuggestedPeople } from "../hooks/useCommunity";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { area } from "../lib/areas";
import { BUTTON_SECONDARY } from "../components/page/buttonClasses";
import { LIST_PANEL, LIST_ROW, PANEL, PANEL_HEADING } from "../components/page/surfaceClasses";
import { SearchField, ToolbarRow } from "../components/Toolbar";
import { useLocale } from "../i18n";

function retryButton(refetch: () => void) {
  return (
    <button onClick={() => void refetch()} className={BUTTON_SECONDARY}>
      Retry
    </button>
  );
}

export function PeoplePage() {
  return (
    <Page width="wide" title="Community" subtitle="Find readers and follow them to see what they are up to." tabs={area("community").tabs}>
      <PeoplePane />
    </Page>
  );
}

function PeoplePane() {
  const [search, setSearch] = useState("");
  const needle = useDebouncedValue(search.trim(), 300);
  const { people, isLoading, error, refetch } = useCommunityPeople(needle);
  const suggested = useSuggestedPeople(needle.length === 0);
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);

  async function toggle(person: PersonResult) {
    setBusyId(person.user.userId);
    setFollowError(null);
    try {
      if (person.viewerFollows) await unfollowUser(person.user.userId);
      else await followUser(person.user.userId);
      await invalidateAfterFollow(queryClient);
    } catch (error) {
      setFollowError(followFailureMessage(error, "Couldn't update who you follow."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <ToolbarRow>
        <SearchField value={search} onChange={setSearch} placeholder="Search by username" label="Search people by username" />
      </ToolbarRow>
      {followError && (
        <p role="alert" className="mb-3 text-sm text-(--color-danger)">
          {followError}
        </p>
      )}
      {needle.length === 0 &&
        (suggested.people.length > 0 ? (
          <>
            <h2 className={`${PANEL_HEADING} mb-3`}>Readers you might like</h2>
            <PersonCards people={suggested.people} busyId={busyId} onToggle={toggle} />
          </>
        ) : suggested.error ? (
          <EmptyState title="Couldn't load suggestions." action={retryButton(suggested.refetch)} />
        ) : (
          <EmptyState icon={CommunityIcon} title="Find people." body="Search a username to follow them." />
        ))}
      {needle.length > 0 && isLoading && <SkeletonCardGrid count={2} label="Searching" tileClassName="min-h-[72px]" />}
      {needle.length > 0 && !isLoading && error && <EmptyState title="Couldn't search." action={retryButton(refetch)} />}
      {needle.length > 0 && !isLoading && !error && people.length === 0 && <EmptyState title="No people found." body="Try another username." />}
      {needle.length > 0 && !isLoading && !error && people.length > 0 && <PersonList people={people} busyId={busyId} onToggle={toggle} />}
    </div>
  );
}

function SharedCover({ src }: { src: string | null }) {
  const className = "h-9 w-6 rounded-[3px] ring-2 ring-(--color-surface)";
  return src ? <img src={src} alt="" loading="lazy" className={`${className} object-cover`} /> : <span className={`${className} bg-(--color-border)`} />;
}

function FollowButton({ person, busy, onToggle }: { person: PersonResult; busy: boolean; onToggle: (person: PersonResult) => Promise<void> }) {
  const label = person.viewerFollows ? "Following" : "Follow";
  return (
    <button
      type="button"
      aria-label={`${label} ${person.user.username}`}
      onClick={() => void onToggle(person)}
      disabled={busy}
      className={`${BUTTON_SECONDARY} shrink-0`}
    >
      {busy ? "…" : label}
    </button>
  );
}

function PersonName({ person }: { person: PersonResult | SuggestedReader }) {
  const locale = useLocale();
  return (
    <span className="min-w-0">
      <span className="flex items-center gap-1 font-bold">
        <span className="truncate">{person.user.username}</span>
        <ReaderGlyph identity={person.user.readerGlyph} />
      </span>
      <span className="block text-xs text-(--color-text-dim)">{personCaption(person, locale)}</span>
    </span>
  );
}

type PersonListProps = {
  people: (PersonResult | SuggestedReader)[];
  busyId: string | null;
  onToggle: (person: PersonResult) => Promise<void>;
};

function PersonCards({ people, busyId, onToggle }: PersonListProps) {
  return (
    <ul className="grid [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))] gap-4">
      {people.map((person) => {
        const covers = "sharedCount" in person ? person.sharedBooks.slice(0, 3) : [];
        return (
          <li key={person.user.userId} className={`${PANEL} flex flex-col gap-3 p-4`}>
            <Link to={`/community/u/${person.user.username}`} className="flex min-h-11 min-w-0 items-center gap-3">
              <AuthorAvatar author={person.user} size={48} />
              <PersonName person={person} />
            </Link>
            {(covers.length > 0 || !person.private) && (
              <div className="mt-auto flex items-center justify-between gap-3">
                <span className="flex -space-x-1.5">
                  {covers.map((book, index) => (
                    <SharedCover key={`${index}:${book.coverUrl}`} src={book.coverUrl} />
                  ))}
                </span>
                {!person.private && <FollowButton person={person} busy={busyId === person.user.userId} onToggle={onToggle} />}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PersonList({ people, busyId, onToggle }: PersonListProps) {
  return (
    <ul className={LIST_PANEL}>
      {people.map((person) => (
        <li key={person.user.userId} className={LIST_ROW}>
          <Link to={`/community/u/${person.user.username}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
            <AuthorAvatar author={person.user} size={40} />
            <PersonName person={person} />
          </Link>
          {!person.private && <FollowButton person={person} busy={busyId === person.user.userId} onToggle={onToggle} />}
        </li>
      ))}
    </ul>
  );
}
