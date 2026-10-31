import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bookKey,
  bookScreenModel,
  bookStatsModel,
  coverWash,
  editionLabel,
  readSnapshot,
  seriesGroupByBookKey,
  seriesLabel,
  type BookScreenModel,
  type BookScreenReaderRow,
  type ReadSnapshot,
  type ResolvedCoverResponse,
  type WorkPage
} from "@scripta/shared";
import { themes } from "@scripta/shared/themes";
import { fetchIsAdmin, rejectSharedCover, uploadSharedCover } from "../../api/books";
import { forgetResolvedCover, rememberResolvedCover } from "../../api/covers";
import { useBookActions } from "../../hooks/useBookActions";
import { useLibrary } from "../../hooks/useLibrary";
import { useWorkStats } from "../../hooks/useWorkStats";
import { effectiveCardStyle, resolveLibraryStyle, type PerCardStyle } from "../../lib/libraryStyle";
import { useResolvedTheme } from "../../lib/theme";
import { AuthorAvatar } from "../CommunityAuthorAvatar";
import { coverParamsFor } from "../BookCard";
import { CoverPickerModal } from "../CoverPickerModal";
import { useConfirm } from "../ConfirmDialog";
import { FinishSheet } from "../FinishSheet";
import { OptionsMenu } from "../OptionsMenu";
import { PerCardStylePanel } from "../PerCardStylePanel";
import { ReaderGlyph } from "../ReaderGlyph";
import { ArenaIcon } from "../NavIcons";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../page/buttonClasses";
import { LIST_PANEL, LIST_ROW, SECTION_HEADING, TAB_NAV, tabClass } from "../page/surfaceClasses";
import { ChevronDownIcon, MoreIcon, ShareIcon, toolbarIconClass } from "../Toolbar";
import { StatsTiles } from "./BookStats";
import { BookCover, editionCoverBook } from "./BookCover";
import { EditionStrip } from "./EditionStrip";
import { RatingStars } from "./RatingStars";
import { useLocale } from "../../i18n";

type Props = {
  page: WorkPage | null;
  book: Record<string, unknown> | null;
  signedIn: boolean;
  editionId: string | null;
  onSelectEdition: (bookId: string) => void;
  onAdd: (addBook: NonNullable<BookScreenModel["addBook"]>) => void;
  onShare: (() => void) | null;
  frame: (body: ReactNode) => ReactNode;
};

const rowClass = "flex items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-4";
const pillClass = "inline-flex max-w-full items-center gap-1 rounded-full border px-2 text-xs";
const winPillClass = `${pillClass} border-(--color-accent-soft) bg-(--color-accent-soft) text-(--color-accent)`;
const nomineePillClass = `${pillClass} border-(--color-border) text-(--color-text-dim)`;
const roundButtonClass = `${toolbarIconClass()} rounded-full!`;
const statusTriggerClass = "inline-flex min-h-11 items-center gap-2 rounded-lg border border-(--color-accent) bg-(--color-accent-soft) px-4 text-sm font-semibold text-(--color-accent)";

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className={`${SECTION_HEADING} mb-3`}>{title}</h2>
      {children}
    </section>
  );
}

export function BookScreen({ page, book, signedIn, editionId, onSelectEdition, onAdd, onShare, frame }: Props) {
  const locale = useLocale();
  const { data: isAdmin = false } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity, enabled: signedIn });
  const { data: library } = useLibrary({ enabled: Boolean(book) });
  const model = bookScreenModel(page, book, { isAdmin }, locale, editionId);
  const statsQuery = useWorkStats(page?.work.id);
  const statsTiles = bookStatsModel(statsQuery.data ?? null, page?.work.rating ?? null, locale).tiles;
  const [searchParams] = useSearchParams();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [allCharacters, setAllCharacters] = useState(false);
  const [allEditions, setAllEditions] = useState(false);
  const [styling, setStyling] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  const [finishing, setFinishing] = useState<ReadSnapshot | null>(null);
  const [coverVersion, setCoverVersion] = useState(0);
  const [coverError, setCoverError] = useState<string | null>(null);
  const coverFile = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const actions = useBookActions();
  const confirm = useConfirm();
  const wash = coverWash(model.cover.color, themes[useResolvedTheme()].scheme);

  const work = page?.work;
  const isbn = work?.editions.find((edition) => edition.isbn)?.isbn;
  const workCoverBook = useMemo(
    () => (work ? { Title: work.title, Attribution: work.author, ISBN: isbn ?? undefined, _coverUrl: work.coverUrl ?? undefined } : null),
    [work, isbn]
  );
  const mineIndex = model.edition ? model.edition.mineIndex : book ? 0 : null;
  const editionCovers = useMemo(
    () => (work ? work.editions.map((e, i) => (i === mineIndex && book ? book : editionCoverBook(e, work.author))) : []),
    [work, book, mineIndex]
  );
  const heroBook = book ?? workCoverBook;
  if (!heroBook) throw new Error("BookScreen needs a page or a book.");
  const wantedTab = searchParams.get("tab");
  const activeTab = model.tabs.find((t) => t.key === wantedTab)?.key ?? model.tabs[0]!.key;

  async function pickStatus(value: 0 | 1 | 2) {
    if (!book) return;
    const before = readSnapshot(book);
    const wasFinished = book.ReadStatus === 2;
    if ((await actions.setStatus(book, value)) && value === 2 && !wasFinished) setFinishing(before);
  }

  async function handleDeleteNote(bookmarkId: string) {
    if (!book) return;
    if (await confirm({ title: "Delete this note?", body: "This can't be undone.", confirmLabel: "Delete" })) {
      void actions.deleteNote(book, bookmarkId);
    }
  }

  async function rejectCover() {
    if (!(await confirm({ title: "Reject this cover?", body: "Every account stops seeing it, and the next best cover is looked up.", confirmLabel: "Reject" }))) return;
    const params = coverParamsFor(heroBook!);
    try {
      await rejectSharedCover(params);
      forgetResolvedCover(params);
      setCoverError(null);
      setCoverVersion((v) => v + 1);
      if (page) void queryClient.invalidateQueries({ queryKey: ["works", page.work.id] });
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : "Couldn't reject the cover.");
    }
  }

  async function replaceCover(file: File) {
    const params = coverParamsFor(heroBook!);
    try {
      rememberResolvedCover(params, await uploadSharedCover(params, file));
      setCoverError(null);
      setCoverVersion((v) => v + 1);
      if (page) void queryClient.invalidateQueries({ queryKey: ["works", page.work.id] });
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : "Couldn't upload the cover.");
    }
  }

  function pickFoundCover(cover: ResolvedCoverResponse, everyone: boolean) {
    if (!book) return;
    if (everyone) {
      void actions.saveCoverForEveryone(book, cover);
      setCoverVersion((v) => v + 1);
      if (page) void queryClient.invalidateQueries({ queryKey: ["works", page.work.id] });
    } else if (cover.fullUrl) {
      void actions.saveCoverUrl(book, cover.fullUrl);
    }
    setPickingCover(false);
  }

  const menuItems = model.menu.map((key) => {
    if (key === "style") return { label: "Card style", onClick: () => setStyling(true) };
    if (key === "cover") return { label: "Change cover", onClick: () => setPickingCover(true) };
    if (key === "rejectCover") return { label: "Reject cover for everyone", onClick: () => void rejectCover() };
    return { label: "Upload cover for everyone", onClick: () => coverFile.current?.click() };
  });

  const books = library?.data.books ?? [];
  const aboutSummary = model.about?.summary ?? null;
  const editions = model.about ? (allEditions ? model.about.editions : model.about.editionsPreview) : [];

  const headerActions = (
    <>
      {onShare ? (
        <button type="button" onClick={onShare} aria-label="Share" title="Share" className={roundButtonClass}>
          <ShareIcon />
        </button>
      ) : null}
      {menuItems.length > 0 ? (
        <OptionsMenu items={menuItems} title="More" trigger={<><MoreIcon /><span className="sr-only">More</span></>} triggerClassName={roundButtonClass} />
      ) : null}
    </>
  );
  const characters = allCharacters ? [...model.characters.shown, ...model.characters.more] : model.characters.shown;
  const metaParts = [
    ...(model.rating ? [<RatingStars key="rating" value={model.rating.value} label={model.rating.label} />] : []),
    ...(model.meta ? [<span key="meta">{model.meta}</span>] : []),
    ...(model.series ? [<span key="series">{seriesLabel(model.series)}</span>] : [])
  ];

  return frame((
    <>
    <div className="relative isolate">
      {wash ? (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute -inset-x-4 -z-10 h-[520px] sm:-inset-x-6 lg:-inset-x-8 ${signedIn ? "-top-27 lg:-top-29" : "-top-8"}`}
          style={{ background: `linear-gradient(to bottom, ${wash.top}, ${wash.mid} 45%, transparent)` }}
        />
      ) : null}
      <div>
        {model.menu.includes("replaceCover") ? (
          <input
            ref={coverFile}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void replaceCover(file);
            }}
          />
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:gap-14">
          <div className="min-w-0 self-start lg:sticky lg:top-[calc(var(--app-top)+1.5rem)]">
            {model.edition && work ? (
              <EditionStrip key={coverVersion} editions={work.editions} author={work.author} edition={model.edition} mineBook={book} onSelect={onSelectEdition} />
            ) : (
              <div className="mx-auto w-50 lg:w-full">
                <BookCover key={coverVersion} book={heroBook} size="full" />
              </div>
            )}
            {page ? <StatsTiles tiles={statsTiles} to={`/work/${page.work.id}/stats`} /> : null}
            {coverError ? (
              <p role="alert" className="mt-2 text-sm text-(--color-danger)">
                {coverError}
              </p>
            ) : null}
          </div>

          <div className="min-w-0 lg:max-w-190">
            <div className="flex items-start justify-between gap-4">
              <h1 className="min-w-0 font-display text-4xl font-bold break-words lg:text-5xl lg:leading-14">{model.title}</h1>
              {onShare || menuItems.length > 0 ? <div className="flex shrink-0 items-center gap-2 pt-1 lg:pt-2">{headerActions}</div> : null}
            </div>
            <p className="mt-2.5 text-lg">{`by ${model.author}`}</p>
            {model.authorAwards ? <p className="mt-1 text-xs text-(--color-text-dim)">{model.authorAwards}</p> : null}
            {metaParts.length > 0 ? (
              <div className="mt-4 overflow-hidden text-sm text-(--color-text-dim)">
                <div className="-ml-5 flex flex-wrap items-center gap-y-1">
                  {metaParts.map((part) => (
                    <span key={part.key} className="relative pl-5 before:absolute before:left-2 before:content-['·'_/_'']">{part}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {model.awards.length > 0 ? (
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {model.awards.map((award) => (
                  <li key={award.label} title={award.label} className={award.won ? winPillClass : nomineePillClass}>
                    {award.won ? <span className="flex shrink-0"><ArenaIcon size={12} /></span> : null}
                    <span className="truncate">{award.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {model.genres.length + model.possibleGenres.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {model.genres.map((genre) => (
                  <li key={genre} className="rounded-full border border-(--color-border) px-2 text-xs text-(--color-text-dim)">
                    {genre}
                  </li>
                ))}
                {model.possibleGenres.map((genre) => (
                  <li key={genre} className="rounded-full border border-dashed border-(--color-border) px-2 text-xs text-(--color-text-dim)">
                    {`Possibly ${genre}`}
                  </li>
                ))}
              </ul>
            ) : null}

            {model.primary === "owner" && model.status ? (
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <OptionsMenu
                  title="Reading status"
                  trigger={<><CheckIcon />{model.status.label}<ChevronDownIcon /></>}
                  triggerClassName={statusTriggerClass}
                  items={model.status.options.map((option) => ({ label: option.label, checked: option.selected, onClick: () => void pickStatus(option.value) }))}
                />
                {model.feeling ? (
                  <OptionsMenu
                    title="How it landed"
                    trigger={<>{model.feeling.label}<ChevronDownIcon /></>}
                    triggerClassName={`${BUTTON_SECONDARY} gap-2`}
                    items={model.feeling.options.map((option) => ({ label: option.label, checked: option.selected, onClick: () => void actions.setRating(book!, option.rating) }))}
                  />
                ) : null}
              </div>
            ) : model.primary === "add" && model.addBook ? (
              <button type="button" onClick={() => onAdd(model.addBook!)} className={`${BUTTON_PRIMARY} mt-6 w-full sm:w-auto`}>
                {model.edition ? "Add this edition" : "Add to library"}
              </button>
            ) : null}

            {model.tabs.length > 1 ? (
              <nav aria-label="Book sections" className={`mt-9 ${TAB_NAV}`}>
                {model.tabs.map((t) => {
                  const current = t.key === activeTab;
                  return (
                    <Link
                      key={t.key}
                      to={`?tab=${t.key}`}
                      aria-current={current ? "page" : undefined}
                      className={tabClass(current)}
                    >{t.label}</Link>
                  );
                })}
              </nav>
            ) : null}

            <div className="mt-7">
              {activeTab === "about" && model.about ? (
                <>
                  {aboutSummary ? (
                    <Section title="About this book">
                      <p className="text-base leading-7 whitespace-pre-wrap break-words">{aboutOpen || !model.about.preview ? aboutSummary : model.about.preview}</p>
                      {model.about.preview ? (
                        <button type="button" aria-expanded={aboutOpen} onClick={() => setAboutOpen(!aboutOpen)} className="min-h-11 text-sm font-semibold text-(--color-accent)">
                          {aboutOpen ? "Show less" : "Show more"}
                        </button>
                      ) : null}
                    </Section>
                  ) : null}
                  {characters.length > 0 ? (
                    <Section title="Characters">
                      <p className="text-[15px] leading-6">
                        {characters.join(" · ")}
                        {model.characters.more.length > 0 && !allCharacters ? (
                          <>
                            {" "}
                            <button type="button" aria-label="Show all characters" onClick={() => setAllCharacters(true)} className="inline-flex min-h-11 items-center font-semibold text-(--color-accent)">{`+${model.characters.more.length} more`}</button>
                          </>
                        ) : null}
                      </p>
                      {model.characters.canMakeGame && signedIn && page ? (
                        <Link to={`/work/${page.work.id}/characters`} className="inline-flex min-h-11 items-center text-sm font-semibold text-(--color-accent)">Make a character game</Link>
                      ) : null}
                    </Section>
                  ) : null}
                  <Section title="Editions">
                    <ul className={LIST_PANEL}>
                      {editions.map((e, i) => (
                        <li key={e.bookId} className={LIST_ROW}>
                          <BookCover book={editionCovers[i]!} width={36} />
                          <span className="min-w-0 flex-1 text-sm">
                            <span className="block break-words font-semibold">{e.title}</span>
                            <span className="block text-(--color-text-dim)">{editionLabel(e, locale)}</span>
                          </span>
                          {e.mine ? <span className="shrink-0 rounded-full bg-(--color-accent-soft) px-2.5 py-0.5 text-xs font-semibold text-(--color-accent)">Yours</span> : null}
                        </li>
                      ))}
                    </ul>
                    {model.about.editions.length > model.about.editionsPreview.length && !allEditions ? (
                      <button type="button" onClick={() => setAllEditions(true)} className="min-h-11 text-sm font-semibold text-(--color-accent)">
                        Show all {model.about.editions.length}
                      </button>
                    ) : null}
                  </Section>
                </>
              ) : null}

              {activeTab === "highlights" ? (
                <>
                  {model.highlights.length === 0 ? <p className="text-sm text-(--color-text-dim)">No highlights yet.</p> : null}
                  <div className="flex flex-col gap-3">
                    {model.highlights.map((h, i) => {
                      const bookmarkId = String(h.BookmarkID ?? "");
                      const isNote = bookmarkId.startsWith("note:");
                      return (
                        <div key={bookmarkId || i} className="border-l-2 border-(--color-border) pl-3">
                          <p className="text-sm italic">{String(h.Text)}</p>
                          {String(h.Annotation ?? "").trim() !== "" && (
                            <p className="mt-1 text-xs text-(--color-text-dim)">{String(h.Annotation)}</p>
                          )}
                          {isNote && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteNote(bookmarkId)}
                              className="mt-1 text-xs font-semibold text-(--color-danger) hover:opacity-80"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {activeTab === "community" && model.community ? (
                <>
                  <p className="mb-3 text-sm text-(--color-text-dim)">{model.community.countsLabel}</p>
                  {model.community.groups.map((group) => (
                    <ReaderList key={group.key} title={group.title} rows={group.rows} signedIn={signedIn} />
                  ))}
                  <Section title="Games">
                    {model.community.games.length > 0 ? (
                      <div className="grid grid-cols-1 gap-3">
                        {model.community.games.map((game) => (
                          <Link key={game.key} to={game.path} className={`${rowClass} justify-between hover:border-(--color-accent)`}>
                            <span className="min-w-0 truncate text-sm font-semibold">{game.title}</span>
                            <span className="shrink-0 text-xs text-(--color-text-dim)">{game.detail}</span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-(--color-text-dim)">No public games use this book yet.</p>
                    )}
                  </Section>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>

    {book && styling ? (
        <PerCardStylePanel
          idPrefix="book"
          name={String(book.Title ?? "Untitled")}
          priorityText="the series and library-wide"
          currentOverride={book._style as PerCardStyle | undefined}
          seedStyle={effectiveCardStyle(
            resolveLibraryStyle(library?.data.style),
            seriesGroupByBookKey(books, library?.data.groups ?? []).get(bookKey(book))?.style
          )}
          onSave={(style) => actions.saveStyle(book, style)}
          onClose={() => setStyling(false)}
        />
      ) : null}
      {book && pickingCover ? (
        <CoverPickerModal
          title={String(book.Title ?? "Untitled")}
          currentImageId={typeof book._coverImageId === "string" ? book._coverImageId : null}
          lookup={coverParamsFor(book)}
          coverUrl={typeof book._coverUrl === "string" ? book._coverUrl : null}
          isAdmin={isAdmin}
          removeCoverLabel="Remove custom cover — go back to the normal auto-detected one"
          onSelect={(image) => void actions.saveCover(book, image)}
          onPickFound={pickFoundCover}
          onRemoveCover={() => void actions.removeCover(book)}
          onClose={() => setPickingCover(false)}
        />
      ) : null}
      {book && finishing ? (
        <FinishSheet
          book={book}
          books={books}
          before={finishing}
          onSetRating={actions.setRating}
          onAddNote={actions.addNote}
          onRestoreRead={actions.restoreRead}
          onClose={() => setFinishing(null)}
        />
      ) : null}
    </>
  ));
}

export function ReaderList({ title, rows, signedIn }: { title: string | null; rows: BookScreenReaderRow[]; signedIn: boolean }) {
  return (
    <div className="mb-4">
      {title ? <h3 className="mb-3 text-sm font-semibold text-(--color-text-dim)">{title}</h3> : null}
      <ul className="grid grid-cols-1 gap-3">
        {rows.map((row) => {
          const body = (
            <>
              <AuthorAvatar author={{ ...row, userId: row.username }} size={32} />
              <span className="flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold">
                <span className="truncate">{row.username}</span>
                <ReaderGlyph identity={row.readerGlyph} />
              </span>
              <span className="shrink-0 text-xs text-(--color-text-dim)">{row.status}</span>
            </>
          );
          return (
            <li key={row.username}>
              {signedIn && row.linksToProfile ? (
                <Link to={`/community/u/${row.username}`} className={`${rowClass} hover:border-(--color-accent)`}>{body}</Link>
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
