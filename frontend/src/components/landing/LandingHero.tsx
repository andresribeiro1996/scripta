import { Link } from "react-router-dom";

const shelf = [
  { title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", from: "#a85c32", to: "#5c3a24", shift: "-48px", rotate: "-4deg" },
  { title: "Piranesi", author: "Susanna Clarke", from: "#6b4f8f", to: "#3c2d54", shift: "-24px", rotate: "-2deg" },
  { title: "Project Hail Mary", author: "Andy Weir", from: "#285f7a", to: "#173544", shift: "0px", rotate: "0deg" },
  { title: "Gilead", author: "Marilynne Robinson", from: "#47713c", to: "#2a4224", shift: "24px", rotate: "2deg" },
  { title: "Circe", author: "Madeline Miller", from: "#b3432f", to: "#5f241a", shift: "48px", rotate: "4deg" },
];

function MockCover({ book, index }: { book: (typeof shelf)[number]; index: number }) {
  return (
    <div
      className="relative aspect-[2/3] w-28 shrink-0 rounded-2xl transition-transform duration-150 hover:-translate-y-1 sm:w-32"
      style={{
        background: `linear-gradient(160deg, ${book.from}, ${book.to})`,
        boxShadow: "inset 6px 0 8px -6px rgba(0,0,0,0.5), 0 18px 36px rgba(0,0,0,0.4)",
        transform: `translate(${book.shift}, 0) rotate(${book.rotate})`,
        zIndex: index,
      }}
    >
      <div className="absolute inset-0 flex flex-col justify-end p-3" style={{ fontFamily: '"Playfair Display", serif' }}>
        <p className="text-sm leading-tight text-white sm:text-base">{book.title}</p>
        <p className="mt-1 text-[11px] text-white/80 sm:text-xs">{book.author}</p>
      </div>
    </div>
  );
}

const corners = ["-left-[3px] -top-[3px]", "-right-[3px] -top-[3px]", "-bottom-[3px] -left-[3px]", "-bottom-[3px] -right-[3px]"];

export function LandingHero() {
  return (
    <section className="bg-(--color-text) text-(--color-bg)">
      <div className="mx-auto max-w-6xl px-3 sm:px-5">
        <div className="relative my-3 border border-(--color-bg)/20 px-5 py-14 sm:my-5 sm:px-10 lg:py-24">
          {corners.map((corner) => (
            <span key={corner} aria-hidden className={`absolute h-1.5 w-1.5 rotate-45 bg-(--color-bg)/40 ${corner}`} />
          ))}
          <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-(--color-accent-soft)">Ex libris</p>
              <h1
                className="mt-4 max-w-xl text-balance text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl"
                style={{ fontFamily: '"Playfair Display", serif' }}
              >
                The library behind your Kobo, finally on display.
              </h1>
              <p className="mt-5 max-w-lg text-pretty text-lg leading-relaxed text-(--color-bg)/70">
                Scripta imports your reading history and keeps it the way a
                private library deserves — styled book cards, murals worth
                publishing, and tournaments that settle what's best.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link
                  to="/login?mode=signup"
                  className="rounded-lg bg-(--color-accent) px-6 py-3 text-base font-semibold text-(--color-on-accent) transition-opacity hover:opacity-90 focus-visible:outline-(--color-bg)"
                >
                  Create your library
                </Link>
                <a
                  href="#features"
                  className="rounded-lg border border-(--color-bg)/30 px-6 py-3 text-base font-semibold transition-colors hover:bg-(--color-bg)/10 focus-visible:outline-(--color-bg)"
                >
                  See how it works
                </a>
              </div>
              <p className="mt-10 border-t border-(--color-bg)/15 pt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-(--color-bg)/60">
                Imports from <span className="text-(--color-bg)">Kobo</span> · <span className="text-(--color-bg)">Goodreads</span> · <span className="text-(--color-bg)">StoryGraph</span>
              </p>
            </div>
            <div className="flex justify-center py-4 lg:py-0">
              <div className="flex">
                {shelf.map((book, index) => (
                  <MockCover key={book.title} book={book} index={index} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
