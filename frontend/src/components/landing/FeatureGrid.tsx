import type { ReactNode } from "react";

const features: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Import from Kobo, Goodreads & StoryGraph",
    body: "The exporter reads your Kobo's own database right off its USB drive; Goodreads and StoryGraph come in as CSVs. Your ratings, shelves and notes come with you.",
    icon: (
      <>
        <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </>
    ),
  },
  {
    title: "A library that looks like you",
    body: "Book cards with your choice of cover typography, your grid size, your content width. Every cover, exactly the way you want to see it.",
    icon: (
      <>
        <rect x="4" y="4" width="7" height="10" rx="1.5" />
        <rect x="13" y="4" width="7" height="6" rx="1.5" />
        <rect x="13" y="12" width="7" height="8" rx="1.5" />
        <rect x="4" y="16" width="7" height="4" rx="1.5" />
      </>
    ),
  },
  {
    title: "Series & collections",
    body: "Group books the way you actually read them — a series in order, a themed shelf, a year in review.",
    icon: (
      <>
        <path d="M6 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M17 5h1a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-1" />
      </>
    ),
  },
  {
    title: "Share links",
    body: "Publish your library, a mural or a reading scoreboard at a public link. Anyone with the link can look; nobody needs an account.",
    icon: (
      <>
        <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1.5 1.5" />
        <path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1.5-1.5" />
      </>
    ),
  },
  {
    title: "Web app, installable",
    body: "Works in any browser, installs as a PWA, and keeps your library readable offline.",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18" />
      </>
    ),
  },
  {
    title: "Mobile app",
    body: "A native-feeling app for your phone — browse, sort and vote from the couch.",
    icon: (
      <>
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M11 18h2" />
      </>
    ),
  },
];

function FeatureIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function FeatureGrid() {
  return (
    <section id="features" className="scroll-mt-14">
      <div className="mx-auto max-w-6xl px-4 py-16 lg:py-24">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-(--color-text-dim)">
          <span aria-hidden className="h-px w-4 bg-(--color-accent)" />
          The essentials
        </p>
        <h2 className="mt-3 text-3xl font-bold sm:text-4xl" style={{ fontFamily: '"Playfair Display", serif' }}>
          A library taken seriously
        </h2>
        <p className="text-pretty mt-3 max-w-2xl text-lg text-(--color-text-dim)">
          Import once, then shape everything — Scripta is built around what a
          personal library can do that a spreadsheet can't.
        </p>
        <div className="mt-12 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="border-t border-(--color-border) pt-6">
              <FeatureIcon>{feature.icon}</FeatureIcon>
              <h3 className="mt-4 text-lg font-semibold" style={{ fontFamily: '"Playfair Display", serif' }}>
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-(--color-text-dim)">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
