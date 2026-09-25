const tiers = [
  { label: "S", color: "#c9482f" },
  { label: "A", color: "#d98a3d" },
  { label: "B", color: "#c9a53d" },
  { label: "C", color: "#5c9e5c" },
];

function MiniCover({ from, to }: { from: string; to: string }) {
  return (
    <div
      className="h-12 w-8 shrink-0 rounded-md"
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
    />
  );
}

export function ArenaShowcase() {
  return (
    <section id="arena" className="scroll-mt-14">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:py-24">
        <div className="order-2 lg:order-1">
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
            <p className="text-center text-xs font-semibold text-(--color-text-dim)">Which cover wins?</p>
            <div className="mt-3 flex items-stretch justify-center gap-3">
              <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-(--color-accent) p-3">
                <MiniCover from="#a85c32" to="#5c3a24" />
              </div>
              <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-(--color-border) p-3">
                <MiniCover from="#285f7a" to="#173544" />
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-(--color-border)">
              <div className="h-2 w-[62%] rounded-full bg-(--color-accent)" />
            </div>
            <p className="mt-1 text-right text-xs text-(--color-text-dim)">62% · 34 votes</p>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-(--color-border)">
            {tiers.map((tier) => (
              <div key={tier.label} className="flex items-center gap-3 border-b border-(--color-border) p-2 last:border-b-0">
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
        </div>
        <div className="order-1 lg:order-2">
          <h2 className="text-3xl font-bold">Arena: settle what's best, with friends</h2>
          <p className="mt-3 max-w-xl text-lg text-(--color-text-dim)">
            Seed a bracket of your books and vote through the duels, or drag
            your shelf onto a tier list. Tournaments end with a ranked,
            shareable result.
          </p>
        </div>
      </div>
    </section>
  );
}
