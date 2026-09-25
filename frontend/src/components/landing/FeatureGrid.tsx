import type { ReactNode } from "react";

const features: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Import from Kobo & Goodreads",
    body: "The exporter reads your Kobo's own database right off its USB drive; Goodreads comes in as a CSV. Your ratings, shelves and notes come with you.",
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
    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-(--color-accent-soft) text-(--color-accent)">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </span>
  );
}

export function FeatureGrid() {
  return (
    <section id="features" className="scroll-mt-14">
      <div className="mx-auto max-w-6xl px-4 py-16 lg:py-24">
        <h2 className="text-3xl font-bold">Everything your reading history wants to be</h2>
        <p className="mt-3 max-w-xl text-lg text-(--color-text-dim)">
          Import once, then shape it — Scripta is built around what a personal
          library can do that a spreadsheet can't.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-6">
              <FeatureIcon>{feature.icon}</FeatureIcon>
              <h3 className="mt-4 font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-(--color-text-dim)">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
