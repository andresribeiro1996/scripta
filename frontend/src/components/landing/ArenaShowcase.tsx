import { useState } from "react";
import { TierSortDemo } from "./TierSort";
import { TournamentDemo } from "./TournamentDemo";
import { SectionIntro, container } from "./ui";

const demos = [
  ["tournament", "Tournament"],
  ["tiers", "Tier list"],
] as const;

export function ArenaShowcase() {
  const [demo, setDemo] = useState<(typeof demos)[number][0]>("tournament");

  return (
    <section id="games" className="scroll-mt-16 border-t border-(--color-border)">
      <div className={`${container} py-20 sm:py-28`}>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <SectionIntro title="Settle it with a tournament">
            Put your books head to head and vote your way to a champion, or sort a shelf into tiers. Share the link and
            friends can vote too.
          </SectionIntro>
          <div className="flex items-center gap-3">
            <span className="text-sm text-(--color-text-dim)">Try it</span>
            <div role="group" aria-label="Choose a demo" className="flex rounded-lg border border-(--color-border) bg-(--color-surface) p-1">
              {demos.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={demo === value}
                  onClick={() => setDemo(value)}
                  className={`min-h-11 rounded-md px-4 text-sm font-semibold transition-colors ${
                    demo === value ? "bg-(--color-bg) text-(--color-text)" : "text-(--color-text-dim) hover:text-(--color-text)"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-10">{demo === "tournament" ? <TournamentDemo /> : <TierSortDemo />}</div>
      </div>
    </section>
  );
}
