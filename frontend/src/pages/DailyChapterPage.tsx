import { dailyChapterId } from "../lib/dailyChapterId";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DAILY_CHAPTER_GUEST_STORAGE, DAILY_CHAPTER_THEMES, dailyChapterDraftKey, dailyChapterShare, dailyChapterSubmission, isDailyChapterGuestId, readDailyChapterDraft, type DailyChapterBoard, type DailyChapterResult } from "@scripta/shared";
import { dailyChapterApi } from "../api/dailyChapter";
import { addBookToLibrary } from "../api/library";
import { useAuth } from "../auth/AuthContext";
import { DailyChapterArt } from "../components/dailyChapter/DailyChapterCard";
import { Page } from "../components/page/Page";
import { PANEL, SECTION_HEADING } from "../components/page/surfaceClasses";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "../components/page/buttonClasses";

export function DailyChapterPage() {
  const { session } = useAuth();
  const loadIdentity = () => {
    try {
      let id = localStorage.getItem(DAILY_CHAPTER_GUEST_STORAGE);
      if (!isDailyChapterGuestId(id)) { id = dailyChapterId(); localStorage.setItem(DAILY_CHAPTER_GUEST_STORAGE, id); }
      return { id, error: undefined };
    } catch { return { id: undefined, error: "This browser could not save a secure device identity. Allow site storage and use an up-to-date browser." }; }
  };
  const [identity, setIdentity] = useState(loadIdentity);
  const daily = useQuery({ queryKey: ["daily-chapter", "today"], queryFn: dailyChapterApi.today, refetchInterval: 60_000 });
  const history = useQuery({ queryKey: ["daily-chapter", "history", session?.user.id ?? "guest", identity.id, daily.data?.date], queryFn: () => dailyChapterApi.history(identity.id!, Boolean(session)), enabled: Boolean(identity.id && daily.data?.date) });
  const result = history.data?.results.find((item) => item.editionId === daily.data?.board?.id);
  return <Page width="narrow" title="The Daily Chapter" subtitle="One theme. Five questions. A little discovery, every day.">
    <div className="space-y-8">
      <p className="text-sm text-(--color-text-dim)">A shared edition for everyone. A new chapter opens at 00:00 UTC.</p>
      {identity.error ? <div role="alert"><p>{identity.error}</p><button className={BUTTON_SECONDARY} onClick={() => setIdentity(loadIdentity())}>Retry storage</button></div> : daily.isError || history.isError ? <div role="alert"><p>Couldn't load your chapter or saved results.</p><button className={BUTTON_SECONDARY} onClick={() => { void daily.refetch(); void history.refetch(); }}>Retry</button></div> : daily.isPending || history.isPending ? <p role="status">Opening your chapter…</p> : daily.data.board ? <DailyGame key={daily.data.board.id + ":" + (session?.user.id ?? identity.id)} board={daily.data.board} guestId={identity.id!} playerId={session?.user.id ?? identity.id!} result={result} /> : <p>Another chapter is on its way. Check back soon.</p>}
      {history.data?.results.length ? <section className="space-y-4" aria-labelledby="daily-history"><h2 id="daily-history" className={SECTION_HEADING}>Your chapters</h2><p className="text-sm">{history.data.results.length} completed · {history.data.streak} day streak</p>
        {history.data.themes.map((stats) => <div key={stats.themeId} className={`${PANEL} p-4`}><h3 className="font-semibold">{DAILY_CHAPTER_THEMES.find((theme) => theme.id === stats.themeId)?.name}</h3><p className="mt-1 text-sm text-(--color-text-dim)">{stats.completed}/{stats.eligible} editions since {history.data.startedOn} · {stats.correct}/{stats.answered} correct · {stats.perfect} perfect</p>{stats.perfectStreak > 1 ? <p className="mt-1 text-sm">{stats.perfectStreak} perfect editions in a row</p> : null}</div>)}
        <details><summary className="cursor-pointer py-3">Past results</summary><ul className="space-y-2">{history.data.results.map((item) => <li key={item.editionId} className="flex justify-between gap-4 text-sm"><span>{item.date} · {item.title}</span><strong>{item.score}/5</strong></li>)}</ul></details>
      </section> : null}
      {!session ? <p className="text-sm text-(--color-text-dim)">Your results stay with this browser. <Link className="text-(--color-accent)" to="/login?mode=signup&returnTo=%2Fdaily">Create an account</Link> to keep them across devices.</p> : null}
    </div>
  </Page>;
}

function DailyGame({ board, guestId, playerId, result: recovered }: { board: DailyChapterBoard; guestId: string; playerId: string; result?: DailyChapterResult }) {
  const client = useQueryClient();
  const { session } = useAuth();
  const storageKey = dailyChapterDraftKey(board.id, playerId);
  const [draft] = useState(() => {
    try { return { answers: readDailyChapterDraft(localStorage.getItem(storageKey), board.questions), error: undefined }; }
    catch { return { answers: {} as Record<string, number>, error: "Couldn't restore this browser's draft. You can still play here." }; }
  });
  const [answers, setAnswers] = useState<Record<string, number>>(draft.answers);
  const [index, setIndex] = useState(() => { const missing = board.questions.findIndex((q) => draft.answers[q.id] === undefined); return missing < 0 ? 4 : missing; });
  const [submitted, setSubmitted] = useState<DailyChapterResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(draft.error);
  const [saved, setSaved] = useState<string[]>([]);
  const [shareText, setShareText] = useState("");
  const result = submitted ?? recovered;
  function choose(questionId: string, choice: number) {
    const next = { ...answers, [questionId]: choice };
    setAnswers(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setError("Your answers are on this screen, but browser storage couldn't save your progress."); }
  }
  async function submit() {
    const body = dailyChapterSubmission(board.questions, answers);
    if (!body) return;
    setBusy(true); setError(undefined);
    try { const next = await dailyChapterApi.play(board.id, guestId, body, Boolean(session)); setSubmitted(next); void client.invalidateQueries({ queryKey: ["daily-chapter", "history"] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't score your chapter. Try again."); void client.invalidateQueries({ queryKey: ["daily-chapter", "today"] }); }
    finally { setBusy(false); }
  }
  async function saveBook(book: DailyChapterResult["answers"][number]["book"]) {
    setBusy(true); setError(undefined);
    try { await addBookToLibrary({ title: book.title, author: book.author, readStatus: 0, preserveExisting: true }); setSaved((items) => [...items, book.id]); void client.invalidateQueries({ queryKey: ["library"] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't save the book."); }
    finally { setBusy(false); }
  }
  const question = board.questions[index]!;
  return <section className="space-y-5" aria-labelledby="daily-edition-title">
    <div className="flex items-center gap-5"><DailyChapterArt motif={board.theme.motif} /><div className="min-w-0"><p className="text-sm text-(--color-text-dim)">{board.theme.name} · {board.date}</p><h2 id="daily-edition-title" className="mt-2 break-words text-3xl">{board.title}</h2><p className="mt-2 text-sm text-(--color-text-dim)">{board.intro}</p></div></div>
    {error ? <p role="alert" className="text-sm text-(--color-danger)">{error}</p> : null}
    {result ? <>
      <div className="rounded-xl bg-(--color-accent-soft) p-5"><h3 className="text-2xl">{result.score}/5 · Chapter complete</h3><p className="mt-2 text-sm">Another little chapter tomorrow.</p></div>
      <button className={BUTTON_PRIMARY} onClick={() => { const text = dailyChapterShare(result, new URL("/daily", window.location.origin).href); setShareText(text); }}>Share your score</button>
      {shareText ? <label className="block text-sm">Copy your spoiler-free result<textarea aria-label="Share result" className={`${FIELD_CLASS} mt-2 w-full`} rows={4} readOnly value={shareText} onFocus={(event) => event.target.select()} /></label> : null}
      <h3 className="text-xl">The books behind today's chapter</h3>
      {result.answers.map((answer, i) => <article key={answer.questionId} className="space-y-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-4"><p className="text-sm text-(--color-text-dim)">{i + 1}. {answer.choiceIndex === answer.answerIndex ? "Correct" : "Your pick: " + answer.options[answer.choiceIndex]}</p><h4 className="font-semibold">{answer.book.title}</h4><p className="text-sm text-(--color-text-dim)">{answer.book.author}</p><p className="text-sm">{answer.explanation}</p><a href={answer.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm text-(--color-accent)">Read the source ↗</a>{session ? <button className={BUTTON_SECONDARY + " ml-3"} disabled={busy || saved.includes(answer.book.id)} onClick={() => void saveBook(answer.book)}>{saved.includes(answer.book.id) ? "Saved" : "Want to read"}</button> : null}</article>)}
    </> : <>
      <p className="text-sm text-(--color-text-dim)" aria-live="polite">Question {index + 1} of 5 · {question.type === "quote_title" ? "Name the book from its words" : "Name the book from this clue"}</p>
      <fieldset disabled={busy} className="space-y-4"><legend className="mb-4 font-display text-xl leading-relaxed">{question.prompt}</legend><div className="grid gap-3">{question.options.map((option, choice) => <label key={choice} className={"flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-3 " + (answers[question.id] === choice ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border) bg-(--color-surface)")}><input type="radio" name={question.id} value={choice} checked={answers[question.id] === choice} onChange={() => choose(question.id, choice)} /><span className="min-w-0 break-words">{option}</span></label>)}</div></fieldset>
      <div className="flex justify-between gap-3"><button className={BUTTON_SECONDARY} disabled={index === 0 || busy} onClick={() => setIndex(index - 1)}>Back</button>{index < 4 ? <button className={BUTTON_PRIMARY} disabled={answers[question.id] === undefined} onClick={() => setIndex(index + 1)}>Next</button> : <button className={BUTTON_PRIMARY} disabled={busy || !dailyChapterSubmission(board.questions, answers)} onClick={() => void submit()}>{busy ? "Scoring…" : "Finish chapter"}</button>}</div><p className="text-xs text-(--color-text-dim)">Answers and explanations appear after all five questions. There is no timer.</p>
    </>}
  </section>;
}
