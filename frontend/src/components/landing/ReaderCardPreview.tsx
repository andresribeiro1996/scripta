import { useState, type CSSProperties } from "react";
import { READER_PLATES, blockEffects, blockTextColors, resolveBlockColor, resolveBlockStyle, type BlockStyle } from "@scripta/shared";
import { themes } from "@scripta/shared/themes";
import { blockFinishImage, blockFontFamilyCss, resolveBorderColor } from "../../lib/libraryStyle";
import { muralThemeStyle } from "../../lib/theme";
import { SpotlightBlockView } from "../murals/blocks/BookBlocks";
import { TextBlockView } from "../murals/blocks/MiscBlocks";
import { TierRowShell } from "../tierlist/TierRowShell";
import { BOOKS, coverSrc, readerCardSrc, type BookSlug } from "./books";

const favourites: BookSlug[] = ["piranesi", "gilead", "stoner", "remains", "circe", "the-road"];
const spotlightBooks = (["piranesi", "remains"] as const).map((slug) => ({ _key: slug, Title: BOOKS[slug].title, Attribution: BOOKS[slug].author, _coverUrl: coverSrc(slug) }));
const previewTiers = [
  { label: "S", books: ["piranesi", "gilead", "stoner"] },
  { label: "A", books: ["circe", "remains", "the-road"] },
] as const;
const looks = [
  { name: "Linen", theme: "sepia", finish: "linen", radius: 6, font: "serif", quote: "#263729", gradient: "#496852", ink: "#f0eadb", areas: '"profile profile profile profile" "spotlight spotlight quote quote" "favourites favourites favourites favourites" "plate reading reading stats" "footer footer footer footer"', rows: "auto minmax(0, 1fr) auto auto auto" },
  { name: "Gallery", theme: "light", finish: "none", radius: 10, font: "sans", quote: "#dcebf2", gradient: "#ffffff", ink: "#223943", areas: '"profile profile profile profile" "spotlight spotlight note note" "spotlight spotlight stats stats" "favourites favourites favourites favourites" "footer footer footer footer"', rows: "auto auto minmax(0, 1fr) auto auto" },
  { name: "Nocturne", theme: "midnight", finish: "none", radius: 2, font: "serif", quote: "#263044", gradient: "#263044", ink: "#dce1ea", areas: '"profile profile profile profile" "spotlight spotlight quote quote" "tierlist tierlist tierlist plate" "footer footer footer footer"', rows: "auto minmax(0, 1fr) auto auto" },
] as const;

export function ReaderCardPreview() {
  const [flipped, setFlipped] = useState(false);
  const [plate] = useState(() => READER_PLATES[Math.floor(Math.random() * READER_PLATES.length)]);
  const [lookIndex, setLookIndex] = useState(() => Math.floor(Math.random() * looks.length));
  const cardSources = readerCardSrc(plate);
  const look = looks[lookIndex];
  const nocturne = look.name === "Nocturne";
  const { colors: palette, scheme } = themes[look.theme];

  function surface(patch: Partial<BlockStyle>): CSSProperties {
    const style = resolveBlockStyle({ cardRadius: look.radius, backgroundFinish: look.finish, cardBorderOpacity: 30, shadowColor: "theme:accent", shadowOpacity: 8, shadowBlur: 8, shadowOffsetY: 2, ...patch, ...(nocturne ? { backgroundColor: "transparent", gradientColor: null, cardBorderWidth: 0, cardShadow: false } : {}) });
    const text = blockTextColors(style, palette);
    return {
      backgroundColor: resolveBlockColor(style.backgroundColor, palette) ?? palette.surface,
      backgroundImage: blockFinishImage(style, palette),
      boxShadow: blockEffects(style, palette).boxShadow,
      borderRadius: style.cardRadius,
      borderWidth: style.cardBorderWidth,
      borderStyle: style.cardBorderStyle,
      borderColor: resolveBorderColor(resolveBlockColor(style.cardBorderColor, palette), style.cardBorderOpacity),
      color: text.text,
      "--color-text-dim": text.dim,
      "--color-accent": text.accent,
      "--block-pad": 0.4,
      ...(nocturne ? { "--color-border": palette.background } : {}),
    } as CSSProperties;
  }

  return (
    <div className="mx-auto my-4 w-full max-w-sm">
      <div className="relative isolate mx-auto w-fit">
        <div aria-hidden="true" className="pointer-events-none absolute -inset-6 -z-10 rounded-full bg-(--color-text)/5 blur-3xl" />
        <button
          type="button"
          onClick={() => setFlipped((current) => !current)}
          aria-pressed={flipped}
          aria-label={flipped ? "Turn back to the reader card" : "Turn the reader card to reveal an example mural"}
          className="relative mx-auto block aspect-5/7 w-60 max-w-[calc(100vw-7rem)] cursor-pointer rounded-xl shadow-[0_16px_48px_-20px_rgb(0_0_0/0.3)] ring-1 ring-(--color-text)/10 [perspective:1200px] motion-safe:transition-transform motion-safe:duration-500 motion-safe:hover:-translate-y-1 sm:w-64 [@media(min-width:768px)_and_(min-height:751px)_and_(max-height:800px)]:[zoom:0.95] [@media(min-width:768px)_and_(max-height:750px)]:[zoom:0.8] [@media(max-width:767px)_and_(min-height:601px)_and_(max-height:700px)]:[zoom:0.9] [@media(max-width:767px)_and_(max-height:600px)]:[zoom:0.7]"
        >
          <div
            className="relative block h-full w-full [transform-style:preserve-3d] motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
          >
            <span aria-hidden={flipped} className="absolute inset-0 overflow-hidden rounded-xl [backface-visibility:hidden] after:pointer-events-none after:absolute after:inset-0 after:bg-linear-to-br after:from-white/10 after:via-transparent after:to-transparent">
              <img src={cardSources.paper} width="250" height="350" alt={`The ${plate.name} reader card`} className="block h-full w-full dark:hidden" />
              <img src={cardSources.reversed} width="250" height="350" alt={`The ${plate.name} reader card`} className="hidden h-full w-full dark:block" />
            </span>
            <div aria-hidden={!flipped} style={{ ...muralThemeStyle(look.theme), backgroundImage: blockFinishImage(resolveBlockStyle({ backgroundColor: "theme:background", backgroundFinish: look.finish }), palette) }} className={`absolute inset-0 overflow-hidden rounded-xl border border-(--color-border) text-left [backface-visibility:hidden] [transform:rotateY(180deg)] ${nocturne ? "p-4" : "p-2.5"}`}>
              <div style={{ gridTemplateAreas: look.areas, gridTemplateRows: look.rows }} className={`grid h-full grid-cols-4 text-[9px] leading-[1.35] ${nocturne ? "gap-2.5" : "gap-1.5"}`}>
                <span style={{ ...surface({ backgroundColor: "theme:accentSoft", gradientColor: "theme:surface", gradientStrength: 85, cardBorderWidth: 0 }), gridArea: "profile" }} className="p-1.5">
                  <span className="flex items-center gap-2">
                    {!nocturne && <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-(--color-accent-soft) font-display text-sm">E</span>}
                    <span>
                      <span className="block font-display text-[11px]">Eleanor’s reading world</span>
                      <span className="block text-[8px] text-(--color-text-dim)">@eleanor</span>
                    </span>
                  </span>
                </span>
                {look.name !== "Nocturne" && <span style={{ ...surface({ gradientColor: "theme:accentSoft", gradientStrength: 40, gradientAngle: 180 }), gridArea: "favourites" }} className="p-1.5">
                  <span className="mb-1.5 block text-[7px] tracking-[0.12em] uppercase">All-time favourites</span>
                  <span className="grid grid-cols-6 gap-1.5">
                    {favourites.map((slug) => (
                      <img key={slug} src={coverSrc(slug)} alt={`${BOOKS[slug].title} by ${BOOKS[slug].author}`} width="100" height="150" className="block aspect-2/3 w-full rounded-sm object-cover shadow-sm" />
                    ))}
                  </span>
                </span>}
                {look.name !== "Gallery" && <span style={{ ...surface({ backgroundColor: look.quote, textColor: look.ink, gradientColor: look.gradient, gradientStrength: 65, cardBorderWidth: 0, cardRadius: look.radius / 2, shadowColor: look.quote, shadowOpacity: 18 }), gridArea: "quote" }} className="flex flex-col justify-center p-1.5">
                  <span data-own-font="" style={{ fontFamily: blockFontFamilyCss(look.font) }} className="text-[11px] leading-snug italic">“Wherever you turn your eyes the world can shine like transfiguration.”</span>
                  <span className="mt-1 block text-[7px] text-(--color-text-dim)">Marilynne Robinson · Gilead</span>
                </span>}
                {look.name !== "Nocturne" && <span style={{ ...surface({ backgroundColor: "theme:accentSoft", gradientColor: "theme:surface", gradientStrength: 60, cardBorderWidth: 0, cardRadius: 10 }), gridArea: "stats" }} className="flex flex-col justify-center gap-1 p-1.5">
                  <span><span className="block font-display text-base leading-none text-(--color-accent)">19</span><span className="mt-1 block text-(--color-text-dim)">Books</span></span>
                </span>}
                {look.name !== "Gallery" && <span style={{ gridArea: "plate" }} className="grid place-items-center p-1.5">
                  <img src={scheme === "dark" ? cardSources.reversed : cardSources.paper} width="250" height="350" alt={`The ${plate.name} reader card`} className={`block h-auto w-9 ${nocturne ? "" : "-rotate-3 shadow-sm"}`} />
                </span>}
                {look.name === "Linen" && <span style={{ ...surface({ cardBorderStyle: "dashed", cardBorderColor: "theme:accent", cardBorderOpacity: 25, cardRadius: 3, cardShadow: false }), gridArea: "reading" }} className="p-1.5">
                  <span className="mb-1.5 block text-[7px] tracking-[0.1em] uppercase">Currently reading</span>
                  <span className="flex gap-2">
                    {(["klara", "left-hand", "pachinko"] as const).map((slug) => (
                      <span key={slug} className="block w-6">
                        <img src={coverSrc(slug)} alt={BOOKS[slug].title} width="100" height="150" className="block aspect-2/3 w-full rounded-sm object-cover" />
                        <span className="mt-1 block h-0.5 overflow-hidden rounded-full bg-(--color-border)"><span className="block h-full w-2/5 bg-(--color-accent)" /></span>
                      </span>
                    ))}
                  </span>
                </span>}
                <div style={{ ...surface({ backgroundColor: "theme:surface" }), gridArea: "spotlight" }} className="min-h-0 overflow-hidden [&_img]:object-contain [&_.truncate]:whitespace-normal [&_.font-semibold]:font-normal">
                  <SpotlightBlockView block={{ id: "preview-spotlight", type: "spotlight", bookKey: nocturne ? "remains" : "piranesi", layout: { x: 0, y: 0, w: 6, h: 4 } }} books={spotlightBooks} />
                </div>
                {look.name === "Gallery" && <div style={{ ...surface({ backgroundColor: look.quote, textColor: look.ink, gradientColor: look.gradient, gradientStrength: 70 }), gridArea: "note" }} className="text-[11px] [&_p]:italic">
                  <TextBlockView block={{ id: "preview-note", type: "text", body: "Books that feel like places. Worlds I’m not quite ready to leave.", layout: { x: 6, y: 0, w: 6, h: 3 } }} />
                </div>}
                {look.name === "Nocturne" && <div style={{ ...surface({ cardBorderWidth: 0 }), gridArea: "tierlist" }} className="p-1.5 [&_div]:rounded-none [&_div]:border-0 [&_div]:[text-shadow:none]">
                  <span className="mb-1 block text-[7px] tracking-[0.1em] text-(--color-text-dim) uppercase">My personal canon</span>
                  <div className="flex flex-col gap-1">
                    {previewTiers.map((tier) => <TierRowShell key={tier.label} tier={{ id: tier.label, label: tier.label, color: "transparent", workIds: [...tier.books] }}>
                      <div className="flex gap-1 p-1">
                        {tier.books.map((slug) => <img key={slug} src={coverSrc(slug)} alt={BOOKS[slug].title} width="100" height="150" className="block h-5 w-auto rounded-xs" />)}
                      </div>
                    </TierRowShell>)}
                  </div>
                </div>}
                <span style={{ gridArea: "footer" }} className="text-center text-[7px] text-(--color-text-dim)">Example mural · Covers from Open Library</span>
              </div>
            </div>
          </div>
        </button>
        {flipped && <div role="group" aria-label="Example mural styles" className="absolute top-1/2 left-full ml-2 flex -translate-y-1/2 flex-col gap-1">
          {looks.map((option, index) => (
            <button key={option.name} type="button" title={`${option.name} mural`} aria-pressed={flipped && lookIndex === index} onClick={() => { setLookIndex(index); setFlipped(true); }} className={`grid h-11 w-11 place-items-center rounded-full transition-colors hover:bg-(--color-accent-soft) ${flipped && lookIndex === index ? "bg-(--color-surface) ring-1 ring-(--color-border)" : ""}`}>
              <span aria-hidden="true" style={{ backgroundColor: option.quote }} className="h-3 w-3 rounded-full border border-(--color-border)" />
              <span className="sr-only">{option.name}</span>
            </button>
          ))}
        </div>}
      </div>
      <p className="mt-3 text-xs text-(--color-text-dim)">{flipped ? "Turn back" : "Turn to explore"}</p>
    </div>
  );
}
