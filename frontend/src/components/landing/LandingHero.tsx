import { Link } from "react-router-dom";

const shelf = [
  { title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", from: "#a85c32", to: "#5c3a24", shift: "-64px", rotate: "-6deg" },
  { title: "Piranesi", author: "Susanna Clarke", from: "#6b4f8f", to: "#3c2d54", shift: "-32px", rotate: "3deg" },
  { title: "Project Hail Mary", author: "Andy Weir", from: "#285f7a", to: "#173544", shift: "0px", rotate: "-2deg" },
  { title: "Gilead", author: "Marilynne Robinson", from: "#47713c", to: "#2a4224", shift: "32px", rotate: "5deg" },
  { title: "Circe", author: "Madeline Miller", from: "#b3432f", to: "#5f241a", shift: "64px", rotate: "-4deg" },
];

function MockCover({ book, index }: { book: (typeof shelf)[number]; index: number }) {
  return (
    <div
      className="relative aspect-[2/3] w-32 shrink-0 rounded-2xl transition-transform duration-150 hover:-translate-y-1 sm:w-40"
      style={{
        background: `linear-gradient(160deg, ${book.from}, ${book.to})`,
        boxShadow: "inset 6px 0 8px -6px rgba(0,0,0,0.5), 0 8px 16px rgba(0,0,0,0.15)",
        transform: `translate(${book.shift}, 0) rotate(${book.rotate})`,
        zIndex: index,
      }}
    >
      <div className="absolute inset-0 flex flex-col justify-end p-3" style={{ fontFamily: '"Playfair Display", serif' }}>
        <p className="text-base leading-tight text-white">{book.title}</p>
        <p className="mt-1 text-xs text-white/80">{book.author}</p>
      </div>
    </div>
  );
}

export function LandingHero() {
  return (
    <section className="overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <p className="text-sm font-semibold text-(--color-accent)">Your reading life, in one place</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl" style={{ fontFamily: '"Playfair Display", serif' }}>
            The library behind your Kobo, finally on display.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-(--color-text-dim)">
            Scripta imports your Kobo and Goodreads history and turns it into a
            library that's actually yours — styled book cards, collections,
            murals to publish, and book tournaments with friends.
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
        </div>
        <div className="flex justify-center py-6">
          <div className="flex">
            {shelf.map((book, index) => (
              <MockCover key={book.title} book={book} index={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
