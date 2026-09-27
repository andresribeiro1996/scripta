import { useState } from "react";
import { READER_PLATES, type IdentityKey } from "@scripta/shared";
import { readerCardSrc } from "./books";

const SHOWN: IdentityKey[] = ["carto", "lamp", "corr", "way"];
const BOX_W = 660;
const BOX_H = 360;
const PLATE_W = 150;
const PLATE_H = 210;

export function ReaderCards() {
  const [selected, setSelected] = useState<IdentityKey>("corr");
  const plates = SHOWN.map((key) => READER_PLATES.find((plate) => plate.key === key)!);
  const active = plates.find((plate) => plate.key === selected)!;

  return (
    <div className="mt-20 flex flex-col gap-10 border-t border-(--color-border) pt-14 sm:mt-24 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
      <div className="lg:w-[420px] lg:min-w-0">
        <h3 className="font-display text-2xl leading-tight sm:text-[28px] lg:text-[32px]">Reader cards</h3>
        <p className="mt-3 text-pretty text-[15px] leading-relaxed text-(--color-text-dim) lg:text-base lg:leading-[1.65]">
          A bookplate drawn from the way you read. Here are a few.
        </p>
        <div className="mt-7 border-t border-(--color-border) pt-5">
          <p className="text-[13px] text-(--color-text-dim)">Plate {active.numeral}</p>
          <p className="mt-1 font-display text-[26px] leading-tight">The {active.name}</p>
          <p className="mt-0.5 text-[15px]">{active.epithet}</p>
        </div>
      </div>

      <div className="relative mx-auto aspect-[11/6] w-[300px] sm:w-[450px] lg:mx-0 lg:w-[660px] lg:min-w-0">
        {plates.map((plate, index) => {
          const on = plate.key === selected;
          const off = index - 1.5;
          const src = readerCardSrc(plate);
          const left = ((75 + index * 120) / BOX_W) * 100;
          const top = ((on ? 20 : Math.round(70 + 8 * off * off)) / BOX_H) * 100;
          return (
            <button
              key={plate.key}
              type="button"
              onClick={() => setSelected(plate.key)}
              aria-pressed={on}
              aria-label={`Plate ${plate.numeral}, the ${plate.name}`}
              className="absolute origin-bottom cursor-pointer border-0 bg-none p-0 motion-safe:transition-[top,transform] motion-safe:duration-[260ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${(PLATE_W / BOX_W) * 100}%`,
                height: `${(PLATE_H / BOX_H) * 100}%`,
                transform: on ? "rotate(0deg)" : `rotate(${(off * 5).toFixed(1)}deg)`,
                zIndex: on ? 20 : index + 1,
              }}
            >
              <picture>
                <source media="(prefers-color-scheme: dark)" srcSet={src.reversed} />
                <img
                  src={src.paper}
                  alt=""
                  loading="lazy"
                  className={`block h-full w-full rounded-[3px] ${on ? "shadow-[0_28px_40px_-14px_rgb(0_0_0/0.5)]" : "shadow-[0_12px_22px_-10px_rgb(0_0_0/0.4)]"}`}
                />
              </picture>
            </button>
          );
        })}
      </div>
    </div>
  );
}
