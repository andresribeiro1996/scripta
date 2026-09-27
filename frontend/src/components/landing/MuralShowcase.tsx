import { ReaderCards } from "./ReaderCards";
import { SectionIntro, container } from "./ui";

const shelfCovers = ["piranesi", "gilead", "circe", "achilles", "normal-people"];

const points = [
  "Quotes come straight from your highlights",
  "Stats keep count as you read",
  "Share a mural or your whole library, or keep both to yourself",
];

export function MuralShowcase() {
  return (
    <section id="sharing" className="scroll-mt-16">
      <div className={`${container} py-20 sm:py-28`}>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionIntro title="A page for your reading life">
              Compose a mural from shelves, quotes, stats and photos, then share it at a link. Visitors see your reading
              life the way you arranged it, without needing an account.
            </SectionIntro>
            <ul className="mt-8 max-w-md divide-y divide-(--color-border) border-y border-(--color-border) text-[15px]">
              {points.map((point) => (
                <li key={point} className="py-3">
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <figure>
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-(--color-border) p-3 sm:gap-4 sm:p-4">
              <div className="col-span-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
                <p className="text-sm font-semibold">Favourites</p>
                <div className="mt-3 grid grid-cols-5 gap-2 sm:gap-3">
                  {shelfCovers.map((cover) => (
                    <img key={cover} src={`/covers/${cover}.jpg`} alt="" loading="lazy" className="aspect-[2/3] w-full rounded-md object-cover" />
                  ))}
                </div>
              </div>
              <div className="flex flex-col justify-center rounded-xl border border-(--color-border) bg-(--color-surface) p-4 sm:p-5">
                <p className="font-display text-base leading-snug sm:text-lg">
                  “The Beauty of the House is immeasurable; its Kindness infinite.”
                </p>
                <p className="mt-3 text-xs text-(--color-text-dim)">Susanna Clarke, Piranesi</p>
              </div>
              <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 sm:p-5">
                <p className="text-3xl font-bold text-(--color-accent)">19</p>
                <p className="text-xs text-(--color-text-dim)">books in the library</p>
                <p className="mt-4 text-3xl font-bold text-(--color-accent)">6</p>
                <p className="text-xs text-(--color-text-dim)">finished this year</p>
              </div>
            </div>
            <figcaption className="mt-3 text-sm text-(--color-text-dim)">An example mural</figcaption>
          </figure>
        </div>
        <ReaderCards />
      </div>
    </section>
  );
}
