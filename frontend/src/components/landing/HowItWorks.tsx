import { useState } from "react";
import { cardFontFamilyCss } from "../../lib/libraryStyle";
import { BOOKS, coverSrc, type BookSlug } from "./books";
import { SectionIntro, container } from "./ui";

const imports = [
  { name: "Kobo", detail: "Highlights and notes", icon: "book" },
  { name: "Goodreads", detail: "Shelves, ratings, dates and reviews", icon: "doc" },
  { name: "StoryGraph", detail: "Status, ratings and reviews", icon: "doc" },
] as const;

function ImportIcon({ kind }: { kind: "book" | "doc" }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-(--color-text-dim)"
    >
      {kind === "book" ? (
        <>
          <rect x="5" y="2.5" width="14" height="19" rx="2" />
          <path d="M9.5 18h5" />
        </>
      ) : (
        <>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </>
      )}
    </svg>
  );
}

function CheckIcon({ className = "text-(--color-text-dim)" }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

const styleCovers: BookSlug[] = ["klara", "piranesi", "circe"];

const fontOpts = [
  { value: "playfairDisplay", label: "Playfair" },
  { value: "inter", label: "Inter" },
  { value: "jetbrainsMono", label: "Mono" },
] as const;
type FontOpt = (typeof fontOpts)[number]["value"];

const cornerOpts = [
  { value: "round", label: "Round", radius: 14 },
  { value: "square", label: "Square", radius: 2 },
] as const;
type CornerOpt = (typeof cornerOpts)[number]["value"];

const previewSlugs: BookSlug[] = ["piranesi", "gilead", "klara", "hail-mary", "circe", "stoner"];
const shareLink = "atmyshelf.com/shared/library/k3v9q2";

function SegmentedGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-lg border border-(--color-border) bg-(--color-surface) p-[3px]">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`min-h-11 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${
            value === opt.value ? "bg-(--color-accent-soft) text-(--color-text)" : "text-(--color-text-dim)"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-(--color-accent)" : "bg-(--color-border)"}`}
    >
      <span
        className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left] duration-150 motion-reduce:transition-none ${
          checked ? "left-[23px]" : "left-[3px]"
        }`}
      />
    </button>
  );
}

const steps = [
  {
    title: "Bring your books",
    body: "Import straight from your Kobo, or from a Goodreads or StoryGraph export. Ratings, dates, reviews and highlights come with them, and importing again adds instead of duplicating.",
  },
  {
    title: "Make it yours",
    body: "Choose how your covers look, from typeface to corners and shape. Series group themselves, collections are yours to make, and what you’re reading stays up front.",
  },
  {
    title: "Share your reading life",
    body: "Publish your library or a mural at a link anyone can open, no account needed. Everything stays private until you do.",
  },
];

export function HowItWorks() {
  const [font, setFont] = useState<FontOpt>("playfairDisplay");
  const [corner, setCorner] = useState<CornerOpt>("round");
  const [shared, setShared] = useState(true);
  const [copied, setCopied] = useState(false);

  const fontCss = cardFontFamilyCss(font);
  const radius = cornerOpts.find((c) => c.value === corner)!.radius;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
    } catch (err) {
      if (!(err instanceof DOMException)) throw err;
    }
  }

  const vignettes = [
    <div key="bring" className="flex h-[248px] flex-col gap-2.5 rounded-xl border border-(--color-border) bg-(--color-bg) p-5">
      {imports.map((row) => (
        <div key={row.name} className="flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2.5">
          <ImportIcon kind={row.icon} />
          <div className="min-w-0 grow">
            <div className="text-sm font-semibold">{row.name}</div>
            <div className="text-xs text-(--color-text-dim)">{row.detail}</div>
          </div>
          <CheckIcon />
        </div>
      ))}
    </div>,
    <div key="style" className="flex h-[248px] flex-col gap-3.5 rounded-xl border border-(--color-border) bg-(--color-bg) p-5">
      <div className="flex gap-2.5">
        {styleCovers.map((slug) => {
          const book = BOOKS[slug];
          return (
            <div
              key={slug}
              className={`relative h-[141px] w-[94px] shrink-0 overflow-hidden shadow-[0_8px_14px_-8px_rgb(0_0_0_/_0.5)] transition-[border-radius] duration-200 motion-reduce:transition-none ${
                radius === 14 ? "rounded-[14px]" : "rounded-[2px]"
              }`}
            >
              <img src={coverSrc(slug)} alt="" className="block h-full w-full object-cover" />
              <div
                className="absolute inset-x-0 bottom-0 px-2 pt-8 pb-2"
                style={{ background: "linear-gradient(to top, rgb(10 8 6 / 0.82) 0%, rgb(10 8 6 / 0.5) 45%, rgb(10 8 6 / 0) 100%)" }}
              >
                <div className="text-xs leading-tight text-white" style={{ fontFamily: fontCss }}>
                  {book.title}
                </div>
                <div className="mt-0.5 text-[9.5px] leading-tight text-white/80" style={{ fontFamily: fontCss }}>
                  {book.author}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        <SegmentedGroup label="Typeface" options={fontOpts} value={font} onChange={setFont} />
        <SegmentedGroup label="Corners" options={cornerOpts} value={corner} onChange={setCorner} />
      </div>
    </div>,
    <div key="share" className="flex h-[248px] flex-col gap-3 rounded-xl border border-(--color-border) bg-(--color-bg) p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Public link</span>
        <Switch
          checked={shared}
          onChange={() => {
            setShared(!shared);
            setCopied(false);
          }}
          label="Share your library at a public link"
        />
      </div>
      {shared ? (
        <div className="flex gap-2">
          <div className="flex h-10 grow items-center truncate rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-[12.5px] text-(--color-text-dim)">
            {shareLink}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="min-h-11 shrink-0 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-xs font-semibold whitespace-nowrap transition-colors hover:bg-(--color-surface-hover)"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : (
        <div className="flex h-10 items-center gap-2 text-[13px] text-(--color-text-dim)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
          </svg>
          Private. Only you can see your library.
        </div>
      )}
      <div className={`mt-1 transition-opacity duration-200 ${shared ? "opacity-100" : "opacity-35"}`}>
        <div className="text-xs text-(--color-text-dim)">What a visitor sees</div>
        <div className="mt-2 flex gap-1.5">
          {previewSlugs.map((slug) => (
            <img key={slug} src={coverSrc(slug)} alt="" className="block h-[54px] w-9 rounded-[3px] object-cover" />
          ))}
        </div>
        <div className="mt-2 text-xs font-semibold">Eleanor’s library · 19 books</div>
      </div>
    </div>,
  ];

  return (
    <section
      id="how"
      className="scroll-mt-16 bg-[linear-gradient(to_bottom,var(--color-bg)_0,var(--color-surface)_96px,var(--color-surface)_calc(100%-96px),var(--color-bg)_100%)] lg:bg-[linear-gradient(to_bottom,var(--color-bg)_0,var(--color-surface)_160px,var(--color-surface)_calc(100%-160px),var(--color-bg)_100%)]"
    >
      <div className={`${container} py-16 sm:py-20 lg:py-26`}>
        <SectionIntro title="How it works" />
        <ol className="mt-10 grid gap-10 sm:mt-12 lg:grid-cols-3 lg:gap-10">
          {steps.map((step, index) => (
            <li key={step.title} className="flex flex-col">
              {vignettes[index]}
              <h3 className="mt-7 flex items-baseline gap-3 border-t border-(--color-text) pt-5 text-lg font-semibold">
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
