import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { quizClueHeading, type QuizPreview } from "@scripta/shared";
import type { ContentTone, PublishedContent } from "@scripta/shared/community";
import { LibraryIcon, QuoteIcon } from "../NavIcons";
import { ChevronRightIcon } from "../Toolbar";
import { GameTicketArt } from "./GameTicketArt";
import { useLocale } from "../../i18n";

const STATUS_TONES: Record<ContentTone, string> = {
  neutral: "border-(--color-border) bg-(--color-surface) text-(--color-text-dim)",
  accent: "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)",
  info: "border-(--color-info) bg-(--color-info-soft) text-(--color-info)",
  success: "border-(--color-success) bg-(--color-success-soft) text-(--color-success)",
  reference: "border-(--color-reference) bg-(--color-reference-soft) text-(--color-reference)"
};

const KINDS = {
  quiz: { prefix: "Quiz: ", color: "var(--color-reference)", soft: "bg-(--color-reference-soft)", action: "bg-(--color-reference-soft) text-(--color-reference)", hoverBorder: "hover:border-(--color-reference)" },
  tierlist: { prefix: "Tier list: ", color: "var(--color-success)", soft: "bg-(--color-success-soft)", action: "bg-(--color-success-soft) text-(--color-success)", hoverBorder: "hover:border-(--color-success)" },
  tournament: { prefix: "Tournament: ", color: "var(--color-accent)", soft: "bg-(--color-accent-soft)", action: "bg-(--color-accent-soft) text-(--color-accent)", hoverBorder: "hover:border-(--color-accent)" }
} as const;

export function StatusBadge({ label, tone }: { label: string; tone: ContentTone }) {
  return <span className={`rounded-full border px-2 py-0.5 text-sm font-semibold ${STATUS_TONES[tone]}`}>{label}</span>;
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
  play,
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
  play?: { to: string; label: string };
  menu?: ReactNode;
}) {
  const locale = useLocale();
  const { prefix, color, soft, action, hoverBorder } = KINDS[kind];
  const clue = kind === "quiz" && preview && preview.type !== "cover_title" ? preview : undefined;
  return (
    <div className={`relative flex min-w-0 w-full flex-col rounded-xl border border-(--color-border) bg-(--color-surface) ${kind === "quiz" ? "h-full" : ""} ${hoverBorder}`}>
      <div className="flex flex-1 items-stretch overflow-hidden rounded-t-[inherit]">
        <div className={`flex w-24 shrink-0 items-center justify-center sm:w-32 border-r border-(--color-border) ${soft}`}>
          <GameTicketArt kind={kind} covers={covers} ladder={ladder} preview={preview} color={color} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-4 py-3">
          <h3 className="line-clamp-2 text-lg font-semibold sm:text-xl">
            <Link to={to} className="after:absolute after:inset-0">
              <span className="sr-only">{prefix}</span>
              {name}
            </Link>
          </h3>
          <div className="min-w-0 text-sm text-(--color-text-dim)">{meta}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">{badges}</div>
          {stats.length > 0 && (
            <div data-stats className="mt-2 flex flex-wrap gap-4 border-t border-(--color-border) pt-3">
              {stats.map((stat) => (
                <div key={stat.label} className="flex flex-col gap-1">
                  <span className="text-xl font-semibold">{stat.value}</span>
                  <span className="text-sm text-(--color-text-dim)">{stat.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {clue && (
        <section className="mx-4 mb-3 flex flex-col gap-2 rounded-lg border-l-2 border-(--color-border) bg-(--color-bg) px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-(--color-text-dim)">
            <span aria-hidden="true" className="flex">{clue.type === "title_cover" ? <LibraryIcon size={20} /> : <QuoteIcon size={20} />}</span>
            {quizClueHeading(clue.type, locale)}
          </div>
          <p className="line-clamp-3 text-base">{clue.prompt}</p>
        </section>
      )}
      <div className="relative z-10 mt-auto flex items-center gap-2 border-t border-dashed border-inherit px-4 py-3">
        <span aria-hidden="true" className="pointer-events-none absolute -top-2 -left-px h-4 w-2 rounded-r-full border border-l-0 border-solid border-inherit bg-(--color-bg)" />
        <span aria-hidden="true" className="pointer-events-none absolute -top-2 -right-px h-4 w-2 rounded-l-full border border-r-0 border-solid border-inherit bg-(--color-bg)" />
        <Link
          to={to}
          aria-label={`${actionLabel}: ${name}`}
          className={`flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-4 text-base font-semibold ${action} hover:brightness-90 hover:text-(--color-text)`}
        >
          <span className="min-w-0 truncate">{actionLabel}</span>
          <ChevronRightIcon size={20} />
        </Link>
        {play && (
          <Link
            to={play.to}
            aria-label={`${play.label}: ${name}`}
            className="relative z-10 flex min-h-11 shrink-0 items-center rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-base font-semibold hover:bg-(--color-surface-hover)"
          >
            {play.label}
          </Link>
        )}
        {menu}
      </div>
    </div>
  );
}
