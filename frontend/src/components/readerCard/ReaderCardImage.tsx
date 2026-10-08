import { useMemo } from "react";
import { renderReaderCard, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";

export function ReaderCardImage({ input, page = "front", className = "" }: { input: ReaderCardBase; page?: ReaderCardPage; className?: string }) {
  const { paper, reversed } = useMemo(() => ({ paper: renderReaderCard({ ...input, print: "paper" }, page), reversed: renderReaderCard({ ...input, print: "reversed" }, page) }), [input, page]);
  return (
    <span className={`block aspect-[5/7] ${className}`}>
      <span className="block h-full w-full dark:hidden [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: paper }} />
      <span className="hidden h-full w-full dark:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: reversed }} />
    </span>
  );
}
