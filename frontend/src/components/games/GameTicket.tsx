import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { quizClueHeading, type QuizPreview } from "@scripta/shared";
import type { ContentTone, PublishedContent } from "@scripta/shared/community";
import { LibraryIcon, QuoteIcon } from "../NavIcons";
import { ChevronRightIcon } from "../Toolbar";
import { GameTicketArt } from "./GameTicketArt";

const STATUS_TONES: Record<ContentTone, string> = {
  neutral: "border-(--color-border) bg-(--color-surface) text-(--color-text-dim)",
  accent: "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)",
  info: "border-(--color-info) bg-(--color-info-soft) text-(--color-info)",
  success: "border-(--color-success) bg-(--color-success-soft) text-(--color-success)",
  reference: "border-(--color-reference) bg-(--color-reference-soft) text-(--color-reference)"
};

const KINDS = {
  quiz: { prefix: "Quiz: ", color: "var(--color-reference)", soft: "bg-(--color-reference-soft)", action: "bg-(--color-reference-soft) text-(--color-reference)" },
  tierlist: { prefix: "Tier list: ", color: "var(--color-success)", soft: "bg-(--color-success-soft)", action: "bg-(--color-success-soft) text-(--color-success)" },
  tournament: { prefix: "Tournament: ", color: "var(--color-accent)", soft: "bg-(--color-accent-soft)", action: "bg-(--color-accent-soft) text-(--color-accent)" }
} as const;

export function StatusBadge({ label, tone }: { label: string; tone: ContentTone }) {
  return <span className={`rounded-full border px-2 text-xs font-semibold ${STATUS_TONES[tone]}`}>{label}</span>;
}

export function GameTicket({
  kind,
  name,
  to,
  meta,
  badges,
  stats = [],
  covers,
  ladder,
  preview,
  actionLabel = "Open game",
  menu
}: {
  kind: PublishedContent["kind"];
  name: string;
  to: string;
  meta: ReactNode;
  badges: ReactNode;
  stats?: Array<{ value: number; label: string }>;
  covers: string[];
  ladder?: string[];
  preview?: QuizPreview;
  actionLabel?: string;
  menu?: ReactNode;
}) {
  const { prefix, color, soft, action } = KINDS[kind];
  const clue = kind === "quiz" && preview && preview.type !== "cover_title" ? preview : undefined;
  return (
    <div className="relative flex w-full flex-col overflow-clip rounded-xl border border-(--color-border) bg-(--color-surface) hover:border-(--color-accent)">
      <div className="flex items-stretch">
        <div className={`flex w-22 shrink-0 items-center justify-center border-r border-(--color-border) ${soft}`}>
          <GameTicketArt kind={kind} covers={covers} ladder={ladder} preview={preview} color={color} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-4">
          <h3 className="line-clamp-2 text-base font-semibold">
            <Link to={to} className="after:absolute after:inset-0">
              <span className="sr-only">{prefix}</span>
              {name}
            </Link>
          </h3>
          <div className="min-w-0 text-xs text-(--color-text-dim)">{meta}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">{badges}</div>
          {stats.length > 0 && (
            <div data-stats className="mt-2 flex flex-wrap gap-4 border-t border-(--color-border) pt-3">
              {stats.map((stat) => (
                <div key={stat.label} className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">{stat.value}</span>
                  <span className="text-xs text-(--color-text-dim)">{stat.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {clue && (
        <section className="mx-4 mb-4 flex flex-col gap-2 rounded-lg border-l-2 border-(--color-border) bg-(--color-bg) p-4">
          <div className="flex items-center gap-2 text-xs text-(--color-text-dim)">
            <span aria-hidden="true" className="flex">{clue.type === "title_cover" ? <LibraryIcon size={18} /> : <QuoteIcon size={18} />}</span>
            {quizClueHeading(clue.type)}
          </div>
          <p className="line-clamp-3 text-sm">{clue.prompt}</p>
        </section>
      )}
      <div className="relative z-10 mt-auto flex items-center gap-2 border-t border-dashed border-(--color-border) p-4">
        <span aria-hidden="true" className="absolute -top-[7px] -left-[7px] h-[14px] w-[14px] rounded-full border border-(--color-border) bg-(--color-bg)" />
        <span aria-hidden="true" className="absolute -top-[7px] -right-[7px] h-[14px] w-[14px] rounded-full border border-(--color-border) bg-(--color-bg)" />
        <Link
          to={to}
          aria-label={`${actionLabel}: ${name}`}
          className={`flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-4 text-sm font-semibold ${action} hover:bg-(--color-accent-fill) hover:text-(--color-text)`}
        >
          <span className="min-w-0 truncate">{actionLabel}</span>
          <ChevronRightIcon size={16} />
        </Link>
        {menu}
      </div>
    </div>
  );
}
