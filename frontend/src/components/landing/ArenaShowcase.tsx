import { container } from "./ui";
import { TournamentBracket } from "./TournamentBracket";
import { TierListDemo } from "./TierListDemo";
import { VoteShowcase } from "./VoteShowcase";
import { PickCards } from "./PickCards";

const TIER_COLORS = ["#c9482f", "#d98a3d", "#c9a53d", "#5c9e5c", "#4a7fc9"];

export function ArenaShowcase() {
  return (
    <section
      id="games"
      className="scroll-mt-16 [background:linear-gradient(to_bottom,var(--color-bg)_0,var(--color-surface)_96px,var(--color-surface)_calc(100%-96px),var(--color-bg)_100%)] lg:[background:linear-gradient(to_bottom,var(--color-bg)_0,var(--color-surface)_160px,var(--color-surface)_calc(100%-160px),var(--color-bg)_100%)]"
    >
      <div className={`${container} pb-18 pt-16 lg:pb-30 lg:pt-28`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
          <div>
            <div aria-hidden="true" className="flex h-1.5 w-40 overflow-hidden rounded-full lg:w-50">
              {TIER_COLORS.map((color) => (
                <span key={color} className="flex-1" style={{ background: color }} />
              ))}
            </div>
            <h2 className="mt-5 font-display text-[2rem] leading-[1.25] lg:mt-7 lg:text-[2.5rem] lg:leading-[1.2]">Settle it</h2>
          </div>
          <p className="text-base leading-relaxed text-(--color-text-dim) lg:w-[580px] lg:shrink-0 lg:text-lg">
            Run a tournament or a tier list from your own shelves, then send the link: friends vote without an account. Both of these are playable.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4 lg:mt-12 lg:grid lg:grid-cols-2 lg:gap-8">
          <TournamentBracket />
          <TierListDemo />
        </div>

        <VoteShowcase />
        <PickCards />
      </div>
    </section>
  );
}
