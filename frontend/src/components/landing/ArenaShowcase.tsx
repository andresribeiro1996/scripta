const tiers = [
  { label: "S", color: "#c9482f" },
  { label: "A", color: "#d98a3d" },
  { label: "B", color: "#c9a53d" },
  { label: "C", color: "#5c9e5c" },
];

function MiniCover({ from, to, className = "" }: { from: string; to: string; className?: string }) {
  return (
    <div
      className={`h-12 w-8 shrink-0 rounded-md ${className}`}
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
    />
  );
}

function SmallCover({ from, to, winner }: { from: string; to: string; winner: boolean }) {
  return (
    <MiniCover
      from={from}
      to={to}
      className={winner ? "h-9 w-6 rounded ring-2 ring-(--color-accent)" : "h-9 w-6 rounded opacity-45"}
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
            <MiniCover from="#a85c32" to="#5c3a24" />
          </div>
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-(--color-border) p-3">
            <MiniCover from="#285f7a" to="#173544" />
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
      <SmallCover from="#6b4f8f" to="#3c2d54" winner={winnerLeft} />
      <SmallCover from="#47713c" to="#2a4224" winner={!winnerLeft} />
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
            <MiniCover from="#6b4f8f" to="#3c2d54" />
            <MiniCover from="#47713c" to="#2a4224" />
            <MiniCover from="#b3432f" to="#5f241a" />
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
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-(--color-accent)">The arena</p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl" style={{ fontFamily: '"Playfair Display", serif' }}>
            Settle it with tournaments
          </h2>
          <p className="mt-3 text-lg text-(--color-text-dim)">
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
