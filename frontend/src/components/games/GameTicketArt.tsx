import type { QuizPreview } from "@scripta/shared";
import type { PublishedContent } from "@scripta/shared/community";
import { LibraryIcon, QuoteIcon } from "../NavIcons";

type Kind = PublishedContent["kind"];

export function GameTicketArt({ kind, covers, ladder, preview, color }: { kind: Kind; covers: string[]; ladder?: string[]; preview?: QuizPreview; color: string }) {
  if (kind === "quiz") {
    return (
      <div aria-hidden="true" className="flex w-full flex-col items-center justify-center gap-2 px-2 py-4" style={{ color }}>
        {preview?.type === "cover_title" ? (
          <div className="relative h-20 w-[54px] -rotate-6 overflow-hidden rounded-sm bg-(--color-border)">
            <img src={preview.prompt} alt="" loading="lazy" className="h-full w-full object-cover" style={{ filter: "blur(6px)" }} />
            <span className="absolute inset-0 flex items-center justify-center text-[32px] leading-none font-bold text-(--color-text)">?</span>
          </div>
        ) : preview ? (
          preview.type === "title_cover" ? <LibraryIcon size={32} /> : <QuoteIcon size={32} />
        ) : (
          <span className="text-[32px] leading-[38px] font-bold">?</span>
        )}
        <div className="flex gap-1">
          {["A", "B", "C"].map((answer) => (
            <span key={answer} className="w-[17px] rounded-[3px] border border-current text-center text-[9px] leading-[14px]">
              {answer}
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (kind === "tournament") {
    return (
      <div aria-hidden="true" className="flex flex-col items-center gap-1 py-3" style={{ color }}>
        <Cover src={covers[0] ?? null} rotate={-7} />
        <span className="text-xs font-bold tracking-wider">VS</span>
        <Cover src={covers[1] ?? null} rotate={7} />
      </div>
    );
  }
  const fan: Array<string | null> = covers.length ? covers.slice(0, 3) : [null];
  return (
    <div aria-hidden="true" className="flex w-20 flex-col items-center gap-3">
      <div className="flex flex-col gap-[3px] self-start pl-1">
        {(ladder?.length ? ladder : [color, color, color]).slice(0, 5).map((tier, index) => (
          <span key={index} className="h-[5px] rounded-sm" style={{ backgroundColor: tier, width: 70 - index * 7 }} />
        ))}
      </div>
      <div className="relative h-[58px] w-20">
        {fan.map((cover, index) => (
          <span key={index} className="absolute top-1" style={{ left: 5 + index * 18 + (3 - fan.length) * 9 }}>
            <Cover src={cover} rotate={(index - (fan.length - 1) / 2) * 7} />
          </span>
        ))}
      </div>
    </div>
  );
}

function Cover({ src, rotate }: { src: string | null; rotate: number }) {
  return (
    <span className="block h-[50px] w-[34px] overflow-hidden rounded-[3px] border border-(--color-border) bg-(--color-surface)" style={{ transform: `rotate(${rotate}deg)` }}>
      {src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
    </span>
  );
}
