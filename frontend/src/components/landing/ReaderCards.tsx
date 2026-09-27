const plates = [
  { name: "The Cartographer", slug: "i-carto" },
  { name: "The Lamplighter", slug: "iii-lamp" },
  { name: "The Archivist", slug: "v-arch" },
];

export function ReaderCards() {
  return (
    <div className="mt-20 grid items-center gap-10 border-t border-(--color-border) pt-14 sm:mt-24 lg:grid-cols-[1fr_1.3fr] lg:gap-16">
      <div className="max-w-md">
        <span className="inline-flex rounded-full bg-(--color-accent-soft) px-3 py-1 text-xs font-semibold">Coming soon</span>
        <h3 className="mt-4 font-display text-2xl leading-tight sm:text-3xl">Reader cards</h3>
        <p className="mt-3 text-pretty text-[15px] leading-relaxed text-(--color-text-dim)">
          A bookplate matched to how you read, from a set of eight drawn for Atmyshelf, listing the books that earned it.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:gap-6">
        {plates.map((plate) => (
          <picture key={plate.slug}>
            <source media="(prefers-color-scheme: dark)" srcSet={`/reader-cards/${plate.slug}-reversed.svg`} />
            <img
              src={`/reader-cards/${plate.slug}-paper.svg`}
              width={250}
              height={350}
              loading="lazy"
              alt={`${plate.name} reader card`}
              className="h-auto w-full shadow-lg"
            />
          </picture>
        ))}
      </div>
    </div>
  );
}
