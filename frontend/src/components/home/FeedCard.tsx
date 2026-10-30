import { useMemo, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { digestTarget, participationLead, type DigestItem } from "@scripta/shared";
import { contentDetail, feedEventLabel, feedPrimaryLabel, feedRowAccessibilityLabel, feedRowModel, relativeTime, type FeedIconName } from "@scripta/shared/community";
import { BookCover } from "../book/BookCover";
import { AuthorAvatar } from "../CommunityAuthorAvatar";
import { ReaderGlyph } from "../ReaderGlyph";
import { CARD } from "../page/surfaceClasses";
import { ArenaIcon, CollectionsIcon, CommunityIcon, LibraryIcon, MuralsIcon } from "../NavIcons";

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
const TILE = "relative h-27 w-30 shrink-0 rounded-xl";

function Cover({ url, title, author, width }: { url: string | null | undefined; title?: string; author?: string; width: number }) {
  const book = useMemo(() => ({ Title: title, Attribution: author, _coverUrl: url ?? undefined }), [title, author, url]);
  return <BookCover book={book} title="Book" width={width} />;
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
  if (item.kind === "reading" || item.kind === "completion") {
    const book = item.kind === "reading" ? item.book : item.winner;
    return <Cover url={book.coverUrl} title={book.title} author={book.author} width={72} />;
  }
  const game = item.kind === "publication" || item.kind === "vote" ? item.content.kind : item.kind === "participation" ? item.game.kind : null;
  if (game === "tournament") return <TournamentTile covers={covers} />;
  if (game === "quiz") return <QuizTile covers={covers} />;
  const Icon = ICONS[feedRowModel(item).icon];
  return <span className="flex h-18 w-12 shrink-0 items-center justify-center rounded-lg bg-(--color-accent-soft) text-(--color-accent)"><Icon size={22} /></span>;
}

export function FeedCard({ item }: { item: DigestItem }) {
  const row = feedRowModel(item);
  const target = digestTarget(item);
  const primary = feedPrimaryLabel(item);
  const actor = item.kind === "participation" ? item.actors[0] : item.actor;
  const name = item.kind === "participation" ? participationLead(item) : item.kind === "completion" ? feedEventLabel(item) : item.actor.username;
  const profile = actor && !actor.unavailable && item.kind !== "participation" && item.kind !== "completion" ? `/community/u/${actor.username}` : null;
  const title = row.title || (item.kind === "vote" ? item.content.name : "");
  const detail = item.kind === "vote" ? contentDetail(item.content) : row.detail;
  const covers = item.kind === "vote" ? item.content.covers : row.covers;
  const link = "inline-flex min-h-11 items-center font-semibold text-(--color-accent)";
  const action = primary ? <Link to={target} className={link}>{primary} →</Link> : null;

  return (
    <article aria-label={feedRowAccessibilityLabel(item)} className={`${CARD} px-4.5 pt-4 pb-2`}>
      <div className="flex items-center gap-3">
        {actor ? <AuthorAvatar author={actor} size={36} /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) text-(--color-accent)"><CommunityIcon size={18} /></span>}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1 font-bold">
            {profile ? <Link to={profile} className="-my-3 block min-w-0 truncate leading-11 hover:text-(--color-accent)">{name}</Link> : <span className="min-w-0 truncate">{name}</span>}
            {item.kind === "participation" ? null : <ReaderGlyph identity={actor?.readerGlyph} />}
          </span>
          {item.kind === "completion" ? null : <span className="text-(--color-text-dim)">{feedEventLabel(item)}</span>}
        </span>
        <span className="shrink-0 text-(--color-text-dim)">{relativeTime(item.createdAt)}</span>
      </div>

      {item.kind === "follow" ? null : item.kind === "mural" ? (
        <>
          <Link to={target} tabIndex={-1} aria-hidden="true" className="mt-3.5 flex aspect-[16/6] items-center justify-center overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-hover) text-(--color-accent)">
            {item.mural.coverImageUrl ? <img src={item.mural.coverImageUrl} alt="" className="size-full object-cover" /> : <MuralsIcon size={36} />}
          </Link>
          {action}
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
          </span>
        </div>
      )}
    </article>
  );
}
