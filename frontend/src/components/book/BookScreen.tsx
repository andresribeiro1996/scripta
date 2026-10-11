import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  bookKey,
  bookScreenModel,
  bookStatsModel,
  editionLabel,
  readSnapshot,
  seriesGroupByBookKey,
  type BookScreenReaderRow,
  type BookScreenTabKey,
  type ReadSnapshot,
  type WorkPage
} from "@scripta/shared";
import { fetchIsAdmin, rejectSharedCover, uploadSharedCover } from "../../api/books";
import { forgetResolvedCover, rememberResolvedCover } from "../../api/covers";
import { useBookActions } from "../../hooks/useBookActions";
import { useLibrary } from "../../hooks/useLibrary";
import { useWorkStats } from "../../hooks/useWorkStats";
import { effectiveCardStyle, resolveLibraryStyle, type PerCardStyle } from "../../lib/libraryStyle";
import { AuthorAvatar } from "../CommunityAuthorAvatar";
import { CoverImage, coverParamsFor } from "../BookCard";
import { CoverPickerModal } from "../CoverPickerModal";
import { useConfirm } from "../ConfirmDialog";
import { FinishSheet } from "../FinishSheet";
import { OptionsMenu } from "../OptionsMenu";
import { PerCardStylePanel } from "../PerCardStylePanel";
import { ReaderGlyph } from "../ReaderGlyph";
import { BackLink } from "../work/BackLink";
import { CommunityIcon, InfoIcon, QuoteIcon } from "../NavIcons";
import { StatsTiles } from "./BookStats";

type Props = {
  page: WorkPage | null;
  book: Record<string, unknown> | null;
  signedIn: boolean;
  onAdd: () => void;
  onShare: (() => void) | null;
  onBack: (() => void) | null;
  backTo: string;
};

const TAB_ICONS: Record<BookScreenTabKey, typeof InfoIcon> = { about: InfoIcon, highlights: QuoteIcon, community: CommunityIcon };

const rowClass = "flex items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-4";
const sectionHeading = "mb-3 text-lg font-bold";
const controlClass = "inline-flex min-h-11 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-sm font-semibold hover:bg-(--color-surface-hover)";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className={sectionHeading}>{title}</h2>
      {children}
    </section>
  );
}

export function BookScreen({ page, book, signedIn, onAdd, onShare, onBack, backTo }: Props) {
  const { data: isAdmin = false } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity, enabled: signedIn });
  const { data: library } = useLibrary({ enabled: Boolean(book) });
  const model = bookScreenModel(page, book, { isAdmin });
  const statsQuery = useWorkStats(page?.work.id);
  const statsTiles = bookStatsModel(statsQuery.data ?? null, page?.work.rating ?? null).tiles;
  const [tab, setTab] = useState<BookScreenTabKey>(model.tabs[0]!.key);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [allEditions, setAllEditions] = useState(false);
  const [styling, setStyling] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  const [finishing, setFinishing] = useState<ReadSnapshot | null>(null);
  const [coverVersion, setCoverVersion] = useState(0);
  const [coverError, setCoverError] = useState<string | null>(null);
  const coverFile = useRef<HTMLInputElement>(null);
  const actions = useBookActions();
  const confirm = useConfirm();

  const work = page?.work;
  const isbn = work?.editions.find((edition) => edition.isbn)?.isbn;
  const workCoverBook = useMemo(
    () => (work ? { Title: work.title, Attribution: work.author, ISBN: isbn ?? undefined, _coverUrl: work.coverUrl ?? undefined } : null),
    [work, isbn]
  );
  const heroBook = book ?? workCoverBook;
  if (!heroBook) throw new Error("BookScreen needs a page or a book.");
  const activeTab = model.tabs.some((t) => t.key === tab) ? tab : model.tabs[0]!.key;

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
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : "Couldn't upload the cover.");
    }
  }

  const menuItems = model.menu.map((key) => {
    if (key === "style") return { label: "Card style", onClick: () => setStyling(true) };
    if (key === "cover") return { label: "Change cover", onClick: () => setPickingCover(true) };
    if (key === "rejectCover") return { label: "Wrong cover", onClick: () => void rejectCover() };
    return { label: "Replace cover", onClick: () => coverFile.current?.click() };
  });

  const books = library?.data.books ?? [];
  const aboutSummary = model.about?.summary ?? null;
  const editions = model.about ? (allEditions ? model.about.editions : model.about.editionsPreview) : [];

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex items-start justify-between gap-3">
        <BackLink backTo={backTo} onBack={onBack} />
        <div className="flex items-center gap-2">
          {onShare ? (
            <button type="button" onClick={onShare} className={`${controlClass} font-normal hover:border-(--color-accent)`}>
              Share
            </button>
          ) : null}
          {menuItems.length > 0 ? (
            <OptionsMenu
              items={menuItems}
              title="More"
              trigger="⋯"
              triggerClassName={`${controlClass} min-w-11 text-lg`}
            />
          ) : null}
        </div>
      </div>
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

      <div className="grid gap-6 sm:grid-cols-[220px_1fr]">
        <div className="self-start text-center sm:sticky sm:top-6 sm:text-left">
          <div className="relative mx-auto aspect-[2/3] w-32 overflow-hidden rounded-xl bg-(--color-border) sm:mx-0 sm:w-full">
            <CoverImage key={coverVersion} book={heroBook} size="full" />
          </div>
          <h1 className="mt-4 text-2xl font-bold">{model.title}</h1>
          <p className="mt-1 text-sm text-(--color-text-dim)">{model.author}</p>
          {model.genres.length > 0 ? (
            <ul className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              {model.genres.map((genre) => (
                <li key={genre} className="rounded-full border border-(--color-border) px-2 text-xs text-(--color-text-dim)">
                  {genre}
                </li>
              ))}
            </ul>
          ) : null}
          {page ? <StatsTiles tiles={statsTiles}to={`/work/${page.work.id}/stats`} /> : null}
          {model.meta ? <p className="mt-3 text-xs text-(--color-text-dim)">{model.meta}</p> : null}
          {coverError ? (
            <p role="alert" className="mt-2 text-sm text-(--color-danger)">
              {coverError}
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          {model.primary === "owner" && model.status ? (
            <div className="flex flex-wrap items-center gap-2">
              <OptionsMenu
                title="Reading status"
                trigger={`${model.status.label} ▾`}
                triggerClassName={`${controlClass} text-(--color-accent)`}
                items={model.status.options.map((option) => ({ label: option.label, checked: option.selected, onClick: () => void pickStatus(option.value) }))}
              />
              {model.feeling ? (
                <OptionsMenu
                  title="How it landed"
                  trigger={`${model.feeling.label} ▾`}
                  triggerClassName={controlClass}
                  items={model.feeling.options.map((option) => ({ label: option.label, checked: option.selected, onClick: () => void actions.setRating(book!, option.rating) }))}
                />
              ) : null}
            </div>
          ) : model.primary === "add" ? (
            <button
              type="button"
              onClick={onAdd}
              className="min-h-11 w-full rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-semibold text-(--color-on-accent) hover:opacity-90"
            >
              Add to library
            </button>
          ) : null}

          {model.tabs.length > 1 ? (
            <div
              role="group"
              aria-label="Book sections"
              className="mt-4 flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)"
            >
              {model.tabs.map((t, i) => {
                const checked = t.key === activeTab;
                const Icon = TAB_ICONS[t.key];
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={checked}
                    aria-label={t.label}
                    title={t.label}
                    onClick={() => setTab(t.key)}
                    className={`flex min-h-11 flex-1 items-center justify-center px-3 ${
                      i > 0 ? "border-l border-(--color-border)" : ""
                    } ${checked ? "bg-(--color-accent-soft) text-(--color-accent)" : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}
                  >
                    <Icon />
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="mt-6">
            {activeTab === "about" && model.about ? (
              <>
                {aboutSummary ? (
                  <Section title="About this book">
                    <p className="text-sm leading-6 whitespace-pre-wrap break-words">{aboutOpen || !model.about.preview ? aboutSummary : model.about.preview}</p>
                    {model.about.preview ? (
                      <button type="button" aria-expanded={aboutOpen} onClick={() => setAboutOpen(!aboutOpen)} className="min-h-11 text-sm font-semibold text-(--color-accent)">
                        {aboutOpen ? "Show less" : "Show more"}
                      </button>
                    ) : null}
                  </Section>
                ) : null}
                <Section title="Editions">
                  <ul className="flex flex-col gap-2">
                    {editions.map((e) => (
                      <li key={e.bookId} className="text-sm">
                        <span className="font-semibold">{e.title}</span>
                        <span className="text-(--color-text-dim)"> · {editionLabel(e)}{e.mine ? " · Yours" : ""}</span>
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
          removeCoverLabel="Remove custom cover — go back to the normal auto-detected one"
          onSelect={(image) => void actions.saveCover(book, image)}
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
    </main>
  );
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
