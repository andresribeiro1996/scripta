import { container } from "./ui";
import { WaitlistForm } from "./WaitlistForm";

export function GetStarted() {
  return (
    <section id="start" className="scroll-mt-16">
      <div className={`${container} flex flex-col items-center py-16 text-center sm:py-20 lg:py-30`}>
        <svg width="96" height="87" viewBox="0 0 76 69" aria-hidden="true" className="block h-[87px] w-[96px] text-(--color-text) lg:h-[109px] lg:w-[120px]">
          <g fill="currentColor">
            <rect x="3.75" y="3" width="11" height="66" transform="rotate(18 14.75 69)" />
            <rect x="55.54" y="3" width="17" height="66" transform="rotate(-18 55.54 69)" />
            <rect x="18" y="41" width="36" height="5" />
          </g>
        </svg>
        <div
          className="mt-6 h-0.5 w-full max-w-[358px] lg:max-w-none"
          style={{ background: "linear-gradient(to right, transparent 0%, var(--color-border) 30%, var(--color-border) 70%, transparent 100%)" }}
        />
        <h2 className="mt-11 font-display text-[2.125rem] leading-tight sm:mt-16 lg:text-5xl">Get notified at launch</h2>
        <p className="mx-auto mt-3 max-w-[540px] text-pretty text-lg leading-relaxed text-(--color-text-dim)">
          Leave your email and we’ll let you know the day Atmyshelf opens.
        </p>
        <div className="mt-6 flex w-full justify-center sm:mt-8">
          <WaitlistForm label="Email address" />
        </div>
        <div className="mt-12 max-w-[460px] sm:mt-20">
          <div className="font-display text-[17px] lg:text-lg">Colophon</div>
          <p className="mt-2 text-pretty text-[13px] leading-relaxed text-(--color-text-dim)">
            Headings set in Playfair Display, everything else in your device’s own sans. Covers from Open Library. Private
            until you publish; no account needed to read what you share.
          </p>
        </div>
      </div>
    </section>
  );
}
