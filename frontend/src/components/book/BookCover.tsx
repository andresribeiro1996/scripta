import { useState } from "react";
import type { CoverSize, LibraryBook } from "@scripta/shared";
import { CoverImage } from "../BookCard";

export function BookCover({ book, width, size = "thumb" }: { book: LibraryBook; width?: number; size?: CoverSize }) {
  const [hasCover, setHasCover] = useState(false);
  return (
    <span
      className={`relative block aspect-[2/3] shrink-0 overflow-hidden rounded-[2px_5px_5px_2px] shadow-(--shadow-cover) transition-transform duration-180 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-0.75 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 after:absolute after:inset-y-0 after:left-0 after:w-[6%] after:bg-linear-to-r after:from-black/20 after:to-white/10 ${width ? "" : "w-full"}`}
      style={{ width }}
    >
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center border border-(--color-border) bg-(--color-surface) p-2 text-center text-xs font-semibold">
        <span className="line-clamp-4 break-words">{String(book.Title ?? "")}</span>
      </span>
      <span className={`absolute inset-0 ${hasCover ? "" : "invisible"}`}>
        <CoverImage book={book} size={size} onHasCoverChange={setHasCover} />
      </span>
    </span>
  );
}
