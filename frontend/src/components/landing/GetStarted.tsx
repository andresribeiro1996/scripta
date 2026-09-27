import { Link } from "react-router-dom";
import { container, primaryButton, textLink } from "./ui";

export function GetStarted() {
  return (
    <section id="start" className="scroll-mt-16">
      <div className={`${container} pb-20 sm:pb-28`}>
        <div className="rounded-2xl border border-(--color-border) bg-(--color-surface) px-6 py-12 text-center sm:px-12 sm:py-16">
          <h2 className="font-display text-3xl leading-tight text-balance sm:text-[2.5rem]">Start your library</h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-lg leading-relaxed text-(--color-text-dim)">
            Atmyshelf works in any browser, on any device. Apps for iPhone and Android are in beta.
          </p>
          <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-center sm:gap-7">
            <Link to="/login?mode=signup" className={primaryButton}>
              Create your library
            </Link>
            <Link to="/login" className={`${textLink} text-sm`}>
              I already have an account
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
