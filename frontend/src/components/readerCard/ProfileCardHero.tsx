import { useMemo, useState, type ReactNode } from "react";
import { readerCardShine, resolvePrint, type ReaderCardBase } from "@scripta/shared";
import { themes } from "@scripta/shared/themes";
import { useResolvedTheme } from "../../lib/theme";
import { useT } from "../../i18n";
import { CardShine } from "./CardShine";
import { readerCardDataUri } from "./dataUri";
import { ReaderCardImage } from "./ReaderCardImage";
import { ReaderCardViewer } from "./ReaderCardViewer";

const CARD_WIDTH = "w-[min(55vw,14rem)]";

export function ProfileCardHero({ input, badge, onEdit, children }: { input: ReaderCardBase; badge?: ReactNode; onEdit?: () => void; children?: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const dark = themes[useResolvedTheme()].scheme === "dark";
  const backdrop = useMemo(() => readerCardDataUri({ ...input, print: resolvePrint(input.style.print, dark) }), [input, dark]);
  const shine = readerCardShine(input.style.finish);
  return (
    <>
      <div className="relative isolate -mx-4 overflow-hidden px-4 pt-6 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div aria-hidden="true" className="@container pointer-events-none absolute inset-0 -z-10">
          <img src={backdrop} alt="" className="absolute -inset-[16cqw] h-[calc(100%+32cqw)] w-[calc(100%+32cqw)] max-w-none object-cover blur-[8.5cqw] saturate-[1.4]" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgba(0,0,0,.08)_20%,var(--color-bg)_98%)]" />
        <div className="flex justify-center">
          <div className={`relative ${CARD_WIDTH}`}>
            <button type="button" aria-label={t("readerCard.openCard")} onClick={() => setOpen(true)} className="relative block w-full">
              <ReaderCardImage input={input} className="w-full" />
              {shine ? <CardShine kind={shine} /> : null}
            </button>
            {badge ? <div className="absolute -right-3 -bottom-3">{badge}</div> : null}
          </div>
        </div>
        {children ? <div className="mt-5">{children}</div> : null}
      </div>
      {open ? <ReaderCardViewer input={input} onClose={() => setOpen(false)} onEdit={onEdit} /> : null}
    </>
  );
}
