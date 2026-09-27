import { SectionIntro, container } from "./ui";

const steps = [
  {
    title: "Bring your books",
    body: "Import straight from your Kobo, or from a Goodreads or StoryGraph export. Ratings, reading dates, reviews and highlights come with them, and importing again adds to your library instead of duplicating it.",
  },
  {
    title: "Make it yours",
    body: "Choose how your covers look, from typeface to size and corners. Group books into series and collections, and keep what you're reading and what's up next in front of you.",
  },
  {
    title: "Share your reading life",
    body: "Arrange shelves, quotes and stats on a mural, or publish your whole library at a link anyone can open without an account. Your library stays private until you do.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-16 border-y border-(--color-border) bg-(--color-surface)">
      <div className={`${container} py-20 sm:py-28`}>
        <SectionIntro title="How it works" />
        <ol className="mt-10 grid gap-10 sm:mt-14 md:grid-cols-3 md:gap-8">
          {steps.map((step, index) => (
            <li key={step.title} className="border-t border-(--color-text) pt-5">
              <h3 className="flex items-baseline gap-3 text-lg font-semibold">
                <span aria-hidden className="font-display text-2xl font-normal text-(--color-text-dim)">
                  {index + 1}
                </span>
                {step.title}
              </h3>
              <p className="mt-2 text-pretty text-[15px] leading-relaxed text-(--color-text-dim)">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
