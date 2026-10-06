import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FINISH_FEELINGS, editionLabel, gameOwnerLabel, readerCountsLabel, readerStatusLabel, summaryPreview, type WorkGameRef, type WorkPage, type WorkReader } from "@scripta/shared";
import { AuthorAvatar } from "../CommunityAuthorAvatar";
import { CoverImage } from "../BookCard";
import { ReaderGlyph } from "../ReaderGlyph";
import { ChevronLeftIcon } from "../Toolbar";

const rowClass = "flex items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-4";
const sectionHeading = "mb-3 text-lg font-bold";
const backClass = "mb-2 inline-flex items-center gap-1 text-xs text-(--color-text-dim) hover:text-(--color-text)";

export function WorkPageView({ page, signedIn, backTo, onBack, onAdd, onShare }: { page: WorkPage; signedIn: boolean; backTo: string; onBack: (() => void) | null; onAdd: () => void; onShare: () => void }) {
  const { work, mine, readers, games } = page;
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutPreview = work.summary ? summaryPreview(work.summary) : null;
  const feeling = mine?.rating ? FINISH_FEELINGS.find((f) => f.rating === mine.rating)?.label ?? null : null;
  const gameRows: Array<[string, WorkGameRef[]]> = [["Tier list", games.tierlists], ["Tournament", games.arenas], ["Quiz", games.quizzes]];
  const anyGame = gameRows.some(([, list]) => list.length > 0);
  const isbn = work.editions.find((edition) => edition.isbn)?.isbn;
  const coverBook = useMemo(
    () => ({ Title: work.title, Attribution: work.author, ISBN: isbn ?? undefined, _coverUrl: work.coverUrl ?? undefined }),
    [work.title, work.author, isbn, work.coverUrl]
  );
  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      {onBack ? (
        <button type="button" onClick={onBack} className={backClass}>
          <ChevronLeftIcon size={13} />
          Back
        </button>
      ) : (
        <Link to={backTo} className={backClass}>
          <ChevronLeftIcon size={13} />
          Back
        </Link>
      )}
      <header className="mb-8 flex flex-col gap-5 sm:flex-row">
        <div className="relative aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-xl bg-(--color-border)">
          <CoverImage book={coverBook} size="full" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{work.title}</h1>
          <p className="mt-1 text-sm text-(--color-text-dim)">{work.author}</p>
          <button
            type="button"
            onClick={onShare}
            className="mt-4 min-h-11 rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)"
          >
            Share
          </button>
          {work.summary ? (
            <section className="mt-6">
              <h2 className={sectionHeading}>About this book</h2>
              <p className="text-sm leading-6 whitespace-pre-wrap break-words">{aboutOpen || !aboutPreview ? work.summary : aboutPreview}</p>
              {aboutPreview ? (
                <button type="button" aria-expanded={aboutOpen} onClick={() => setAboutOpen(!aboutOpen)} className="min-h-11 text-sm font-semibold text-(--color-accent)">
                  {aboutOpen ? "Show less" : "Show more"}
                </button>
              ) : null}
            </section>
          ) : null}
          <section className="mt-6">
            <h2 className={sectionHeading}>Editions</h2>
            <ul className="flex flex-col gap-2">
              {work.editions.map((e) => (
                <li key={e.bookId} className="text-sm">
                  <span className="font-semibold">{e.title}</span>
                  <span className="text-(--color-text-dim)"> · {editionLabel(e)}{e.mine ? " · Yours" : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </header>
      <section className="mb-8">
        <h2 className={sectionHeading}>Your copy</h2>
        {mine ? (
          <p className={`${rowClass} text-sm`}>
            {readerStatusLabel(mine.readStatus)}{feeling ? ` · ${feeling}` : ""} · {mine.highlightCount} {mine.highlightCount === 1 ? "highlight" : "highlights"}
          </p>
        ) : (
          <div className={`${rowClass} justify-between`}>
            <p className="text-sm text-(--color-text-dim)">Not in your library</p>
            <button
              type="button"
              onClick={onAdd}
              className="min-h-11 shrink-0 rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-semibold text-(--color-on-accent) hover:opacity-90"
            >
              Add to library
            </button>
          </div>
        )}
      </section>
      <section className="mb-8">
        <h2 className={sectionHeading}>Readers</h2>
        <p className="mb-3 text-sm text-(--color-text-dim)">{readerCountsLabel(readers.counts)}</p>
        {readers.followed.length > 0 ? <ReaderList title="People you follow" readers={readers.followed} signedIn={signedIn} /> : null}
        {readers.others.length > 0 ? <ReaderList title={signedIn ? "Other readers" : "Readers"} readers={readers.others} signedIn={signedIn} /> : null}
      </section>
      <section>
        <h2 className={sectionHeading}>Games</h2>
        {anyGame ? (
          <div className="grid grid-cols-1 gap-3">
            {gameRows.map(([kind, list]) =>
              list.map((game) => (
                <Link key={`${kind}-${game.id}`} to={game.path} className={`${rowClass} justify-between hover:border-(--color-accent)`}>
                  <span className="min-w-0 truncate text-sm font-semibold">{game.name}</span>
                  <span className="shrink-0 text-xs text-(--color-text-dim)">{kind} · {gameOwnerLabel(game.owner)}</span>
                </Link>
              ))
            )}
          </div>
        ) : (
          <p className="text-sm text-(--color-text-dim)">No public games use this book yet.</p>
        )}
      </section>
    </main>
  );
}

function ReaderList({ title, readers, signedIn }: { title: string; readers: WorkReader[]; signedIn: boolean }) {
  return (
    <div className="mb-4">
      <h3 className="mb-3 text-sm font-semibold text-(--color-text-dim)">{title}</h3>
      <ul className="grid grid-cols-1 gap-3">
        {readers.map((reader) => {
          const body = (
            <>
              <AuthorAvatar author={{ ...reader, userId: reader.username }} size={32} />
              <span className="flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold">
                <span className="truncate">{reader.username}</span>
                <ReaderGlyph identity={reader.readerGlyph} />
              </span>
              <span className="shrink-0 text-xs text-(--color-text-dim)">{readerStatusLabel(reader.readStatus)}</span>
            </>
          );
          return (
            <li key={reader.username}>
              {signedIn && reader.published ? (
                <Link to={`/community/u/${reader.username}`} className={`${rowClass} hover:border-(--color-accent)`}>{body}</Link>
              ) : (
                <div className={rowClass}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
