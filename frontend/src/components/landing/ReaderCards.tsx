const identities = [
  { numeral: "I", name: "The Cartographer", slug: "i-carto" },
  { numeral: "II", name: "The Annotator", slug: "ii-anno" },
  { numeral: "III", name: "The Lamplighter", slug: "iii-lamp" },
  { numeral: "IV", name: "The Stargazer", slug: "iv-star" },
  { numeral: "V", name: "The Archivist", slug: "v-arch" },
  { numeral: "VI", name: "The Correspondent", slug: "vi-corr" },
  { numeral: "VII", name: "The Wayfarer", slug: "vii-way" },
  { numeral: "VIII", name: "The Loyalist", slug: "viii-loyal" },
];

function Plate({ slug }: { slug: string }) {
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={`/reader-cards/${slug}-reversed.svg`} />
      <img src={`/reader-cards/${slug}-paper.svg`} alt="" loading="lazy" className="w-full" />
    </picture>
  );
}

export function ReaderCards() {
  return (
    <section className="scroll-mt-14">
      <div className="mx-auto max-w-6xl px-4 py-16 lg:py-24">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-(--color-text-dim)">
            <span aria-hidden className="h-px w-4 bg-(--color-accent)" />
            Reader cards
          </p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl" style={{ fontFamily: '"Playfair Display", serif' }}>
            Eight reader identities, engraved
          </h2>
          <p className="text-pretty mt-3 text-lg text-(--color-text-dim)">
            Scripta marks a reading life the way books used to be signed — with
            a plate. Yours reflects how you read: the notes you keep, the maps
            you draw, the tournaments you take.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
          {identities.map((identity) => (
            <figure key={identity.slug}>
              <Plate slug={identity.slug} />
              <figcaption className="mt-3 text-center">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--color-text-dim)">{identity.numeral}</span>
                <span className="mt-0.5 block text-sm font-semibold" style={{ fontFamily: '"Playfair Display", serif' }}>
                  {identity.name}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
