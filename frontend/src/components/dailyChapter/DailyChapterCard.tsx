import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { DailyChapterBoard } from "@scripta/shared";
import { dailyChapterApi } from "../../api/dailyChapter";
import "./dailyChapter.css";

export function DailyChapterArt({ motif }: { motif: string }) {
  return <div className="daily-chapter-art" aria-hidden="true"><div className={"dc-motif m-" + motif}>{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div></div>;
}

export function DailyChapterInvitation({ board }: { board: DailyChapterBoard }) {
  return <section className="daily-chapter-invitation" aria-labelledby="daily-chapter-card-title">
    <DailyChapterArt motif={board.theme.motif} />
    <div className="min-w-0 space-y-3"><p className="text-sm text-(--color-text-dim)">The Daily Chapter · {board.date}</p><h2 id="daily-chapter-card-title" className="text-2xl">{board.title}</h2><p className="text-sm text-(--color-text-dim)">{board.intro}</p><Link to="/daily" className="inline-flex min-h-11 items-center font-semibold text-(--color-accent)">Open today's chapter →</Link><p className="text-xs text-(--color-text-dim)">5 questions · About 2 minutes · Everyone welcome</p></div>
  </section>;
}

export function DailyChapterCard() {
  const daily = useQuery({ queryKey: ["daily-chapter", "today"], queryFn: dailyChapterApi.today, refetchInterval: 60_000 });
  return daily.data?.board ? <DailyChapterInvitation board={daily.data.board} /> : null;
}
