import { container } from "./ui";
import { WaitlistForm } from "./WaitlistForm";
import { ReaderCardPreview } from "./ReaderCardPreview";

export function LandingHero() {
  return (
    <section id="top" className={`${container} flex w-full flex-col items-center py-1.5 text-center md:py-2`}>
      <div>
        <h1 className="font-sans text-[clamp(1.75rem,5.5vw,3.5rem)] leading-[1.15] font-extralight tracking-[-0.015em] text-(--color-text)/85">
          Your books. Your world.
        </h1>
      </div>

      <ReaderCardPreview />

      <div id="start" className="mx-auto w-full max-w-xs scroll-mt-8 [&_form>div]:mt-3">
        <WaitlistForm label="Be there for the first chapter." />
      </div>
    </section>
  );
}
