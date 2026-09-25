const shelfCovers = [
  { from: "#a85c32", to: "#5c3a24" },
  { from: "#285f7a", to: "#173544" },
  { from: "#47713c", to: "#2a4224" },
  { from: "#6b4f8f", to: "#3c2d54" },
  { from: "#b3432f", to: "#5f241a" },
];

export function MuralShowcase() {
  return (
    <section id="murals" className="scroll-mt-14 border-y border-(--color-border)">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <h2 className="text-3xl font-bold">Murals: your library, composed</h2>
          <p className="mt-3 max-w-xl text-lg text-(--color-text-dim)">
            Drag shelves, quotes, stats and photos onto a freeform canvas.
            Publish it at a link that shows your reading life the way you want
            it told.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 sm:col-span-2">
            <div className="flex gap-2 overflow-hidden">
              {shelfCovers.map((cover, index) => (
                <div
                  key={index}
                  className="aspect-[2/3] w-14 shrink-0 rounded-md"
                  style={{ background: `linear-gradient(160deg, ${cover.from}, ${cover.to})` }}
                />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
            <p className="text-lg leading-snug" style={{ fontFamily: '"Playfair Display", serif' }}>
              “A reader lives a thousand lives before he dies.”
            </p>
            <p className="mt-2 text-xs text-(--color-text-dim)">George R. R. Martin</p>
          </div>
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
            <p className="text-3xl font-bold text-(--color-accent)">312</p>
            <p className="text-xs text-(--color-text-dim)">books imported</p>
            <p className="mt-3 text-3xl font-bold text-(--color-accent)">48</p>
            <p className="text-xs text-(--color-text-dim)">finished this year</p>
          </div>
        </div>
      </div>
    </section>
  );
}
