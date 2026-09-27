// /dashboard/arena/quiz/new — two-step create: pick a source and its
// books, then set length and question types. Quotes are pasted later in
// the editor; the pool ships with famous first lines already attached.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QUIZ_POOL, QUIZ_QUESTION_TYPES, bookKey, booksInGroup, eligibleTypes, type QuizBook, type QuizData, type QuizQuestionType } from "@scripta/shared";
import { PageContainer } from "../components/PageContainer";
import { createQuizApi } from "../api/quizzes";
import { useLibrary } from "../hooks/useLibrary";

function toQuizBook(book: Record<string, unknown>): QuizBook {
  return {
    key: bookKey(book),
    title: String(book.Title ?? "Untitled"),
    author: String(book.Attribution ?? ""),
    coverUrl: typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : null,
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
  const [poolKeys, setPoolKeys] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(10);
  const [allowedTypes, setAllowedTypes] = useState<QuizQuestionType[]>([...QUIZ_QUESTION_TYPES]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const libraryBooks = library?.data.books ?? [];
  const collections = (library?.data.groups ?? []).filter((group) => group.type === "collection");
  const collection = collections.find((group) => group.id === collectionId);

  const books: QuizBook[] =
    source === "pool"
      ? QUIZ_POOL.filter((book) => poolKeys.includes(book.key))
      : source === "collection"
        ? collection
          ? booksInGroup(collection, libraryBooks).map(toQuizBook)
          : []
        : libraryBooks.map(toQuizBook);

  // A type is offerable only if at least one chosen book has the data it
  // needs — same eligibility rule the backend's publish enforces.
  const availableTypes = QUIZ_QUESTION_TYPES.filter((type) => books.some((book) => eligibleTypes(book).includes(type)));
  const effectiveTypes = allowedTypes.filter((type) => availableTypes.includes(type));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data: QuizData = {
        sourceLabel: source === "pool" ? "Famous books" : source === "collection" ? collection?.name ?? "Collection" : "My shelf",
        questionCount,
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
                  const checked = poolKeys.includes(book.key);
                  return (
                    <button
                      key={book.key}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => setPoolKeys((value) => (checked ? value.filter((entry) => entry !== book.key) : [...value, book.key]))}
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
                {isLoading ? "Loading books…" : isError ? <button onClick={() => void refetch()} className="text-left text-(--color-accent)">Couldn't load your library. Retry</button> : `${libraryBooks.length} books on your shelf.`}
              </p>
            )}
            <p className="text-sm text-(--color-text-dim)">{books.length} {books.length === 1 ? "book" : "books"} selected</p>
          </>
        )}
        {step === 1 && (
          <>
            <label className="flex flex-col gap-1 text-sm font-semibold">Questions
              <select value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2">
                {[5, 10, 15, 20].map((count) => (
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
              className="min-h-11 rounded-lg bg-(--color-accent) px-4 font-semibold text-white disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || effectiveTypes.length === 0 || questionCount > books.length}
              onClick={() => void submit()}
              className="min-h-11 rounded-lg bg-(--color-accent) px-4 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create quiz"}
            </button>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
