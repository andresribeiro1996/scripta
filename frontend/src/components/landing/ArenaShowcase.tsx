import { TournamentDemo } from "./TournamentDemo";

export function ArenaShowcase() {
  return (
    <section id="arena" className="scroll-mt-14">
      <div className="mx-auto max-w-6xl px-4 py-16 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-(--color-text-dim)">
            <span aria-hidden className="h-px w-4 bg-(--color-accent)" />
            The arena
          </p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl" style={{ fontFamily: '"Playfair Display", serif' }}>
            Settle it with tournaments
          </h2>
          <p className="mt-3 text-pretty text-lg text-(--color-text-dim)">
            Seed a bracket with your books, then vote through the duels —
            winners advance until a champion takes the final. This one is
            live: run the whole tournament yourself.
          </p>
        </div>
        <div className="mt-12">
          <TournamentDemo />
        </div>
      </div>
    </section>
  );
}
