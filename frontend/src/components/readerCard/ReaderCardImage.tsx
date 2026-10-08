import { useMemo } from "react";
import { cardRatio, renderReaderCard, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";

const SVG = "block h-full w-full [&>svg]:h-full [&>svg]:w-full";

export function ReaderCardImage({ input, page = "front", className = "" }: { input: ReaderCardBase; page?: ReaderCardPage; className?: string }) {
  const fixed = input.style.print === "auto" ? null : input.style.print;
  const { paper, reversed } = useMemo(() => ({ paper: renderReaderCard({ ...input, print: fixed ?? "paper" }, page), reversed: fixed ? null : renderReaderCard({ ...input, print: "reversed" }, page) }), [input, page, fixed]);
  return (
    <span className={`block ${input.crop ? "" : "aspect-[5/7]"} ${className}`} style={input.crop ? { aspectRatio: String(1 / cardRatio(input.crop)) } : undefined}>
      {reversed === null ? (
        <span className={SVG} dangerouslySetInnerHTML={{ __html: paper }} />
      ) : (
        <>
          <span className={`${SVG} dark:hidden`} dangerouslySetInnerHTML={{ __html: paper }} />
          <span className="hidden h-full w-full dark:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: reversed }} />
        </>
      )}
    </span>
  );
}
