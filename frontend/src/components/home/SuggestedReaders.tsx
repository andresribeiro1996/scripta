import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { followFailureMessage, suggestionReason } from "@scripta/shared/community";
import { followUser } from "../../api/community";
import { invalidateAfterFollow, useSuggestedPeople } from "../../hooks/useCommunity";
import { AuthorAvatar } from "../CommunityAuthorAvatar";
import { ReaderGlyph } from "../ReaderGlyph";
import { BUTTON_SECONDARY } from "../page/buttonClasses";
import { LIST_ROW, PANEL, PANEL_HEADER, PANEL_HEADING } from "../page/surfaceClasses";
import { useLocale, useT } from "../../i18n";

export function SuggestedReaders() {
  const locale = useLocale();
  const t = useT();
  const { people, error: loadError, refetch } = useSuggestedPeople(true);
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readers = people.slice(0, 3);
  if (readers.length === 0 && !loadError) return null;

  async function follow(userId: string) {
    setBusyId(userId);
    setError(null);
    try {
      await followUser(userId);
      await invalidateAfterFollow(queryClient);
    } catch (failure) {
      setError(followFailureMessage(failure, t("book.followFailed")));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="home-suggested" className={`${PANEL} overflow-hidden`}>
      <div className={PANEL_HEADER}>
        <h2 id="home-suggested" className={PANEL_HEADING}>{t("book.readersYouMightLike")}</h2>
        <Link to="/community/people" className="inline-flex min-h-11 shrink-0 items-center font-semibold text-(--color-accent)">{t("book.seeAll")}</Link>
      </div>
      {readers.length === 0 ? (
        <div role="alert" className="space-y-3 px-4.5 py-3">
          <p>{t("book.suggestionsLoadFailed")}</p>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => void refetch()}>{t("library.retry")}</button>
        </div>
      ) : null}
      <ul className="divide-y divide-(--color-border)">
        {readers.map((reader) => (
          <li key={reader.user.userId} className={LIST_ROW}>
            <Link to={`/community/u/${reader.user.username}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
              <AuthorAvatar author={reader.user} size={40} />
              <span className="min-w-0">
                <span className="flex items-center gap-1 font-bold">
                  <span className="truncate">{reader.user.username}</span>
                  <ReaderGlyph identity={reader.user.readerGlyph} />
                </span>
                <span className="block text-xs text-(--color-text-dim)">{suggestionReason(reader, locale)}</span>
              </span>
            </Link>
            <button type="button" aria-label={t("book.followAria", { name: reader.user.username })} className={`${BUTTON_SECONDARY} shrink-0`} disabled={busyId === reader.user.userId} onClick={() => void follow(reader.user.userId)}>{t("book.follow")}</button>
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="px-4.5 py-3 text-sm text-(--color-danger)">{error}</p> : null}
    </section>
  );
}
