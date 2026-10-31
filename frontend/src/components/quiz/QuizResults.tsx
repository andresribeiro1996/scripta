import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { playerLabel, resultCovers, scoreRows, type PlayResponse, type PublicQuizQuestion, type ScoreRow } from "@scripta/shared";
import { fetchPublicResultsApi } from "../../api/quizzes";
import { CoverImage } from "../BookCard";
import { LibraryIcon } from "../NavIcons";
import { ChevronRightIcon, ShareIcon } from "../Toolbar";
import { Page } from "../page/Page";
import { BUTTON_PRIMARY, FIELD_CLASS } from "../page/buttonClasses";
import { useLocale } from "../../i18n";

function AnswerValue({ value, picked = false }: { value: NonNullable<ScoreRow["answer"]>; picked?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col items-start gap-3 lg:flex-row lg:items-center ${picked ? "text-(--color-text-dim)" : ""}`}>
      {value.kind === "cover" && (
        <span className={`relative block shrink-0 overflow-hidden rounded bg-(--color-border) ${picked ? "h-15 w-10" : "h-24 w-16"}`}>
          <CoverImage book={{ _coverUrl: value.value }} fit="contain" alt={value.title ?? "Your picked cover"} />
        </span>
      )}
      <div className="min-w-0">
        <p className="mb-1 text-xs text-(--color-text-dim)">{picked ? "Your pick" : "Correct answer"}</p>
        {value.kind === "text" || value.title ? <p className={`${picked ? "text-sm" : "text-base font-medium sm:text-lg"} break-words`}>{value.kind === "text" ? value.value : value.title}</p> : null}
      </div>
    </div>
  );
}

function QuizAnswer({ row, question, expanded, onToggle }: { row: ScoreRow; question: PublicQuizQuestion; expanded: boolean; onToggle: () => void }) {
  const title = row.answer?.title ?? (row.answer?.kind === "text" ? row.answer.value : `Question ${row.number}`);
  const cover = row.answer?.kind === "cover" ? row.answer.value : question.type === "cover_title" ? question.prompt : null;
  return (
    <li className="lg:flex lg:gap-4 lg:p-5">
      <button type="button" aria-expanded={expanded} aria-controls={`quiz-answer-${row.id}`} onClick={onToggle} className="flex min-h-22 w-full items-center gap-3 py-3 text-left lg:hidden">
        <span aria-hidden="true" className="relative flex h-16 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-(--color-accent-soft) text-(--color-text-dim)">
          {cover ? <CoverImage book={{ _coverUrl: cover }} fit="contain" /> : <LibraryIcon size={22} />}
        </span>
        <span className="min-w-0 flex-1">
          {row.answer && <span className="sr-only">Question {row.number}: </span>}<span className="block text-sm break-words">{title}</span>
          <span className={`mt-1 block text-xs ${row.correct ? "text-(--color-success)" : "text-(--color-danger)"}`}><span aria-hidden="true">{row.correct ? "✓" : "✗"} </span>{row.correct ? "Correct" : "Incorrect"}</span>
        </span>
        <span aria-hidden="true" className={`shrink-0 text-(--color-text-dim) ${expanded ? "rotate-90" : ""}`}><ChevronRightIcon size={16} /></span>
      </button>
      <span className="hidden pt-0.5 text-sm tabular-nums text-(--color-text-dim) lg:block">{String(row.number).padStart(2, "0")}</span>
      <div id={`quiz-answer-${row.id}`} className={`min-w-0 flex-1 pb-4 lg:block lg:pb-0 ${expanded ? "" : "hidden"}`}>
        <p className={`mb-3 hidden items-center gap-1.5 text-xs font-semibold lg:flex ${row.correct ? "text-(--color-success)" : "text-(--color-danger)"}`}>
          <span aria-hidden="true">{row.correct ? "✓" : "✗"}</span>{row.correct ? "Correct" : "Incorrect"}
        </p>
        <div className={row.pick ? "grid grid-cols-2 gap-3 lg:gap-4" : ""}>
          {row.answer && <AnswerValue value={row.answer} />}
          {row.pick && <div className="border-l border-(--color-border) pl-3 lg:pl-4"><AnswerValue value={row.pick} picked /></div>}
          {!row.answer && <p className="text-sm text-(--color-text-dim)">Answer details aren’t available for this play.</p>}
        </div>
      </div>
    </li>
  );
}

export function QuizResults({ code, name, result, questions, back }: {
  code: string;
  name: string;
  result: PlayResponse;
  questions: PublicQuizQuestion[];
  back?: { to: string; label: string };
}) {
  const [tab, setTab] = useState<"answers" | "board">("answers");
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = scoreRows(questions, result.correct, result.answers);
  const covers = resultCovers(questions, rows);

  return (
    <Page back={back} title={name}>
      <section aria-label="Your result" className={`relative isolate mb-3 grid items-center gap-x-4 gap-y-3 pb-3 lg:mb-8 lg:gap-6 lg:border-b lg:border-(--color-border) lg:pb-10 ${covers.length ? "grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-2" : ""}`}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 60% 50%, color-mix(in srgb, var(--color-accent) 8%, transparent), transparent 70%)" }} />
        <p aria-label={`${result.score} of ${questions.length} correct`} className="my-3 min-w-0 font-sans text-[clamp(3.5rem,18vw,5rem)] leading-none font-extralight tracking-[-0.05em] lg:text-[6.5rem]">
          {result.score}<span className="text-[0.45em] text-(--color-text-dim)"> / {questions.length}</span>
        </p>
        {covers.length > 0 && (
          <div aria-hidden="true" className="flex justify-end py-3 lg:justify-center lg:py-6">
            {covers.map(({ url, title }, index) => (
              <div key={url} className="relative -mx-1.5 h-20 w-14 overflow-hidden rounded bg-(--color-border) shadow-md lg:-mx-2 lg:h-48 lg:w-32" style={{ transform: `rotate(${(index - (covers.length - 1) / 2) * 10}deg) translateY(${index === 1 ? -8 : 0}px)`, zIndex: index === 1 ? 1 : 0 }}>
                <CoverImage book={{ _coverUrl: url }} fit="contain" alt={title} />
              </div>
            ))}
          </div>
        )}
      </section>

      <div role="tablist" aria-label="Quiz results" className="mb-1 flex border-b border-(--color-border) lg:hidden" onKeyDown={(event) => {
        let next: "answers" | "board";
        if (["ArrowLeft", "ArrowRight"].includes(event.key)) next = tab === "answers" ? "board" : "answers";
        else if (event.key === "Home") next = "answers";
        else if (event.key === "End") next = "board";
        else return;
        event.preventDefault();
        setTab(next);
        event.currentTarget.querySelector<HTMLButtonElement>(`#quiz-${next}-tab`)?.focus();
      }}>
        {([{ value: "answers", label: "Your answers" }, { value: "board", label: "Leaderboard" }] as const).map((item) => (
          <button key={item.value} type="button" role="tab" id={`quiz-${item.value}-tab`} aria-selected={tab === item.value} aria-controls={`quiz-${item.value}-panel`} tabIndex={tab === item.value ? 0 : -1} onClick={() => setTab(item.value)} className={`min-h-12 flex-1 border-b-2 px-3 text-sm font-semibold ${tab === item.value ? "border-(--color-accent) text-(--color-accent)" : "border-transparent text-(--color-text-dim)"}`}>{item.label}</button>
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-8">
        <section id="quiz-answers-panel" role="tabpanel" aria-labelledby="quiz-answers-tab" className={`min-w-0 lg:row-span-2 lg:block ${tab === "answers" ? "" : "hidden"}`}>
          <h2 id="quiz-answers-heading" className="mb-4 hidden font-display text-2xl lg:block">Your answers</h2>
          <ol className="divide-y divide-(--color-border) lg:rounded-xl lg:border lg:border-(--color-border) lg:bg-(--color-surface)">
            {rows.map((row, index) => <QuizAnswer key={row.id} row={row} question={questions[index]!} expanded={expanded === row.id} onToggle={() => setExpanded((current) => current === row.id ? null : row.id)} />)}
          </ol>
        </section>
        <div id="quiz-board-panel" role="tabpanel" aria-labelledby="quiz-board-tab" className={`min-w-0 lg:col-start-2 lg:row-start-2 lg:block [&_h2]:hidden lg:[&_h2]:block ${tab === "board" ? "" : "hidden"}`}>
          <QuizLeaderboard code={code} />
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <ChallengeLink code={code} />
        </div>
      </div>
    </Page>
  );
}

function ChallengeLink({ code }: { code: string }) {
  const shareLink = `${window.location.origin}/play/${code}`;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    setShowLink(true);
    setCopyError(null);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
    } catch (reason) {
      setCopyError(reason instanceof Error ? reason.message : "Select and copy the link below.");
    }
  }

  return (
    <section aria-labelledby="quiz-challenge-heading" className="lg:rounded-xl lg:border lg:border-(--color-border) lg:bg-(--color-surface) lg:p-6">
      <h2 id="quiz-challenge-heading" className="hidden font-display text-2xl lg:block">Pass it on.</h2>
      <p className="mt-2 mb-5 hidden text-sm text-(--color-text-dim) lg:block">Same books. A fresh pair of eyes. See how a friend does.</p>
      <button type="button" onClick={() => void copy()} className={`${BUTTON_PRIMARY} w-full transition-[filter] hover:brightness-90 hover:opacity-100`}>
        {copied ? "Link copied!" : <><span aria-hidden="true" className="mr-2 lg:hidden"><ShareIcon /></span><span className="lg:hidden">Challenge a friend</span><span className="hidden lg:inline">Challenge someone</span></>}
      </button>
      <label className={`mt-4 text-xs text-(--color-text-dim) lg:block ${showLink ? "block" : "hidden"}`}>
        Challenge link
        <input readOnly value={shareLink} onFocus={(event) => event.target.select()} className={`${FIELD_CLASS} mt-1 w-full min-w-0`} />
      </label>
      <p role="status" className="sr-only">{copied ? "Challenge link copied." : ""}</p>
      {copyError && <p role="alert" className="mt-2 text-sm text-(--color-danger)">{copyError}</p>}
    </section>
  );
}

export function QuizLeaderboard({ code }: { code: string }) {
  const locale = useLocale();
  const leaderboard = useQuery({ queryKey: ["quizPublicResults", code], queryFn: () => fetchPublicResultsApi(code) });
  if (leaderboard.isError) return <p className="text-sm text-(--color-text-dim)">Couldn't load the leaderboard.</p>;
  if (!leaderboard.data) return <p role="status" className="text-sm text-(--color-text-dim)">Loading leaderboard…</p>;
  return (
    <section aria-labelledby="quiz-leaderboard-heading" className="min-w-0">
      <h2 id="quiz-leaderboard-heading" className="mb-4 font-display text-2xl">Leaderboard</h2>
      {leaderboard.data.plays.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">No plays yet.</p>
      ) : (
        <ol className="divide-y divide-(--color-border) border-y border-(--color-border)">
          {leaderboard.data.plays.map((play, index) => (
            <li key={index} className="flex items-center gap-3 py-4 text-sm">
              <span className="w-5 shrink-0 tabular-nums text-(--color-text-dim)">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">{playerLabel(play, locale).name}</p>
                {playerLabel(play, locale).guest && <p className="text-xs text-(--color-text-dim)">Guest</p>}
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <p className="font-semibold"><span className="sr-only">Score: </span>{play.score}/{leaderboard.data.questionCount}</p>
                <p className="mt-0.5 text-xs text-(--color-text-dim)"><span className="sr-only">Time: </span>{(play.durationMs / 1000).toFixed(1)}s</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
