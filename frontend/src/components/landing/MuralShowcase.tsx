import { READER_PLATES } from "@scripta/shared";
import { ReaderCards } from "./ReaderCards";
import { BOOKS, coverSrc, readerCardSrc, type BookSlug } from "./books";
import { container } from "./ui";

const favourites: BookSlug[] = ["piranesi", "gilead", "stoner", "remains", "circe", "the-road"];

export function MuralShowcase() {
  const correspondent = READER_PLATES.find((plate) => plate.key === "corr")!;
  const correspondentSrc = readerCardSrc(correspondent);

  return (
    <section id="sharing" className="scroll-mt-16">
      <div className={`${container} py-20 sm:py-28`}>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
          <h2 className="font-display text-3xl leading-tight text-balance sm:text-[2.5rem] lg:w-[520px]">
            A page for your reading life
          </h2>
          <p className="text-pretty text-lg leading-relaxed text-(--color-text-dim) lg:w-[520px]">
            Compose a mural from shelves, quotes, stats, tier lists and your reader card, then share it at a link.
            Visitors see it the way you arranged it, without needing an account.
          </p>
        </div>

        <figure className="mt-10 lg:mt-14">
          <div className="grid grid-cols-2 gap-3 rounded-[20px] border border-(--color-border) bg-(--color-bg) p-4 lg:grid-cols-12 lg:auto-rows-[250px]">
            <div className="col-span-2 flex flex-col rounded-xl border border-(--color-border) bg-(--color-surface) p-5 lg:col-span-4">
              <div className="flex items-center gap-3.5">
                <span
                  aria-hidden
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) font-display text-[26px]"
                >
                  E
                </span>
                <div>
                  <div className="text-lg font-semibold">Eleanor</div>
                  <div className="text-[13px] text-(--color-text-dim)">@eleanor · 19 books</div>
                </div>
              </div>
              <p className="mt-4 font-display text-lg leading-[1.4]">Mostly novels, the odd myth, and anything by Ishiguro.</p>
              <div className="mt-4 flex gap-2 lg:mt-auto">
                <span className="inline-flex h-7 items-center rounded-full bg-(--color-accent-soft) px-3 text-xs font-semibold">
                  Literary fiction
                </span>
                <span className="inline-flex h-7 items-center rounded-full bg-(--color-accent-soft) px-3 text-xs font-semibold">Myth</span>
              </div>
            </div>

            <div className="col-span-1 flex items-center justify-center rounded-xl bg-[#44252e] lg:col-span-3">
              <img
                src={coverSrc("gilead")}
                alt={`${BOOKS.gilead.title} by ${BOOKS.gilead.author}`}
                loading="lazy"
                className="block aspect-2/3 w-[93px] rounded-md object-cover shadow-[0_16px_28px_-12px_rgb(0_0_0/0.6)] sm:w-[112px] lg:w-[140px]"
              />
            </div>

            <div className="col-span-1 flex flex-col justify-center rounded-xl border border-(--color-border) bg-(--color-surface) p-6 lg:col-span-5 lg:px-8 lg:py-7">
              <p className="font-display text-lg leading-[1.3] sm:text-xl lg:text-[26px]">
                “Wherever you turn your eyes the world can shine like transfiguration.”
              </p>
              <p className="mt-3.5 text-[13px] text-(--color-text-dim)">Marilynne Robinson, Gilead</p>
            </div>

            <div className="col-span-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-5 lg:col-span-6">
              <p className="text-sm font-semibold">All-time favourites</p>
              <div className="mt-4 grid grid-cols-6 gap-2.5">
                {favourites.map((slug) => (
                  <img
                    key={slug}
                    src={coverSrc(slug)}
                    alt={BOOKS[slug].title}
                    loading="lazy"
                    className="block aspect-2/3 w-full rounded-sm object-cover"
                  />
                ))}
              </div>
            </div>

            <div className="col-span-1 flex flex-col justify-center gap-5 rounded-xl border border-(--color-border) bg-(--color-surface) p-6 lg:col-span-3">
              <div>
                <p className="text-3xl leading-none font-bold text-(--color-accent) lg:text-[36px]">19</p>
                <p className="mt-1.5 text-[13px] text-(--color-text-dim)">Books in your library</p>
              </div>
              <div>
                <p className="text-3xl leading-none font-bold text-(--color-accent) lg:text-[36px]">6</p>
                <p className="mt-1.5 text-[13px] text-(--color-text-dim)">Finished this year</p>
              </div>
            </div>

            <div className="col-span-1 flex items-center justify-center rounded-xl border border-(--color-border) bg-(--color-surface) lg:col-span-3">
              <img
                src={correspondentSrc.paper}
                alt={`The ${correspondent.name} reader card`}
                loading="lazy"
                className="aspect-5/7 w-[100px] rounded-[3px] shadow-[0_12px_22px_-10px_rgb(0_0_0/0.4)] sm:w-[125px] lg:w-[150px] dark:hidden"
              />
              <img
                src={correspondentSrc.reversed}
                alt={`The ${correspondent.name} reader card`}
                loading="lazy"
                className="hidden aspect-5/7 w-[100px] rounded-[3px] shadow-[0_12px_22px_-10px_rgb(0_0_0/0.4)] sm:w-[125px] lg:w-[150px] dark:block"
              />
            </div>
          </div>
          <figcaption className="mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-(--color-text-dim)">
            <span>An example mural</span>
            <span>Shared at atmyshelf.com/shared/murals/…</span>
          </figcaption>
        </figure>

        <ReaderCards />
      </div>
    </section>
  );
}
