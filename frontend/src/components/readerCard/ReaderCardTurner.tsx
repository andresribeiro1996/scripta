import { useEffect, useMemo, useRef, useState } from "react";
import { hasChosen, readerCardPages, readerCardShine, readerCardSummary, startTurn, turnBy, turnTo, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";
import { prefersReducedMotion } from "../../lib/theme";
import { CardShine } from "./CardShine";
import { ReaderCardImage } from "./ReaderCardImage";

const TURN = "motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]";
const wideScreen = () => typeof window !== "undefined" && window.innerWidth >= 768 && !window.matchMedia?.("(pointer: coarse)").matches;

export function ReaderCardTurner({ input, cardWidth, spreadWidth, onScrim = false, autoFocus = false }: { input: ReaderCardBase; cardWidth: string; spreadWidth: string; onScrim?: boolean; autoFocus?: boolean }) {
  const [wide] = useState(wideScreen);
  const steps = useMemo(() => readerCardPages(input.style.layout, input.view ?? "visitor", hasChosen(input.card.chosen)), [input]);
  const spread = wide && steps.some(Array.isArray) ? (steps[1] as [ReaderCardPage, ReaderCardPage]) : null;
  const pages = useMemo(() => steps.flat(), [steps]);
  const count = spread ? 2 : pages.length;
  const pager = input.style.layout === "book" && !spread;
  const [turn, setTurn] = useState(() => startTurn(count));
  const summary = useMemo(() => readerCardSummary(input), [input]);
  const focusRef = useRef<HTMLElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (autoFocus) focusRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const left = turn.index * element.clientWidth;
    if (Math.abs(element.scrollLeft - left) > 1) element.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [turn.index]);

  useEffect(() => () => clearTimeout(settle.current), []);

  const syncIndex = (element: HTMLElement) => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const index = Math.round(element.scrollLeft / element.clientWidth);
      setTurn((state) => (state.index === index ? state : { ...state, index }));
    }, 100);
  };
  const go = (by: 1 | -1) => setTurn((state) => turnBy(state, by, count));
  const goTo = (to: number) => setTurn((state) => turnTo(state, to, to > state.index ? 1 : -1));
  const setFocus = (element: HTMLElement | null) => { focusRef.current = element; };
  const dot = (current: boolean) => (onScrim ? (current ? "bg-white" : "bg-white/40") : current ? "bg-(--color-text)" : "bg-(--color-text)/40");

  const shine = readerCardShine(input.style.finish);
  const shineOn = (page: ReaderCardPage) => (shine && page === "front" ? <CardShine kind={shine} /> : null);

  let card;
  if (spread) {
    const open = turn.index === 1;
    card = (
      <button ref={setFocus} type="button" aria-label={open ? "Close the card" : "Open the card"} onClick={() => go(1)} className={`relative aspect-[10/7] ${spreadWidth} [perspective:2400px] ${TURN}`} style={{ transform: open ? "none" : "translateX(-25%)" }}>
        <span aria-hidden="true" className="absolute inset-y-0 right-0 w-1/2"><ReaderCardImage input={input} page={spread[1]} className="h-full w-full" /></span>
        <span aria-hidden="true" className={`absolute inset-y-0 right-0 w-1/2 origin-left [transform-style:preserve-3d] ${TURN}`} style={{ transform: open ? "rotateY(-180deg)" : "rotateY(0deg)" }}>
          <span className="absolute inset-0 [backface-visibility:hidden]"><ReaderCardImage input={input} page="front" className="h-full w-full" />{shineOn("front")}</span>
          <span className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]"><ReaderCardImage input={input} page={spread[0]} className="h-full w-full" /></span>
        </span>
      </button>
    );
  } else if (pager) {
    card = (
      <div
        ref={(element) => { scroller.current = element; setFocus(element); }}
        role="region"
        aria-label="Reader card pages"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); go(1); } }}
        onScroll={(event) => syncIndex(event.currentTarget)}
        className={`flex ${cardWidth} snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]`}
      >
        {pages.map((page, i) => <div key={i} aria-hidden="true" className="relative w-full shrink-0 snap-center"><ReaderCardImage input={input} page={page} className="w-full" />{shineOn(page)}</div>)}
      </div>
    );
  } else {
    card = (
      <button ref={setFocus} type="button" aria-label={`Turn the card, page ${turn.index + 1} of ${count}`} onClick={() => go(1)} className={`relative aspect-[5/7] ${cardWidth} [perspective:1600px]`}>
        <span className={`absolute inset-0 [transform-style:preserve-3d] ${TURN}`} style={{ transform: `rotateY(${-turn.rotation}deg)` }}>
          {([0, 1] as const).map((face) => (
            <span key={face} aria-hidden="true" className="absolute inset-0 [backface-visibility:hidden]" style={face === 1 ? { transform: "rotateY(180deg)" } : undefined}>
              <ReaderCardImage input={input} page={pages[turn.faces[face]]!} className="h-full w-full" />
              {shineOn(pages[turn.faces[face]]!)}
            </span>
          ))}
        </span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Reader card"
      className="flex flex-col items-center gap-3"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
      }}
    >
      {card}
      <p className="sr-only" aria-live="polite">{`Page ${turn.index + 1} of ${count}`}</p>
      <ul className="sr-only">{summary.map((line) => <li key={line}>{line}</li>)}</ul>
      <div className="flex" role="group" aria-label="Pages">
        {Array.from({ length: count }, (_, i) => (
          <button key={i} type="button" aria-label={`Page ${i + 1}`} aria-current={i === turn.index ? "true" : undefined} onClick={() => goTo(i)} className="flex h-11 w-11 items-center justify-center">
            <span className={`block h-2 w-2 rounded-full ${dot(i === turn.index)}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
