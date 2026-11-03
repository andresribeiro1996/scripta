// /play/:code — the page a challenge link recipient lands on (see
// App.tsx: OUTSIDE every RequireAuth wrapper, same treatment as
// /vote/:code). One question at a time, with the timer running from the
// first question to the last answer. Submit grades server-side and locks
// the play. The end screen shows the score, the per-question verdicts,
// the leaderboard, and the same link back — that loop is the challenge.

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { createPlayClock, type PublicQuizQuestion } from "@scripta/shared";
import { useAuth } from "../auth/AuthContext";
import { CoverImage } from "../components/BookCard";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, FIELD_CLASS } from "../components/page/buttonClasses";
import { QuizPrompt } from "../components/quiz/QuizPrompt";
import { submitPlayApi, type PlayResponse } from "../api/quizzes";
import { QuizLeaderboard, QuizResults } from "../components/quiz/QuizResults";
import { backTo } from "../lib/areas";
import { quizPlayStage } from "../lib/quizPlayStage";
import { storePlayId, useQuizPlay } from "../hooks/useQuizPlay";
import { useT } from "../i18n";

function InfoScreen({ message, back }: { message: string; back?: { to: string; label: string } }) {
  const t = useT();
  return (
    <Page width="narrow" back={back} title={t("quizzes.title")}>
      <p className="text-sm text-(--color-text-dim)">{message}</p>
    </Page>
  );
}

function Options({ question, onPick, picked }: { question: PublicQuizQuestion; onPick: (index: number) => void; picked: number | null }) {
  const t = useT();
  if (question.type === "title_cover") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {question.options.map((option, index) => (
          <button
            key={option}
            type="button"
            aria-label={t("quizzes.coverOption", { number: index + 1, total: question.options.length })}
            disabled={picked !== null}
            onClick={() => onPick(index)}
            className={`relative aspect-[2/3] overflow-hidden rounded-xl border-2 bg-(--color-border) transition-colors ${picked === index ? "border-(--color-accent)" : "border-(--color-border) hover:border-(--color-text-dim)"}`}
          >
            {/* contain, not cover: cropping is what hides the artwork a
                player needs to recognize; the border-colored tile backs
                the letterbox, per DESIGN.md's BookCard note. */}
            <CoverImage book={{ Title: t("quizzes.option", { number: index + 1 }), _coverUrl: option }} fit="contain" alt={t("quizzes.option", { number: index + 1 })} />
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {question.options.map((option, index) => (
        <button
          key={option}
          type="button"
          disabled={picked !== null}
          onClick={() => onPick(index)}
          className={`min-h-11 rounded-lg border px-4 py-2 text-left text-sm font-semibold transition-colors ${picked === index ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border) bg-(--color-surface) hover:border-(--color-text-dim)"}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function PlayQuizPage() {
  const t = useT();
  const { code } = useParams();
  const { session } = useAuth();
  const back = session?.user.username ? backTo("quiz") : undefined;
  const { board, ownPlay } = useQuizPlay(code ?? "");
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [playerName, setPlayerName] = useState("");
  const [submitted, setSubmitted] = useState<PlayResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clock = useRef(createPlayClock()).current;
  const [elapsed, setElapsed] = useState(0);
  const complete = Boolean(board.data) && Object.keys(answers).length === board.data!.questions.length;
  const completeRef = useRef(complete);
  completeRef.current = complete;
  const playing = quizPlayStage({ playOpen: board.data?.playOpen ?? false, hasResult: Boolean(submitted ?? ownPlay.data), ownPlayPending: ownPlay.isLoading }) === "playing";

  useEffect(() => {
    if (playing) clock.start(Date.now());
  }, [playing, clock]);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(clock.elapsed(Date.now(), completeRef.current)), 1000);
    return () => window.clearInterval(timer);
  }, [clock]);

  if (board.isPending) return <InfoScreen message={t("library.loadingEllipsis")} back={back} />;
  if (board.isError) return <InfoScreen message={board.error instanceof Error ? board.error.message : t("quizzes.noQuizAtLink")} back={back} />;
  const playBoard = board.data;

  const result = submitted ?? (ownPlay.data ?? null);
  const questions = playBoard.questions;
  const stage = quizPlayStage({ playOpen: playBoard.playOpen, hasResult: result !== null, ownPlayPending: ownPlay.isLoading });
  if (stage === "loading") return <InfoScreen message={t("library.loadingEllipsis")} back={back} />;
  if (stage === "leaderboard") {
    return (
      <Page width="narrow" back={back} title={playBoard.name}>
        <div className="flex flex-col gap-6">
          <p className="text-center text-(--color-text-dim)">{t("quizzes.isClosed")}</p>
          <QuizLeaderboard code={code ?? ""} playId={null} />
        </div>
      </Page>
    );
  }

  if (result) {
    return <QuizResults code={code ?? ""} name={playBoard.name} result={result} questions={questions} back={back} />;
  }

  const question = questions[index];
  if (!question) return <InfoScreen message={t("quizzes.noQuestionsYet")} back={back} />;

  function pick(choiceIndex: number) {
    clock.answered(Date.now());
    setPicked(choiceIndex);
    setAnswers((value) => ({ ...value, [question!.id]: choiceIndex }));
    window.setTimeout(() => {
      setPicked(null);
      setIndex((value) => Math.min(value + 1, questions.length - 1));
    }, 220);
  }

  async function submit() {
    if (Object.keys(answers).length !== questions.length) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const response = await submitPlayApi(code ?? "", {
        answers: questions.map((q) => ({ questionId: q.id, choiceIndex: answers[q.id] ?? 0 })),
        durationMs: clock.durationMs(Date.now()),
        ...(playerName.trim() ? { playerName: playerName.trim() } : {})
      });
      storePlayId(code ?? "", response.playId);
      setSubmitted(response);
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : t("quizzes.submitFailed"));
    } finally {
      setBusy(false);
    }
  }

  const answeredCount = Object.keys(answers).length;

  return (
    <Page width="narrow" back={back} title={playBoard.name} subtitle={`${index + 1}/${questions.length} · ${Math.floor(elapsed / 1000)}s`}>
      <div className="flex flex-col gap-5">
        <div className="h-1 rounded bg-(--color-border)">
          <div className="h-1 rounded bg-(--color-accent) transition-all" style={{ width: `${Math.round((answeredCount / questions.length) * 100)}%` }} />
        </div>

        <QuizPrompt question={question} />
        <Options question={question} picked={picked} onPick={pick} />

        {index === questions.length - 1 && answeredCount === questions.length && (
          <div className="flex flex-col gap-3">
            {!session?.user.username && (
              <label className="flex flex-col gap-1 text-sm font-semibold">
                {t("quizzes.leaderboardName")}
                <input
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                  maxLength={40}
                  placeholder={t("quizzes.guest")}
                  className={FIELD_CLASS}
                />
              </label>
            )}
            {submitError && <p role="alert" className="text-sm text-(--color-danger)">{submitError}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className={BUTTON_PRIMARY}
            >
              {busy ? t("quizzes.scoring") : t("quizzes.seeMyScore")}
            </button>
          </div>
        )}
      </div>
    </Page>
  );
}
