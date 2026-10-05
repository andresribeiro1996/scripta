// /dashboard/arena/quiz/new — two-step create: pick a source and its
// books, then set length and question types. Quotes are pasted later in
// the editor; the pool ships with famous first lines already attached.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QUIZ_POOL, QUIZ_QUESTION_TYPES, bookKey, booksInGroup, eligibleTypes, workIdOf, type QuizBookInput, type QuizDataInput, type QuizQuestionType } from "@scripta/shared";
import { PageContainer } from "../components/PageContainer";
import { createQuizApi } from "../api/quizzes";
import { resolveCover } from "../api/covers";
import { normalizeImageId, normalizeIsbn } from "../lib/covers";
import { useLibrary } from "../hooks/useLibrary";
import { useWorkBooks } from "../hooks/useWorkBooks";
import { booksByWork } from "../lib/booksByWork";

function toQuizBook(book: Record<string, unknown>, resolvedCover: string | null | undefined): QuizBookInput {
  return {
    workId: workIdOf(book),
    title: String(book.Title ?? "Untitled"),
    author: String(book.Attribution ?? ""),
    // _coverUrl only exists for manually-set covers; automatically
    // resolved ones come from the backend cover cache, fetched per book
    // below so availability (and the type checkboxes) is honest.
    coverUrl: typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : resolvedCover ?? null,
    quote: null,
    blurb: null
  };
}

const TYPE_LABELS: Record<QuizQuestionType, string> = {
  cover_title: "Guess the title from a blurred cover",
  title_cover: "Guess the cover from the title",
  quote_title: "Guess the book from a quote",
  blurb_title: "Guess the book from its blurb"
};

const BOOK_COUNT = 4;

export function QuizCreatePage() {
  const navigate = useNavigate();
  const { data: library, isLoading, isError, refetch } = useLibrary();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [source, setSource] = useState<"shelf" | "collection" | "pool">("shelf");
  const [collectionId, setCollectionId] = useState("");
  const [poolIds, setPoolIds] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(10);
  const [allowedTypes, setAllowedTypes] = useState<QuizQuestionType[]>([...QUIZ_QUESTION_TYPES]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived from the cached document, not from `library` itself: the `?? []`
  // fallback would otherwise be a fresh array each render and churn the
  // memo below (and through it, the cover-resolution effect).
  const libraryData = library?.data;
  const workBooks = useWorkBooks(library);
  const libraryBooks = useMemo(() => workBooks.filter((book) => workIdOf(book)), [workBooks]);
  const collections = useMemo(
    () => (libraryData?.groups ?? []).filter((group) => group.type === "collection"),
    [libraryData]
  );
  const collection = collections.find((group) => group.id === collectionId);

  const shelfRawBooks = useMemo(
    () => [...booksByWork(source === "collection" ? (collection ? booksInGroup(collection, libraryBooks) : []) : source === "shelf" ? libraryBooks : []).values()],
    [source, collection, libraryBooks]
  );

  // Resolve covers the same way CoverImage does (backend cache-aware
  // lookup) for every shelf/collection book without a manual cover, so
  // cover-based question types are offered on ordinary libraries and the
  // snapshot ships real URLs. Sequential and progressive: each result
  // lands in state as it arrives.
  const resolvedRef = useRef<Record<string, string | null>>({});
  const [resolvedCovers, setResolvedCovers] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (source === "pool") return;
    let cancelled = false;
    void (async () => {
      for (const raw of shelfRawBooks) {
        const key = bookKey(raw);
        if (resolvedRef.current[key] !== undefined) continue;
        if (typeof raw._coverUrl === "string" && raw._coverUrl) {
          resolvedRef.current[key] = raw._coverUrl;
          continue;
        }
        const url = await resolveCover({
          isbn: normalizeIsbn(raw.ISBN) || undefined,
          imageId: normalizeImageId(raw.ImageId) || undefined,
          title: String(raw.Title ?? "").trim() || undefined,
          author: raw.Attribution ? String(raw.Attribution) : undefined
        }, { poll: false });
        if (cancelled) return;
        resolvedRef.current[key] = url ?? null;
        setResolvedCovers({ ...resolvedRef.current });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shelfRawBooks, source]);

  const books: QuizBookInput[] =
    source === "pool"
      ? QUIZ_POOL.filter((book) => poolIds.includes(book.id)).map(({ id: _id, ...book }) => book)
      : shelfRawBooks.map((raw) => toQuizBook(raw, resolvedCovers[bookKey(raw)]));

  // A type is offerable only if at least one chosen book has the data it
  // needs — same eligibility rule the backend's publish enforces.
  const availableTypes = QUIZ_QUESTION_TYPES.filter((type) => books.some((book) => eligibleTypes(book).includes(type)));
  const effectiveTypes = allowedTypes.filter((type) => availableTypes.includes(type));

  // Question count can never exceed the pool the draw picks from.
  const lengthOptions = [4, 5, 10, 15, 20].filter((count) => count <= books.length);
  const effectiveQuestionCount = lengthOptions.includes(questionCount) ? questionCount : (lengthOptions[lengthOptions.length - 1] ?? 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data: QuizDataInput = {
        sourceLabel: source === "pool" ? "Famous books" : source === "collection" ? collection?.name ?? "Collection" : "My shelf",
        questionCount: effectiveQuestionCount,
        allowedTypes: effectiveTypes.length > 0 ? effectiveTypes : availableTypes,
        books,
        questions: null
      };
      const created = await createQuizApi(name.trim() || "Untitled quiz", data);
      navigate(`/dashboard/arena/quiz/${created.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't create the quiz.");
      setBusy(false);
    }
  }

  return (
    <PageContainer>
      <div className="mx-auto flex max-w-2xl flex-col gap-5 pb-10">
        <Link to="/dashboard/arena?tab=quizzes" className="text-sm text-(--color-text-dim) hover:text-(--color-text)">← Quizzes</Link>
        <div>
          <p className="text-sm text-(--color-text-dim)">Step {step + 1} of 2</p>
          <h1 className="text-2xl font-bold">{["Choose books", "Set up questions"][step]}</h1>
        </div>
        {error && <p role="alert" className="text-sm text-(--color-danger)">{error}</p>}
        {step === 0 && (
          <>
            <label className="flex flex-col gap-1 text-sm font-semibold">Quiz name
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} placeholder="Untitled quiz" className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2" />
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Question source</legend>
              {([
                ["shelf", "My whole shelf"],
                ["collection", "One of my collections"],
                ["pool", "Famous books (anyone can play)"]
              ] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 rounded-lg border border-(--color-border) p-3">
                  <input type="radio" checked={source === value} onChange={() => setSource(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            {source === "collection" && (
              <label className="flex flex-col gap-1 text-sm font-semibold">Collection
                <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)} className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2">
                  <option value="">Choose a collection…</option>
                  {collections.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </label>
            )}
            {source === "pool" && (
              <div className="max-h-[50vh] space-y-2 overflow-y-auto">
                {QUIZ_POOL.map((book) => {
                  const checked = poolIds.includes(book.id);
                  return (
                    <button
                      key={book.id}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => setPoolIds((value) => (checked ? value.filter((entry) => entry !== book.id) : [...value, book.id]))}
                      className={`flex min-h-12 w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${checked ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border) bg-(--color-surface)"}`}
                    >
                      <span className="truncate">{book.title} <span className="text-(--color-text-dim)">· {book.author}</span></span>
                      <span aria-hidden="true">{checked ? "✓" : "+"}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {source === "shelf" && (
              <p className="text-sm text-(--color-text-dim)">
                {isLoading ? "Loading books…" : isError ? <button onClick={() => void refetch()} className="text-left text-(--color-accent)">Couldn't load your library. Retry</button> : `${shelfRawBooks.length} books on your shelf.`}
              </p>
            )}
            <p className="text-sm text-(--color-text-dim)">{books.length} {books.length === 1 ? "book" : "books"} selected</p>
          </>
        )}
        {step === 1 && (
          <>
            <label className="flex flex-col gap-1 text-sm font-semibold">Questions
              {/* Only lengths the selected pool can actually fill — with 4–9
                  books the old fixed 5/10/15/20 list left nothing selectable. */}
              <select value={effectiveQuestionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2">
                {lengthOptions.map((count) => (
                  <option key={count} value={count}>{count} questions</option>
                ))}
              </select>
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Question types</legend>
              {QUIZ_QUESTION_TYPES.map((type) => {
                const offered = availableTypes.includes(type);
                const checked = offered && effectiveTypes.includes(type);
                return (
                  <label key={type} className={`flex items-center gap-2 rounded-lg border p-3 ${offered ? "border-(--color-border)" : "border-(--color-border) opacity-50"}`}>
                    <input
                      type="checkbox"
                      disabled={!offered}
                      checked={checked}
                      onChange={() => setAllowedTypes((value) => (value.includes(type) ? value.filter((entry) => entry !== type) : [...value, type]))}
                    />
                    {TYPE_LABELS[type]}
                    {!offered && <span className="ml-auto text-xs text-(--color-text-dim)">no book has this data</span>}
                  </label>
                );
              })}
            </fieldset>
          </>
        )}
        <div className="flex justify-end gap-3 pt-2">
          {step > 0 && <button type="button" onClick={() => setStep((value) => value - 1)} className="min-h-11 rounded-lg border border-(--color-border) px-4">Back</button>}
          {step < 1 ? (
            <button
              type="button"
              disabled={books.length < BOOK_COUNT || (source === "collection" && !collection)}
              onClick={() => setStep(1)}
              className="min-h-11 rounded-lg bg-(--color-accent) px-4 font-semibold text-(--color-on-accent) disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || effectiveTypes.length === 0 || questionCount > books.length}
              onClick={() => void submit()}
              className="min-h-11 rounded-lg bg-(--color-accent) px-4 font-semibold text-(--color-on-accent) disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create quiz"}
            </button>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
