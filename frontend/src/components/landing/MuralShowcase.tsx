const shelfCovers = ["piranesi", "circe", "hail-mary", "sapiens", "achilles"];

export function MuralShowcase() {
  return (
    <section id="murals" className="scroll-mt-14 border-y border-(--color-border)">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-(--color-text-dim)">
            <span aria-hidden className="h-px w-4 bg-(--color-accent)" />
            Murals
          </p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl" style={{ fontFamily: '"Playfair Display", serif' }}>
            Your library, composed
          </h2>
          <p className="text-pretty mt-3 text-lg text-(--color-text-dim)">
            Drag shelves, quotes, stats and photos onto a freeform canvas.
            Publish it at a link that shows your reading life the way you want
            it told.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 sm:col-span-2">
            <div className="flex gap-2 overflow-hidden">
              {shelfCovers.map((cover) => (
                <img key={cover} src={`/covers/${cover}.jpg`} alt="" loading="lazy" className="aspect-[2/3] w-14 shrink-0 rounded-md object-cover" />
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
