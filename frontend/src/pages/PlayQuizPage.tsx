// /play/:code — the page a challenge link recipient lands on (see
// App.tsx: OUTSIDE every RequireAuth wrapper, same treatment as
// /vote/:code). One question at a time, timer running from first render,
// submit grades server-side and locks the play. The end screen shows the
// score, the per-question verdicts, the leaderboard, and the same link
// back — that loop is the challenge.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { PublicQuizQuestion } from "@scripta/shared";
import { fetchPublicResultsApi, submitPlayApi, type PlayResponse } from "../api/quizzes";
import { storePlayId, useQuizPlay } from "../hooks/useQuizPlay";

function InfoScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 text-center">
      <p className="text-(--color-text-dim)">{message}</p>
    </div>
  );
}

function Prompt({ question }: { question: PublicQuizQuestion }) {
  if (question.type === "cover_title") {
    return <img src={question.prompt} alt="Which book is this?" className="mx-auto h-56 w-40 rounded-lg object-cover blur-md" />;
  }
  if (question.type === "title_cover") {
    return <p className="text-center text-2xl font-bold">{question.prompt}</p>;
  }
  return <p className="text-center font-serif text-lg italic leading-relaxed">“{question.prompt}”</p>;
}

function Options({ question, onPick, picked }: { question: PublicQuizQuestion; onPick: (index: number) => void; picked: number | null }) {
  if (question.type === "title_cover") {
    return (
      <div className="grid grid-cols-2 gap-3">
        {question.options.map((option, index) => (
          <button
            key={option}
            type="button"
            disabled={picked !== null}
            onClick={() => onPick(index)}
            className={`overflow-hidden rounded-xl border-2 transition-colors ${picked === index ? "border-(--color-accent)" : "border-(--color-border) hover:border-(--color-text-dim)"}`}
          >
            <img src={option} alt={`Option ${index + 1}`} className="h-44 w-full object-cover" />
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
  const { code } = useParams();
  const { board, ownPlay } = useQuizPlay(code ?? "");
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [playerName, setPlayerName] = useState("");
  const [submitted, setSubmitted] = useState<PlayResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (board.isPending) return <InfoScreen message="Loading…" />;
  if (board.isError) return <InfoScreen message={board.error instanceof Error ? board.error.message : "No quiz at that link."} />;
  const playBoard = board.data;
  if (!playBoard.playOpen) return <InfoScreen message="This quiz isn't open for play." />;

  const result = submitted ?? (ownPlay.data ?? null);
  const questions = playBoard.questions;

  if (result) {
    return <ResultsView code={code ?? ""} result={result} questions={questions} copied={copied} setCopied={setCopied} alreadyPlayed={submitted === null} />;
  }

  const question = questions[index];
  if (!question) return <InfoScreen message="This quiz has no questions yet." />;

  function pick(choiceIndex: number) {
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
        durationMs: Date.now() - startRef.current,
        ...(playerName.trim() ? { playerName: playerName.trim() } : {})
      });
      storePlayId(code ?? "", response.playId);
      setSubmitted(response);
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : "Couldn't submit your answers.");
    } finally {
      setBusy(false);
    }
  }

  const answeredCount = Object.keys(answers).length;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-5 py-8">
      <div className="flex items-center justify-between text-sm text-(--color-text-dim)">
        <span>{playBoard.name}</span>
        <span>
          {index + 1}/{questions.length} · {Math.floor(elapsed / 1000)}s
        </span>
      </div>
      <div className="h-1 rounded bg-(--color-surface-hover)">
        <div className="h-1 rounded bg-(--color-accent) transition-all" style={{ width: `${Math.round((answeredCount / questions.length) * 100)}%` }} />
      </div>

      <Prompt question={question} />
      <Options question={question} picked={picked} onPick={pick} />

      {index === questions.length - 1 && answeredCount === questions.length && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Name for the leaderboard (optional)
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              maxLength={40}
              placeholder="Guest"
              className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2"
            />
          </label>
          {submitError && <p role="alert" className="text-sm text-(--color-danger)">{submitError}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="min-h-11 rounded-lg bg-(--color-accent) px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Scoring…" : "See my score"}
          </button>
        </div>
      )}
    </div>
  );
}

function ResultsView({
  code,
  result,
  questions,
  copied,
  setCopied,
  alreadyPlayed
}: {
  code: string;
  result: PlayResponse;
  questions: PublicQuizQuestion[];
  copied: boolean;
  setCopied: (value: boolean) => void;
  alreadyPlayed: boolean;
}) {
  const leaderboard = useQuery({ queryKey: ["quizPublicResults", code], queryFn: () => fetchPublicResultsApi(code) });
  const shareLink = `${window.location.origin}/play/${code}`;
  const score = result.score;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-5 py-8">
      <div className="text-center">
        <p className="text-sm text-(--color-text-dim)">{alreadyPlayed ? "You already played this quiz." : "Your score"}</p>
        <p className="text-5xl font-bold text-(--color-accent)">
          {score}/{questions.length}
        </p>
      </div>

      <ol className="flex flex-col gap-1.5 text-sm">
        {questions.map((question, i) => (
          <li key={question.id} className="flex items-center justify-between rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2">
            <span className="text-(--color-text-dim)">{i + 1}</span>
            <span aria-hidden="true">{result.correct[question.id] ? "✓" : "✗"}</span>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-(--color-surface-hover) px-3 py-2 text-sm">{shareLink}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(shareLink);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="min-h-10 shrink-0 rounded-lg bg-(--color-accent) px-3 text-sm font-semibold text-white"
        >
          {copied ? "Copied!" : "Challenge someone"}
        </button>
      </div>

      {leaderboard.data && (
        <div>
          <h2 className="mb-2 text-lg font-bold">Leaderboard</h2>
          <table className="w-full text-sm">
            <tbody>
              {leaderboard.data.plays.map((play, i) => (
                <tr key={i} className="border-t border-(--color-border)">
                  <td className="py-1.5 pr-3">{i + 1}</td>
                  <td className="py-1.5 pr-3">{play.playerName ?? "Guest"}</td>
                  <td className="py-1.5 pr-3">{play.score}/{leaderboard.data!.questionCount}</td>
                  <td className="py-1.5">{(play.durationMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
