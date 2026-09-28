// /dashboard/arena/quiz/:id — the owner's quiz editor. Draft mode edits
// the document (books, quotes, blurbs, length, types) with onBlur commits;
// Publish mints the vote code and freezes the document server-side.
// Published mode is read-only plus the share/open controls and results.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { QUIZ_QUESTION_TYPES, eligibleTypes, type QuizData, type QuizQuestionType } from "@scripta/shared";
import { PageContainer } from "../components/PageContainer";
import { useConfirm } from "../components/ConfirmDialog";
import { deleteQuizApi, fetchQuizResultsApi, publishQuizApi, setPlayStateApi, updateQuizApi, type Quiz } from "../api/quizzes";
import { useQuizzes } from "../hooks/useQuizzes";

const TYPE_LABELS: Record<QuizQuestionType, string> = {
  cover_title: "Blurred cover → title",
  title_cover: "Title → cover",
  quote_title: "Quote → title",
  blurb_title: "Blurb → title"
};

export function QuizEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: quizzes, isLoading } = useQuizzes();
  const quiz = (quizzes ?? []).find((entry) => entry.id === id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Local draft of the document: every edit updates it immediately and
  // enqueues a whole-document PUT. Sends are serialized over one promise
  // chain and each carries the draft current AT ITS ENQUEUE TIME — later
  // sends always hold newer state, so rapid edits can't overwrite each
  // other with a stale snapshot the way per-edit fetch-then-PUT did.
  const [draft, setDraft] = useState<QuizData | null>(null);
  const draftRef = useRef<QuizData | null>(null);
  const [draftQuizId, setDraftQuizId] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    // Initialize once per quiz — a refetch must not clobber local edits.
    if (quiz && draftQuizId !== quiz.id) {
      setDraft(quiz.data);
      draftRef.current = quiz.data;
      setDraftQuizId(quiz.id);
    }
  }, [quiz, draftQuizId]);

  function updateDraft(mutate: (current: QuizData) => QuizData): void {
    if (!quiz) return;
    const current = draftRef.current;
    if (!current) return;
    const next = mutate(current);
    draftRef.current = next;
    setDraft(next);
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        await updateQuizApi(quiz.id, { data: next });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Couldn't save.");
      }
    });
  }

  function patchBook(bookKey: string, patch: { quote?: string | null; blurb?: string | null }): void {
    updateDraft((current) => ({
      ...current,
      books: current.books.map((book) => (book.key === bookKey ? { ...book, ...patch } : book))
    }));
  }

  async function publish(quiz: Quiz) {
    setBusy(true);
    setError(null);
    try {
      // Pending saves must land before the code is minted: publishing
      // freezes the server-side document, so racing it would seed from a
      // document missing the last edits.
      await saveQueueRef.current;
      await publishQuizApi(quiz.id);
      await queryClient.invalidateQueries({ queryKey: ["quizzes"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't publish.");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <PageContainer><p className="px-5 py-8 text-(--color-text-dim)">Loading…</p></PageContainer>;
  if (!quiz) {
    return (
      <PageContainer>
        <div className="mx-auto max-w-2xl px-5 py-8">
          <Link to="/dashboard/arena?tab=quizzes" className="text-sm text-(--color-text-dim) hover:text-(--color-text)">← Quizzes</Link>
          <p className="mt-4 text-(--color-text-dim)">No quiz with that id.</p>
        </div>
      </PageContainer>
    );
  }

  const data = draft;
  const shareLink = quiz.voteCode ? `${window.location.origin}/play/${quiz.voteCode}` : null;
  if (!data) {
    return (
      <PageContainer>
        <p className="px-5 py-8 text-(--color-text-dim)">Loading…</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-10">
        <Link to="/dashboard/arena?tab=quizzes" className="text-sm text-(--color-text-dim) hover:text-(--color-text)">← Quizzes</Link>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold">{quiz.name}</h1>
          {quiz.voteCode === null && (
            <button
              type="button"
              onClick={() => { void confirm({ title: `Delete "${quiz.name}"?`, body: "This can't be undone." }).then(async (yes) => { if (yes) { await deleteQuizApi(quiz.id); await queryClient.invalidateQueries({ queryKey: ["quizzes"] }); navigate("/dashboard/arena?tab=quizzes"); } }); }}
              className="min-h-10 rounded-lg border border-(--color-border) px-3 text-sm text-(--color-danger)"
            >
              Delete
            </button>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-(--color-danger)">{error}</p>}

        {quiz.voteCode === null && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                Questions
                <select
                  value={data.questionCount}
                  onChange={(event) => updateDraft((current) => ({ ...current, questionCount: Number(event.target.value) }))}
                  className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2"
                >
                  {[4, 5, 10, 15, 20].map((count) => (
                    <option key={count} value={count}>{count}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                {QUIZ_QUESTION_TYPES.map((type) => {
                  const offered = data.books.some((book) => eligibleTypes(book).includes(type));
                  const checked = offered && data.allowedTypes.includes(type);
                  return (
                    <label key={type} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${offered ? "border-(--color-border)" : "border-(--color-border) opacity-50"}`}>
                      <input
                        type="checkbox"
                        disabled={!offered}
                        checked={checked}
                        onChange={() =>
                          updateDraft((current) => ({
                            ...current,
                            allowedTypes: checked ? current.allowedTypes.filter((entry) => entry !== type) : [...current.allowedTypes, type]
                          }))
                        }
                      />
                      {TYPE_LABELS[type]}
                    </label>
                  );
                })}
              </div>
            </div>

            {data.books.map((book) => (
              <div key={book.key} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{book.title}</h3>
                    <p className="text-sm text-(--color-text-dim)">{book.author}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateDraft((current) => ({ ...current, books: current.books.filter((entry) => entry.key !== book.key) }))}
                    className="min-h-9 rounded-lg border border-(--color-border) px-3 text-sm"
                  >
                    Remove
                  </button>
                </div>
                <label className="mt-2 flex flex-col gap-1 text-sm">
                  Quote (optional)
                  <textarea
                    rows={2}
                    defaultValue={book.quote ?? ""}
                    placeholder="Paste a line from this book…"
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value !== (book.quote ?? "")) patchBook(book.key, { quote: value || null });
                    }}
                    className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2"
                  />
                </label>
                <label className="mt-2 flex flex-col gap-1 text-sm">
                  Blurb (optional)
                  <textarea
                    rows={2}
                    defaultValue={book.blurb ?? ""}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value !== (book.blurb ?? "")) patchBook(book.key, { blurb: value || null });
                    }}
                    className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2"
                  />
                </label>
              </div>
            ))}

            <button
              type="button"
              disabled={busy || data.books.length < 4}
              onClick={() => void publish(quiz)}
              className="min-h-11 self-start rounded-lg bg-(--color-accent) px-4 font-semibold text-(--color-on-accent) disabled:opacity-50"
            >
              {busy ? "Publishing…" : "Publish quiz"}
            </button>
            {data.books.length < 4 && <p className="text-sm text-(--color-text-dim)">A quiz needs at least 4 books.</p>}
          </section>
        )}

        {quiz.voteCode !== null && <PublishedSection quiz={quiz} shareLink={shareLink!} copied={copied} setCopied={setCopied} />}
      </div>
    </PageContainer>
  );
}

function PublishedSection({ quiz, shareLink, copied, setCopied }: { quiz: Quiz; shareLink: string; copied: boolean; setCopied: (value: boolean) => void }) {
  const queryClient = useQueryClient();
  const results = useQuery({ queryKey: ["quizResults", quiz.id], queryFn: () => fetchQuizResultsApi(quiz.id) });
  const ownerQuestions = quiz.data.questions ?? [];

  async function toggleOpen(open: boolean) {
    await setPlayStateApi(quiz.id, open);
    await queryClient.invalidateQueries({ queryKey: ["quizzes"] });
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-(--color-surface-hover) px-3 py-2 text-sm">{shareLink}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(shareLink);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="min-h-10 rounded-lg bg-(--color-accent) px-3 text-sm font-semibold text-(--color-on-accent)"
        >
          {copied ? "Copied!" : "Copy challenge link"}
        </button>
        <button
          type="button"
          onClick={() => void toggleOpen(!quiz.playOpen)}
          className="min-h-10 rounded-lg border border-(--color-border) px-3 text-sm"
        >
          {quiz.playOpen ? "Close for play" : "Open for play"}
        </button>
      </div>

      <h2 className="text-lg font-bold">Questions ({ownerQuestions.length})</h2>
      <ol className="flex flex-col gap-2">
        {ownerQuestions.map((question, index) => (
          <li key={question.id} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm">
            <span className="text-(--color-text-dim)">{index + 1}. {TYPE_LABELS[question.type]}</span>
            {question.type === "title_cover" ? (
              <img src={String(question.options[question.answerIndex])} alt="Answer cover" className="ml-2 inline-block h-10 w-7 rounded object-cover align-middle" />
            ) : (
              <span className="ml-2 font-semibold">{String(question.options[question.answerIndex])}</span>
            )}
          </li>
        ))}
      </ol>

      <h2 className="text-lg font-bold">Results</h2>
      {results.data && results.data.plays.length === 0 && <p className="text-sm text-(--color-text-dim)">No one has played yet.</p>}
      {results.data && results.data.plays.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-(--color-text-dim)">
              <th className="py-1 pr-3 font-medium">#</th>
              <th className="py-1 pr-3 font-medium">Player</th>
              <th className="py-1 pr-3 font-medium">Score</th>
              <th className="py-1 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {results.data.plays.map((play, index) => (
              <tr key={play.playId} className="border-t border-(--color-border)">
                <td className="py-1.5 pr-3">{index + 1}</td>
                <td className="py-1.5 pr-3">{play.playerName ?? "Guest"}</td>
                <td className="py-1.5 pr-3">{play.score}/{results.data!.questionCount}</td>
                <td className="py-1.5">{(play.durationMs / 1000).toFixed(1)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {results.data && results.data.stats.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Per-question stats</h2>
          {results.data.stats.map((stat) => (
            <div key={stat.questionId} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
              <p className="text-sm font-semibold">
                {stat.questionId} · {stat.correctCount}/{stat.answerCount} correct
              </p>
              <div className="mt-2 flex flex-col gap-1">
                {stat.picks.map((pick) => (
                  <div key={pick.choiceIndex} className="flex items-center gap-2 text-xs text-(--color-text-dim)">
                    <span className="w-6">#{pick.choiceIndex + 1}</span>
                    {/* Same tally-bar treatment as DuelCard: accent fill on a border track. */}
                    <span className="h-2 flex-1 rounded bg-(--color-border)">
                      <span className="block h-2 rounded bg-(--color-accent)" style={{ width: `${Math.round((pick.count / stat.answerCount) * 100)}%` }} />
                    </span>
                    <span>{pick.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
