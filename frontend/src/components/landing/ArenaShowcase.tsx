const tiers = [
  { label: "S", color: "#c9482f" },
  { label: "A", color: "#d98a3d" },
  { label: "B", color: "#c9a53d" },
  { label: "C", color: "#5c9e5c" },
];

function MiniCover({ src, className = "" }: { src: string; className?: string }) {
  return <img src={`/covers/${src}.jpg`} alt="" loading="lazy" className={`h-12 w-8 shrink-0 rounded-md object-cover ${className}`} />;
}

function SmallCover({ src, winner }: { src: string; winner: boolean }) {
  return (
    <MiniCover
      src={src}
      className={winner ? "h-9 w-6 ring-2 ring-(--color-accent)" : "h-9 w-6 opacity-45"}
    />
  );
}

function DuelMockup() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-(--color-text-dim)">The duel</p>
      <div className="mt-4 flex flex-1 items-center">
        <div className="flex flex-1 items-stretch justify-center gap-3">
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-(--color-accent) p-3">
            <MiniCover src="piranesi" />
          </div>
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-(--color-border) p-3">
            <MiniCover src="hail-mary" />
          </div>
        </div>
      </div>
      <div className="mt-4 h-2 rounded-full bg-(--color-border)">
        <div className="h-2 w-[62%] rounded-full bg-(--color-accent)" />
      </div>
      <p className="mt-1 text-right text-xs text-(--color-text-dim)">62% · 34 votes</p>
    </div>
  );
}

function BracketMatch({ winnerLeft }: { winnerLeft: boolean }) {
  return (
    <div className="flex items-center justify-center gap-1.5 rounded-lg border border-(--color-border) bg-(--color-bg) px-2 py-1.5">
      <SmallCover src="circe" winner={winnerLeft} />
      <SmallCover src="normal-people" winner={!winnerLeft} />
    </div>
  );
}

function BracketMockup() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-(--color-text-dim)">The bracket</p>
      <div className="flex flex-1 items-stretch py-4">
        <div className="flex flex-1 flex-col justify-around gap-6">
          <BracketMatch winnerLeft />
          <BracketMatch winnerLeft={false} />
        </div>
        <div className="relative mx-2 w-5 shrink-0">
          <span className="absolute left-0 top-1/4 h-px w-full bg-(--color-border)" />
          <span className="absolute left-0 top-3/4 h-px w-full bg-(--color-border)" />
          <span className="absolute left-0 top-1/4 h-1/2 w-px bg-(--color-border)" />
          <span className="absolute left-0 top-1/2 h-px w-full bg-(--color-border)" />
        </div>
        <div className="flex flex-1 items-center">
          <div className="flex-1">
            <BracketMatch winnerLeft />
          </div>
        </div>
      </div>
    </div>
  );
}

function TierRowsMockup() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-(--color-border)">
      {tiers.map((tier) => (
        <div key={tier.label} className="flex flex-1 items-center gap-3 border-b border-(--color-border) p-2 last:border-b-0">
          <span
            className="flex h-9 w-11 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
            style={{ backgroundColor: tier.color }}
          >
            {tier.label}
          </span>
          <div className="flex gap-1.5">
            <MiniCover src="gilead" />
            <MiniCover src="sapiens" />
            <MiniCover src="achilles" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ArenaShowcase() {
  return (
    <section id="arena" className="scroll-mt-14">
      <div className="mx-auto max-w-6xl px-4 py-16 lg:py-24">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-(--color-text-dim)">
            <span aria-hidden className="h-px w-4 bg-(--color-accent)" />
            The arena
          </p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl" style={{ fontFamily: '"Playfair Display", serif' }}>
            Settle it with tournaments
          </h2>
          <p className="mt-3 text-pretty text-lg text-(--color-text-dim)">
            Seed a tournament bracket with your books and vote through the
            duels until a champion emerges. Drag your shelf onto a tier list.
            Every tournament ends ranked, with a result worth sharing.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DuelMockup />
          <BracketMockup />
          <TierRowsMockup />
        </div>
      </div>
    </section>
  );
}
