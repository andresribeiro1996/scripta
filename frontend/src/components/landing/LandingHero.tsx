import { BOOKS, coverSrc } from "./books";
import { container, textLink } from "./ui";
import { WaitlistForm } from "./WaitlistForm";

function CartographerPlate({ className, width, height }: { className: string; width: number; height: number }) {
  return (
    <picture className={className}>
      <source media="(prefers-color-scheme: dark)" srcSet="/reader-cards/i-carto-reversed.svg" />
      <img src="/reader-cards/i-carto-paper.svg" width={width} height={height} alt="" className="block h-full w-full rounded-[3px]" />
    </picture>
  );
}

export function LandingHero() {
  const piranesi = BOOKS.piranesi;
  return (
    <section id="top" className="scroll-mt-16">
      <div className={`${container} flex flex-col gap-10 pt-10 pb-12 sm:pt-14 sm:pb-16 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:pt-26 lg:pb-16`}>
        <div className="w-full lg:w-[600px]">
          <div className="text-xs font-bold tracking-[1px] text-(--color-accent) uppercase lg:text-[13px]">Not a reading tracker</div>
          <h1 className="mt-3 font-display text-[2.75rem] leading-[1.05] tracking-[-0.01em] text-balance sm:mt-4 lg:text-[4.75rem]">
            Your books, on show and up for debate.
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-[17px] leading-relaxed text-(--color-text-dim) sm:mt-6 lg:max-w-[520px] lg:text-lg">
            No page counts, no streaks, no goals. Bring in what you’ve already read from Kobo, Goodreads or StoryGraph, then make
            something of it: a page to share, and tournaments and tier lists your friends vote on.
          </p>
          <div className="mt-7 sm:mt-8">
            <WaitlistForm label="Get an email when Atmyshelf launches" />
          </div>
          <a href="#games" className={`${textLink} mt-2 text-[15px] lg:hidden`}>
            See the games
          </a>
        </div>

        <div aria-hidden="true" className="relative mt-2 h-[400px] w-full max-w-[358px] lg:mt-0 lg:h-[560px] lg:w-[480px] lg:max-w-none lg:shrink-0">
          <img
            src={coverSrc("piranesi")}
            alt=""
            className="absolute top-[70px] left-5 z-[2] block h-[225px] w-[150px] rotate-[-4deg] rounded-[5px] object-cover shadow-[0_16px_22px_-6px_rgb(0_0_0_/_0.2)] lg:top-24 lg:left-10 lg:h-[330px] lg:w-[220px] lg:rounded-md lg:shadow-[0_20px_25px_-5px_rgb(0_0_0_/_0.18),0_8px_10px_-6px_rgb(0_0_0_/_0.18)]"
          />
          <CartographerPlate
            width={176}
            height={246}
            className="absolute top-[190px] left-[200px] z-[3] h-[174px] w-[124px] rotate-[6deg] shadow-[0_16px_22px_-6px_rgb(0_0_0_/_0.16)] lg:top-[262px] lg:left-[262px] lg:h-[246px] lg:w-[176px] lg:shadow-[0_20px_25px_-5px_rgb(0_0_0_/_0.14),0_8px_10px_-6px_rgb(0_0_0_/_0.14)]"
          />
          <div className="absolute top-4 left-[146px] z-[4] w-[200px] rounded-sm border border-(--color-border) bg-(--color-surface) p-4 rotate-[3deg] shadow-[0_16px_22px_-6px_rgb(0_0_0_/_0.12)] lg:top-9 lg:left-[196px] lg:w-[264px] lg:p-[22px] lg:pb-[18px] lg:shadow-[0_20px_25px_-5px_rgb(0_0_0_/_0.1),0_8px_10px_-6px_rgb(0_0_0_/_0.1)]">
            <p className="font-display text-[15px] leading-snug lg:text-[19px]">
              “The Beauty of the House is immeasurable; its Kindness infinite.”
            </p>
            <p className="mt-2.5 text-[11px] text-(--color-text-dim) lg:mt-3 lg:text-xs">
              Your highlight in {piranesi.title}, from Kobo
            </p>
          </div>
          <div className="absolute top-[318px] left-0 z-[5] w-[204px] rotate-[-2deg] rounded-[10px] border border-(--color-border) bg-(--color-surface) p-3.5 shadow-[0_16px_22px_-6px_rgb(0_0_0_/_0.12)] lg:top-[440px] lg:w-[244px] lg:rounded-xl lg:p-4 lg:shadow-[0_20px_25px_-5px_rgb(0_0_0_/_0.1),0_8px_10px_-6px_rgb(0_0_0_/_0.1)]">
            <div className="text-xs font-semibold">Finished · 11 Feb 2026</div>
            <div className="mt-2 flex items-center justify-between lg:mt-2.5">
              <span className="text-[11px] text-(--color-text-dim) lg:text-xs">How did it land?</span>
              <span className="inline-flex h-[26px] items-center rounded-full border border-(--color-accent) bg-(--color-accent-soft) px-2.5 text-[11px] font-semibold text-(--color-accent) lg:text-xs">
                All-time
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
