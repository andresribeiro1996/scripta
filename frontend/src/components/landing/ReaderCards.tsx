const identities = [
  { numeral: "I", name: "The Cartographer", slug: "i-carto" },
  { numeral: "III", name: "The Lamplighter", slug: "iii-lamp" },
  { numeral: "V", name: "The Archivist", slug: "v-arch" },
];

export function ReaderCards() {
  return (
    <section className="scroll-mt-14 bg-(--color-text) text-(--color-bg)">
      <div className="mx-auto max-w-6xl px-4 py-16 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-(--color-accent-soft)">Ex libris — reader cards</p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl" style={{ fontFamily: '"Playfair Display", serif' }}>
            Eight reader identities, engraved
          </h2>
          <p className="mt-3 text-pretty text-lg text-(--color-bg)/70">
            Scripta marks a reading life the way books used to be signed — with
            a plate. Yours reflects how you read: the notes you keep, the maps
            you draw, the tournaments you take.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
          {identities.map((identity) => (
            <figure key={identity.slug} className="transition-transform duration-150 hover:-translate-y-1">
              <img
                src={`/reader-cards/${identity.slug}-paper.svg`}
                alt=""
                loading="lazy"
                className="w-full shadow-[0_14px_40px_rgba(0,0,0,0.45)]"
              />
              <figcaption className="mt-3 text-center">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--color-bg)/60">{identity.numeral}</span>
                <span className="mt-0.5 block text-sm font-semibold" style={{ fontFamily: '"Playfair Display", serif' }}>
                  {identity.name}
                </span>
              </figcaption>
            </figure>
          ))}
          <figure className="flex flex-col">
            <div className="flex aspect-[250/350] items-center justify-center rounded-sm border border-dashed border-(--color-bg)/30">
              <span className="text-sm font-semibold text-(--color-bg)/60">+5 more</span>
            </div>
            <figcaption className="mt-3 text-center">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--color-bg)/60">VI—VIII</span>
              <span className="mt-0.5 block text-sm font-semibold text-(--color-bg)/60" style={{ fontFamily: '"Playfair Display", serif' }}>
                earned by how you read
              </span>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
