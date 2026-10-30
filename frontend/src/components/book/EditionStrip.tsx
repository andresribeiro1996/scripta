import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { editionLabel, type BookScreenModel, type WorkEdition } from "@scripta/shared";
import { CoverImage } from "../BookCard";
import { OptionsMenu } from "../OptionsMenu";
import { ChevronDownIcon } from "../Toolbar";

type Props = {
  editions: WorkEdition[];
  author: string;
  edition: NonNullable<BookScreenModel["edition"]>;
  mineBook: Record<string, unknown> | null;
  onSelect: (bookId: string) => void;
};

const SETTLE_MS = 120;

const centreOf = (slide: HTMLElement) => slide.offsetLeft + slide.offsetWidth / 2;

export function EditionStrip({ editions, author, edition, mineBook, onSelect }: Props) {
  const strip = useRef<HTMLDivElement>(null);
  const { index, mineIndex } = edition;
  const latest = useRef({ index, editions, onSelect });
  const placed = useRef(false);
  useEffect(() => {
    latest.current = { index, editions, onSelect };
  });

  const coverBooks = useMemo(
    () => editions.map((e) => (e.coverUrl ? { Title: e.title, Attribution: author, ISBN: e.isbn ?? undefined, _coverUrl: e.coverUrl } : {})),
    [editions, author]
  );

  function centre(target: number, behavior: ScrollBehavior) {
    const el = strip.current;
    const slide = el?.children[target] as HTMLElement | undefined;
    if (el && slide) el.scrollTo({ left: centreOf(slide) - el.clientWidth / 2, behavior });
  }

  function choose(target: number) {
    onSelect(editions[target]!.bookId);
  }

  useLayoutEffect(() => {
    centre(index, placed.current ? "smooth" : "instant");
    placed.current = true;
  }, [index]);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function settle() {
      clearTimeout(timer);
      const middle = el!.scrollLeft + el!.clientWidth / 2;
      const slides = Array.from(el!.children) as HTMLElement[];
      const nearest = slides.reduce((best, slide, i) => (Math.abs(centreOf(slide) - middle) < Math.abs(centreOf(slides[best]!) - middle) ? i : best), 0);
      const current = latest.current;
      if (nearest !== current.index) current.onSelect(current.editions[nearest]!.bookId);
    }
    function onScroll() {
      clearTimeout(timer);
      timer = setTimeout(settle, SETTLE_MS);
    }
    const event = "onscrollend" in window ? "scrollend" : "scroll";
    const handler = event === "scrollend" ? settle : onScroll;
    el.addEventListener(event, handler);
    return () => {
      clearTimeout(timer);
      el.removeEventListener(event, handler);
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.key === "ArrowLeft" ? index - 1 : event.key === "ArrowRight" ? index + 1 : index;
    if (target === index || target < 0 || target >= editions.length) return;
    event.preventDefault();
    choose(target);
  }

  return (
    <div>
      <div
        ref={strip}
        role="group"
        aria-roledescription="carousel"
        aria-label="Editions"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative flex snap-x snap-mandatory gap-3 overflow-x-auto px-[calc(50%-4rem)] py-1 [scrollbar-width:none] sm:px-[calc(50%-4.5rem)] [&::-webkit-scrollbar]:hidden"
      >
        {editions.map((e, i) => {
          const selected = i === index;
          const coverBook = i === mineIndex && mineBook ? mineBook : coverBooks[i]!;
          return (
            <button
              key={e.bookId}
              type="button"
              tabIndex={-1}
              aria-current={selected}
              aria-label={`${e.title} · ${editionLabel(e)}`}
              onClick={() => (selected ? undefined : choose(i))}
              className={`relative aspect-[2/3] w-32 shrink-0 snap-center overflow-hidden rounded-xl bg-(--color-border) transition sm:w-36 ${selected ? "" : "scale-90 opacity-60"}`}
            >
              <CoverImage book={coverBook} size="full" />
            </button>
          );
        })}
      </div>
      {edition.showDots ? (
        <div aria-hidden="true" className="mt-2 flex justify-center gap-1.5">
          {editions.map((e, i) => (
            <span key={e.bookId} className={`h-1.5 w-1.5 rounded-full ${i === index ? "bg-(--color-text)" : "bg-(--color-text-dim) opacity-40"}`} />
          ))}
        </div>
      ) : null}
      <div aria-live="polite" className="flex justify-center">
        <OptionsMenu
          title="Editions"
          trigger={<>{edition.label}<ChevronDownIcon /></>}
          triggerClassName="inline-flex min-h-11 items-center gap-1 px-2 text-xs text-(--color-text-dim) hover:text-(--color-text)"
          items={editions.map((e, i) => ({ label: `${e.title} · ${editionLabel(e)}${e.mine ? " · Yours" : ""}`, checked: i === index, onClick: () => choose(i) }))}
        />
      </div>
      {mineIndex !== null && index !== mineIndex ? (
        <div className="flex justify-center">
          <button type="button" onClick={() => choose(mineIndex)} className="min-h-11 text-xs font-semibold text-(--color-accent)">
            Back to your edition
          </button>
        </div>
      ) : null}
    </div>
  );
}
