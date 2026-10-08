import { useDeferredValue, useMemo, useRef, useState } from "react";
import { CARD_PRINTS, CORNER_LABELS, CORNER_STYLES, COUNTERS, COUNTER_LABELS, FINISHES, FINISH_LABELS, FOOTER_LEFTS, FOOTER_LEFT_LABELS, FOOTER_RIGHTS, FOOTER_RIGHT_LABELS, LAYOUTS, LAYOUT_LABELS, MOTTO_LOOKS, MOTTO_LOOK_LABELS, MOTTO_MAX, PRINT_LABELS, TRAITS, TRAIT_LABELS, counterThumbnail, styleThumbnail, type MottoLook, type ReaderCardBase } from "@scripta/shared";
import type { ThemeScheme } from "@scripta/shared/themes";
import { DraftField } from "./DraftField";
import { ReaderCardImage } from "./ReaderCardImage";
import type { SaveStyle } from "./ReaderCardChoices";

export function Segmented<T extends string>({ label, options, labels, value, onChange }: { label: string; options: readonly T[]; labels: Record<T, string>; value: T; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
      {options.map((option, i) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`flex min-h-11 flex-1 items-center justify-center px-3 text-sm font-semibold ${i > 0 ? "border-l border-(--color-border)" : ""} ${value === option ? "bg-(--color-accent-soft) text-(--color-accent)" : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

const SAMPLE_MOTTO = "Per libros ad astra";
const TILE = (checked: boolean) => `flex flex-col items-center gap-1 rounded-lg border p-1.5 text-xs font-semibold ${checked ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`;

function Thumbnails<T extends string>({ label, options, labels, value, thumbnail, onPick, columns }: { label: string; options: readonly T[]; labels: Record<T, string>; value: T | null; thumbnail: (option: T) => ReaderCardBase; onPick: (option: T) => void; columns: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-2 ${columns}`}>
      {options.map((option) => (
        <button key={option} type="button" role="radio" aria-checked={value === option} onClick={() => onPick(option)} className={TILE(value === option)}>
          <span aria-hidden="true" className="block w-full"><ReaderCardImage input={thumbnail(option)} className="w-full" /></span>
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

function Chips<T extends string>({ label, options, labels, value, onPick }: { label: string; options: readonly T[]; labels: Record<T, string>; value: T; onPick: (option: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button key={option} type="button" role="radio" aria-checked={value === option} onClick={() => onPick(option)} className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${value === option ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}>
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

export function ReaderCardOptions({ input, scheme, onChange }: { input: ReaderCardBase; scheme: ThemeScheme; onChange: SaveStyle }) {
  const { counter, trait, layout, motto, footer, corners, finish, print } = input.style;
  const [look, setLook] = useState<MottoLook>(motto?.look ?? "ribbon");
  const lastText = useRef(motto?.text ?? null);
  const deferred = useDeferredValue(input);
  const base = useMemo(() => ({ ...deferred, style: { ...deferred.style, print: deferred.style.print === "auto" ? (scheme === "dark" ? "reversed" : "paper") : deferred.style.print } }), [deferred, scheme]);
  const counterThumbs = useMemo(() => COUNTERS.map((option) => ({ option, input: counterThumbnail(base, option) })), [base]);
  const mottoThumbs = useMemo(() => new Map(MOTTO_LOOKS.map((option) => [option, styleThumbnail(base, { motto: { text: base.style.motto?.text ?? SAMPLE_MOTTO, look: option } }, "motto")])), [base]);
  const cornerThumbs = useMemo(() => new Map(CORNER_STYLES.map((option) => [option, styleThumbnail(base, { corners: option }, "corner")])), [base]);
  const finishThumbs = useMemo(() => new Map(FINISHES.map((option) => [option, styleThumbnail(base, { finish: option })])), [base]);
  const saveMotto = (text: string | null) => {
    const previous = lastText.current;
    lastText.current = text;
    return onChange({ motto: text ? { text, look } : null }).then((saved) => {
      if (!saved && lastText.current === text) lastText.current = previous;
      return saved;
    });
  };
  const pickLook = (next: MottoLook) => {
    const previous = look;
    setLook(next);
    if (!lastText.current) return;
    void onChange({ motto: { text: lastText.current, look: next } }).then((saved) => {
      if (!saved) setLook(previous);
    });
  };
  return (
    <>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Counter</h3>
        <div role="radiogroup" aria-label="Counter" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {counterThumbs.map(({ option, input: thumbnail }) => (
            <button key={option} type="button" role="radio" aria-checked={counter === option} onClick={() => void onChange({ counter: option })} className={TILE(counter === option)}>
              <span aria-hidden="true" className="block w-full"><ReaderCardImage input={thumbnail} className="w-full" /></span>
              {COUNTER_LABELS[option]}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Second trait</h3>
        <Segmented label="Second trait" options={TRAITS} labels={TRAIT_LABELS} value={trait} onChange={(next) => void onChange({ trait: next })} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Motto</h3>
        <DraftField label="Your motto" initial={motto?.text ?? null} max={MOTTO_MAX} onSave={saveMotto} />
        <div className="mt-3">
          <Thumbnails label="Motto look" options={MOTTO_LOOKS} labels={MOTTO_LOOK_LABELS} value={motto?.look ?? look} thumbnail={(option) => mottoThumbs.get(option)!} onPick={pickLook} columns="grid-cols-3 sm:grid-cols-4" />
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Footer</h3>
        <p className="mb-1 text-xs text-(--color-text-dim)">Left</p>
        <Chips label="Footer left" options={FOOTER_LEFTS} labels={FOOTER_LEFT_LABELS} value={footer.left} onPick={(left) => void onChange({ footer: { ...footer, left } })} />
        <p className="mb-1 mt-3 text-xs text-(--color-text-dim)">Right</p>
        <Chips label="Footer right" options={FOOTER_RIGHTS} labels={FOOTER_RIGHT_LABELS} value={footer.right} onPick={(right) => void onChange({ footer: { ...footer, right } })} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Corners</h3>
        <Thumbnails label="Corners" options={CORNER_STYLES} labels={CORNER_LABELS} value={corners} thumbnail={(option) => cornerThumbs.get(option)!} onPick={(next) => void onChange({ corners: next })} columns="grid-cols-4 sm:grid-cols-6" />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Finish</h3>
        <Thumbnails label="Finish" options={FINISHES} labels={FINISH_LABELS} value={finish} thumbnail={(option) => finishThumbs.get(option)!} onPick={(next) => void onChange({ finish: next })} columns="grid-cols-4 sm:grid-cols-6" />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Print</h3>
        <Segmented label="Print" options={CARD_PRINTS} labels={PRINT_LABELS} value={print} onChange={(next) => void onChange({ print: next })} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Layout</h3>
        <Segmented label="Layout" options={LAYOUTS} labels={LAYOUT_LABELS} value={layout} onChange={(next) => void onChange({ layout: next })} />
      </section>
    </>
  );
}
