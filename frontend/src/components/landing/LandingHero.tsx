import { Link } from "react-router-dom";

const shelf = ["piranesi", "hail-mary", "circe", "gilead", "achilles", "normal-people"];

export function LandingHero() {
  return (
    <section>
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:py-24">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-(--color-text-dim)">
            <span aria-hidden className="h-px w-4 bg-(--color-accent)" />
            Ex libris
          </p>
          <h1
            className="mt-4 max-w-xl text-balance text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl"
            style={{ fontFamily: '"Playfair Display", serif' }}
          >
            Your reading life, <em className="text-(--color-accent)">beautifully</em> kept.
          </h1>
          <p className="mt-5 max-w-lg text-pretty text-lg leading-relaxed text-(--color-text-dim)">
            Scripta imports your Kobo, Goodreads and StoryGraph history into a
            library that's actually yours — styled book cards, murals worth
            publishing, and tournaments that settle what's best.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/login?mode=signup"
              className="rounded-lg bg-(--color-accent) px-6 py-3 text-base font-semibold text-(--color-on-accent) transition-opacity hover:opacity-90"
            >
              Create your library
            </Link>
            <a
              href="#features"
              className="rounded-lg border border-(--color-border) bg-(--color-surface) px-6 py-3 text-base font-semibold transition-colors hover:bg-(--color-surface-hover)"
            >
              See how it works
            </a>
          </div>
          <p className="mt-10 border-t border-(--color-border) pt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-(--color-text-dim)">
            Imports from <span className="text-(--color-text)">Kobo</span> · <span className="text-(--color-text)">Goodreads</span> · <span className="text-(--color-text)">StoryGraph</span>
          </p>
        </div>
        <div className="rounded-2xl border border-(--color-border) bg-(--color-surface) p-4 shadow-[0_24px_60px_rgba(32,30,28,0.12)]">
          <div className="mb-3 flex gap-1.5 px-1">
            <span className="h-2 w-2 rounded-full bg-(--color-border)" />
            <span className="h-2 w-2 rounded-full bg-(--color-border)" />
            <span className="h-2 w-2 rounded-full bg-(--color-accent)" />
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {shelf.map((cover) => (
              <img key={cover} src={`/covers/${cover}.jpg`} alt="" className="aspect-[2/3] w-full rounded-lg object-cover" />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
