import { Link } from "react-router-dom";

const shelf = ["piranesi", "hail-mary", "circe", "normal-people"];

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
        <div className="relative px-2 pb-10 pt-8 sm:px-8">
          <div className="absolute -top-1 right-0 z-10 flex items-center gap-2 rounded-full border border-(--color-border) bg-(--color-surface) px-3 py-1.5 shadow-[0_8px_20px_rgba(32,30,28,0.10)] sm:-right-2">
            <span className="text-xs font-bold text-(--color-accent)">62%</span>
            <span className="text-xs font-semibold text-(--color-text-dim)">The Duel — semis</span>
          </div>
          <div className="absolute bottom-14 left-0 z-10 rounded-full border border-(--color-border) bg-(--color-surface) px-3 py-1.5 shadow-[0_8px_20px_rgba(32,30,28,0.10)] sm:-left-2">
            <span className="text-xs font-bold text-(--color-accent)">+312</span>
            <span className="text-xs font-semibold text-(--color-text-dim)"> books imported</span>
          </div>
          <div className="flex items-end justify-center">
            {shelf.map((cover) => (
              <img
                key={cover}
                src={`/covers/${cover}.jpg`}
                alt=""
                className="mr-1 w-[19%] rounded-md shadow-[0_10px_24px_rgba(32,30,28,0.18)] transition-transform duration-150 hover:-translate-y-2"
              />
            ))}
            <img
              src="/covers/gilead.jpg"
              alt=""
              className="relative z-10 -ml-2 w-[15%] origin-bottom-left rounded-md shadow-[0_10px_24px_rgba(32,30,28,0.22)] transition-transform duration-150 hover:-translate-y-2"
              style={{ transform: "rotate(-9deg)", marginBottom: "2px" }}
            />
            <div className="ml-3 hidden flex-col gap-[3px] sm:flex">
              <img src="/covers/sapiens.jpg" alt="" className="h-5 w-[92px] rounded-[3px] object-cover shadow-[0_4px_10px_rgba(32,30,28,0.18)]" />
              <img src="/covers/achilles.jpg" alt="" className="h-5 w-[84px] rounded-[3px] object-cover shadow-[0_4px_10px_rgba(32,30,28,0.18)]" />
            </div>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-(--color-text) opacity-80" />
          <div className="mt-1 h-2 rounded-full bg-(--color-border) opacity-60" />
        </div>
      </div>
    </section>
  );
}

