import { useEffect, useMemo, useRef, useState } from "react";
import { hasChosen, readerCardPages, readerCardSummary, startTurn, turnBy, turnTo, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";
import { useDismissible } from "../../hooks/useDismissible";
import { useScrollLock } from "../../hooks/useScrollLock";
import { keepTabInside } from "../../lib/keepTabInside";
import { ReaderCardImage } from "./ReaderCardImage";

const TURN = "motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]";
const CARD_WIDTH = "w-[min(88vw,calc((100dvh-10rem)*5/7))]";
const wideScreen = () => typeof window !== "undefined" && window.innerWidth >= 768 && !window.matchMedia?.("(pointer: coarse)").matches;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function ReaderCardViewer({ input, onClose }: { input: ReaderCardBase; onClose: () => void }) {
  useScrollLock();
  useDismissible(onClose);
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

  useEffect(() => {
    const previous = document.activeElement;
    focusRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const left = turn.index * element.clientWidth;
    if (Math.abs(element.scrollLeft - left) > 1) element.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [turn.index]);

  const go = (by: 1 | -1) => setTurn((state) => turnBy(state, by, count));
  const goTo = (to: number) => setTurn((state) => turnTo(state, to, to > state.index ? 1 : -1));
  const setFocus = (element: HTMLElement | null) => { focusRef.current = element; };

  let card;
  if (spread) {
    const open = turn.index === 1;
    card = (
      <button ref={setFocus} type="button" aria-label={open ? "Close the card" : "Open the card"} onClick={() => go(1)} className={`relative aspect-[10/7] w-[min(92vw,calc((100dvh-10rem)*10/7))] [perspective:2400px] ${TURN}`} style={{ transform: open ? "none" : "translateX(-25%)" }}>
        <span aria-hidden="true" className="absolute inset-y-0 right-0 w-1/2"><ReaderCardImage input={input} page={spread[1]} className="h-full w-full" /></span>
        <span aria-hidden="true" className={`absolute inset-y-0 right-0 w-1/2 origin-left [transform-style:preserve-3d] ${TURN}`} style={{ transform: open ? "rotateY(-180deg)" : "rotateY(0deg)" }}>
          <span className="absolute inset-0 [backface-visibility:hidden]"><ReaderCardImage input={input} page="front" className="h-full w-full" /></span>
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
        onScroll={(event) => { const element = event.currentTarget; const index = Math.round(element.scrollLeft / element.clientWidth); setTurn((state) => (state.index === index ? state : { ...state, index })); }}
        className={`flex ${CARD_WIDTH} snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]`}
      >
        {pages.map((page, i) => <div key={i} aria-hidden="true" className="w-full shrink-0 snap-center"><ReaderCardImage input={input} page={page} className="w-full" /></div>)}
      </div>
    );
  } else {
    card = (
      <button ref={setFocus} type="button" aria-label={`Turn the card, page ${turn.index + 1} of ${count}`} onClick={() => go(1)} className={`relative aspect-[5/7] ${CARD_WIDTH} [perspective:1600px]`}>
        <span className={`absolute inset-0 [transform-style:preserve-3d] ${TURN}`} style={{ transform: `rotateY(${-turn.rotation}deg)` }}>
          {([0, 1] as const).map((face) => (
            <span key={face} aria-hidden="true" className="absolute inset-0 [backface-visibility:hidden]" style={face === 1 ? { transform: "rotateY(180deg)" } : undefined}>
              <ReaderCardImage input={input} page={pages[turn.faces[face]]!} className="h-full w-full" />
            </span>
          ))}
        </span>
      </button>
    );
  }

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reader card"
        className="flex flex-col items-center gap-3"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          keepTabInside(event);
          if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
          if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
        }}
      >
        <button type="button" onClick={onClose} className="h-11 self-end rounded-full bg-(--color-surface) px-4 text-(--color-text)">Close</button>
        {card}
        <p className="sr-only" aria-live="polite">{`Page ${turn.index + 1} of ${count}`}</p>
        <ul className="sr-only">{summary.map((line) => <li key={line}>{line}</li>)}</ul>
        <div className="flex" role="group" aria-label="Pages">
          {Array.from({ length: count }, (_, i) => (
            <button key={i} type="button" aria-label={`Page ${i + 1}`} aria-current={i === turn.index ? "true" : undefined} onClick={() => goTo(i)} className="flex h-11 w-11 items-center justify-center">
              <span className={`block h-2 w-2 rounded-full ${i === turn.index ? "bg-(--color-surface)" : "bg-(--color-surface)/40"}`} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
