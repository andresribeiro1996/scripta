import { useMemo, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { bookKey, digestTarget, participationLead, plural, savedContentRef, type DigestItem } from "@scripta/shared";
import { contentDetail, feedEventLabel, feedPrimaryLabel, feedRowAccessibilityLabel, feedRowModel, feedShareTarget, hasActivityThread, reactionCount, readingShelfBook, relativeTime, type FeedIconName } from "@scripta/shared/community";
import type { FeedActions } from "../../hooks/useFeedActions";
import { bookHref } from "../../lib/libraryView";
import { CommentsSheet } from "./CommentsSheet";
import { BookCover } from "../book/BookCover";
import { AuthorAvatar } from "../CommunityAuthorAvatar";
import { ReaderGlyph } from "../ReaderGlyph";
import { CARD } from "../page/surfaceClasses";
import { ArenaIcon, CollectionsIcon, CommunityIcon, LibraryIcon, MuralsIcon } from "../NavIcons";
import { MuralThumb } from "../murals/MuralThumb";
import { ShareIcon } from "../Toolbar";
import { useLocale } from "../../i18n";

const ICONS: Record<FeedIconName, ComponentType<{ size?: number }>> = {
  tierlist: CollectionsIcon,
  champion: ArenaIcon,
  arena: ArenaIcon,
  vote: ArenaIcon,
  book: LibraryIcon,
  follow: CommunityIcon,
  bracket: ArenaIcon,
  murals: MuralsIcon
};

const PREVIEW_LINK = "group shrink-0";
const TILE = "relative block h-27 w-30 shrink-0 rounded-xl";

const ACTION = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 hover:bg-(--color-surface-hover) disabled:opacity-50";
const MUTED = "text-(--color-text-dim) hover:text-(--color-text)";
const ACTIVE = "text-(--color-accent)";

function GlyphIcon({ path, filled = false }: { path: string; filled?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const HEART = "M12 20.5s-7.5-4.6-9-9.2C2 8 4 5 7 5c2 0 3.5 1 5 3 1.5-2 3-3 5-3 3 0 5 3 4 6.3-1.5 4.6-9 9.2-9 9.2Z";
const BUBBLE = "M4 5h16v11H9l-5 4Z";
const BOOKMARK = "M6 3.5h12v17l-6-4-6 4Z";

function Cover({ url, title, width }: { url: string | null | undefined; title?: string; width: number }) {
  const book = useMemo(() => (url ? { _coverUrl: url } : {}), [url]);
  return <BookCover book={book} title={title} width={width} />;
}

function TournamentTile({ covers }: { covers: string[] }) {
  return (
    <span className={`${TILE} bg-(--color-accent-soft) text-(--color-accent)`}>
      {covers[0] ? <span className="absolute top-3.5 left-3.5 -rotate-7"><Cover url={covers[0]} width={40} /></span> : null}
      {covers[1] ? <span className="absolute right-3.5 bottom-3.5 rotate-7"><Cover url={covers[1]} width={40} /></span> : null}
      <span className="absolute inset-x-0 top-11 text-center text-[13px] font-extrabold">VS</span>
    </span>
  );
}

function QuizTile({ covers }: { covers: string[] }) {
  return (
    <span className={`${TILE} bg-(--color-reference-soft) text-(--color-reference)`}>
      {covers[0] ? <span className="absolute top-5.5 left-4.5 -rotate-8"><Cover url={covers[0]} width={40} /></span> : null}
      {covers[1] ? <span className="absolute top-5 left-10 rotate-6"><Cover url={covers[1]} width={40} /></span> : null}
      <span className="absolute right-3 bottom-3 flex size-8 items-center justify-center rounded-full bg-(--color-reference) text-lg font-extrabold text-(--color-surface)">?</span>
    </span>
  );
}

function Preview({ item, covers }: { item: DigestItem; covers: string[] }) {
  const locale = useLocale();
  if (item.kind === "reading" || item.kind === "completion") {
    const book = item.kind === "reading" ? item.book : item.winner;
    return <Cover url={book.coverUrl} title={book.title} width={72} />;
  }
  const game = item.kind === "publication" || item.kind === "vote" ? item.content.kind : item.kind === "participation" ? item.game.kind : null;
  if (game === "tournament") return <TournamentTile covers={covers} />;
  if (game === "quiz") return <QuizTile covers={covers} />;
  const Icon = ICONS[feedRowModel(item, locale).icon];
  return <span className="flex h-18 w-12 shrink-0 items-center justify-center rounded-lg bg-(--color-accent-soft) text-(--color-accent)"><Icon size={22} /></span>;
}

export function FeedCard({ item, actions, books, works, isSaved }: { item: DigestItem; actions: FeedActions; books: Array<Record<string, unknown>>; works: Record<string, string> | undefined; isSaved?: boolean }) {
  const locale = useLocale();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const row = feedRowModel(item, locale);
  const target = digestTarget(item);
  const primary = feedPrimaryLabel(item, locale);
  const actor = item.kind === "participation" ? item.actors[0] : item.actor;
  const name = item.kind === "participation" ? participationLead(item, locale) : item.kind === "completion" ? feedEventLabel(item, locale) : item.actor.username;
  const profile = actor && !actor.unavailable && item.kind !== "participation" && item.kind !== "completion" ? `/community/u/${actor.username}` : null;
  const title = row.title || (item.kind === "vote" ? item.content.name : "");
  const detail = item.kind === "vote" ? contentDetail(item.content, locale) : row.detail;
  const covers = item.kind === "vote" ? item.content.covers : row.covers;
  const link = "inline-flex min-h-11 items-center font-semibold text-(--color-accent)";
  const ref = savedContentRef(item);
  const saved = isSaved ?? (ref ? actions.saved.has(`${ref.kind}:${ref.id}`) : false);
  const engagement = actions.engagement[item.id];
  const likes = reactionCount(engagement?.likes);
  const comments = reactionCount(engagement?.comments);
  const threaded = hasActivityThread(item);
  const shareable = feedShareTarget(item) !== null;
  const owned = item.kind === "reading" ? readingShelfBook(item.book, books) : undefined;
  const wantable = item.kind === "reading" && !owned;
  const action = primary ? <Link to={target} className={link}>{primary} →</Link> : null;

  return (
    <article aria-label={feedRowAccessibilityLabel(item, locale)} className={`${CARD} px-4.5 pt-4 pb-2`}>
      <div className="flex items-center gap-3">
        {actor ? <AuthorAvatar author={actor} size={36} /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) text-(--color-accent)"><CommunityIcon size={18} /></span>}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1 font-bold">
            {profile ? <Link to={profile} className="-my-3 block min-w-0 truncate leading-11 hover:text-(--color-accent)">{name}</Link> : <span className="min-w-0 truncate">{name}</span>}
            {item.kind === "participation" ? null : <ReaderGlyph identity={actor?.readerGlyph} />}
          </span>
          {item.kind === "completion" ? null : <span className="text-(--color-text-dim)">{feedEventLabel(item, locale)}</span>}
        </span>
        <span className="shrink-0 text-(--color-text-dim)">{relativeTime(item.createdAt, locale)}</span>
      </div>

      {item.kind === "follow" ? null : item.kind === "mural" ? (
        <>
          <Link to={target} tabIndex={-1} aria-hidden="true" className="mt-3.5 block aspect-[16/6] overflow-hidden rounded-xl border border-(--color-border)">
            <MuralThumb theme={item.mural.theme} coverUrl={item.mural.coverImageUrl} className="size-full" />
          </Link>
          <span className="flex flex-col items-start gap-1 pt-1">
            {title ? <Link to={target} className="flex min-h-11 items-center font-display text-[22px] leading-7 font-bold break-words hover:text-(--color-accent)">{title}</Link> : null}
            {action}
          </span>
        </>
      ) : (
        <div className={`mt-3.5 flex items-center gap-4.5 ${primary ? "" : "pb-2"}`}>
          <Link to={target} tabIndex={-1} aria-hidden="true" className={PREVIEW_LINK}>
            <Preview item={item} covers={covers} />
          </Link>
          <span className="flex min-w-0 flex-col items-start gap-1">
            {title ? <Link to={target} className="flex min-h-11 items-center font-display text-[22px] leading-7 font-bold break-words hover:text-(--color-accent)">{title}</Link> : null}
            {detail ? <span className="text-(--color-text-dim)">{detail}</span> : null}
            {action}
            {owned ? <Link to={bookHref(bookKey(owned), works)} className={link}>Open in your shelf →</Link> : null}
          </span>
        </div>
      )}

      {threaded || ref || wantable || shareable ? (
        <div className="-mx-3 mt-1 flex flex-wrap items-center gap-1">
          {threaded ? (
            <>
              <button type="button" aria-label={engagement ? `Like, ${plural(engagement.likes, "like", "likes")}` : "Like"} aria-pressed={engagement?.liked ?? false} disabled={!engagement || actions.busy.like} onClick={() => actions.like(item)} className={`${ACTION} ${engagement?.liked ? ACTIVE : MUTED}`}>
                <GlyphIcon path={HEART} filled={engagement?.liked} />
                {likes ? <span className="tabular-nums">{likes}</span> : null}
              </button>
              <button type="button" aria-label={engagement ? `Comments, ${engagement.comments}` : "Comments"} aria-haspopup="dialog" onClick={() => setCommentsOpen(true)} className={`${ACTION} ${MUTED}`}>
                <GlyphIcon path={BUBBLE} />
                {comments ? <span className="tabular-nums">{comments}</span> : null}
              </button>
            </>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            {ref ? (
              <button type="button" aria-label="Save" aria-pressed={saved} disabled={actions.busy.save || (isSaved === undefined && !actions.savedReady)} onClick={() => actions.save(item, !saved)} className={`${ACTION} ${saved ? ACTIVE : MUTED}`}>
                <GlyphIcon path={BOOKMARK} filled={saved} />
              </button>
            ) : null}
            {wantable ? (
              <button type="button" className={`${ACTION} ${MUTED}`} disabled={actions.wanting !== null} onClick={() => actions.wantToRead(item)}>{actions.wanting === item.id ? "Adding…" : "Want to read"}</button>
            ) : null}
            {shareable ? (
              <button type="button" aria-label={`Share ${title || "reader"}`} onClick={() => actions.share(item)} className={`${ACTION} ${MUTED}`}>
                <ShareIcon />Share
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {commentsOpen ? <CommentsSheet id={item.id} title={title || name} onClose={() => setCommentsOpen(false)} /> : null}
    </article>
  );
}
