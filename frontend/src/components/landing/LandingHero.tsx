import { Link } from "react-router-dom";
import { container, primaryButton, textLink } from "./ui";

export function LandingHero() {
  return (
    <section>
      <div className={`${container} pb-16 pt-14 sm:pb-24 sm:pt-20 lg:pb-32 lg:pt-24`}>
        <h1 className="max-w-3xl font-display text-[2.5rem] leading-[1.05] tracking-[-0.01em] text-balance sm:text-6xl lg:text-7xl">
          Your reading life, properly kept.
        </h1>
        <p className="mt-5 max-w-xl text-pretty text-[17px] leading-relaxed text-(--color-text-dim) sm:mt-6 sm:text-lg">
          Bring your books from Kobo, Goodreads and StoryGraph into one personal library. Organise your shelves, revisit
          your highlights and share what you love.
        </p>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-7">
          <Link to="/login?mode=signup" className={primaryButton}>
            Create your library
          </Link>
          <a href="#how" className={`${textLink} text-sm`}>
            See how it works
          </a>
        </div>
        <div className="relative mt-12 sm:mt-16">
          <picture>
            <source media="(min-width: 640px) and (prefers-color-scheme: dark)" srcSet="/landing/library-desktop-dark.webp" width={1920} height={1170} />
            <source media="(min-width: 640px)" srcSet="/landing/library-desktop-light.webp" width={1920} height={1170} />
            <source media="(prefers-color-scheme: dark)" srcSet="/landing/home-phone-dark.webp" />
            <img
              src="/landing/home-phone-light.webp"
              width={585}
              height={1140}
              fetchPriority="high"
              alt="A reader's library in Atmyshelf: book covers with titles, authors and reading status"
              className="mx-auto h-auto w-[80%] max-w-[320px] rounded-[1.75rem] border border-(--color-border) shadow-xl sm:w-full sm:max-w-none sm:rounded-xl"
            />
          </picture>
          <picture className="absolute -bottom-12 -right-2 hidden w-[21%] lg:block">
            <source media="(prefers-color-scheme: dark)" srcSet="/landing/home-phone-dark.webp" />
            <img
              src="/landing/home-phone-light.webp"
              width={585}
              height={1140}
              loading="lazy"
              alt="Atmyshelf on a phone, showing what's being read and what's up next"
              className="h-auto w-full rounded-[1.75rem] border border-(--color-border) shadow-xl ring-[6px] ring-(--color-bg)"
            />
          </picture>
        </div>
      </div>
    </section>
  );
}
