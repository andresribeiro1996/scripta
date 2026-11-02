import { useMemo, type ReactNode } from "react";
import { hasChosen, resolvePrint, type ReaderCardBase } from "@scripta/shared";
import { themes } from "@scripta/shared/themes";
import { useResolvedTheme } from "../../lib/theme";
import { readerCardDataUri } from "./dataUri";
import { ReaderCardTurner } from "./ReaderCardTurner";

const CARD_WIDTH = "w-[min(78vw,20rem)]";
const FADE = "[mask-image:radial-gradient(ellipse_closest-side,#000_35%,transparent)]";

export function ProfileCardHero({ input, children }: { input: ReaderCardBase; children?: ReactNode }) {
  const dark = themes[useResolvedTheme()].scheme === "dark";
  const backdrop = useMemo(() => readerCardDataUri({ ...input, print: resolvePrint(input.style.print, dark) }), [input, dark]);
  return (
    <>
      <div className="relative isolate -mx-4 flex justify-center overflow-hidden px-4 pt-6 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <img src={backdrop} alt="" aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 h-full w-full scale-150 object-cover opacity-70 blur-3xl ${FADE}`} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-b from-transparent to-(--color-bg)" />
        <ReaderCardTurner key={`${input.view}-${input.style.layout}-${hasChosen(input.card.chosen)}`} input={input} cardWidth={CARD_WIDTH} />
      </div>
      {children}
    </>
  );
}
