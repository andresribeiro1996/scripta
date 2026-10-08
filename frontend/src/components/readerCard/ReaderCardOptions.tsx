import { useMemo } from "react";
import { COUNTERS, COUNTER_LABELS, LAYOUTS, LAYOUT_LABELS, TRAITS, TRAIT_LABELS, counterThumbnail, type ReaderCardBase, type ReaderCardStylePatch } from "@scripta/shared";
import { ReaderCardImage } from "./ReaderCardImage";

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

export function ReaderCardOptions({ input, onChange }: { input: ReaderCardBase; onChange: (patch: ReaderCardStylePatch) => void }) {
  const { counter, trait, layout } = input.style;
  const thumbnails = useMemo(() => COUNTERS.map((option) => ({ option, input: counterThumbnail(input, option) })), [input]);
  return (
    <>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Counter</h3>
        <div role="radiogroup" aria-label="Counter" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {thumbnails.map(({ option, input: thumbnail }) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={counter === option}
              onClick={() => onChange({ counter: option })}
              className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 text-xs font-semibold ${counter === option ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}
            >
              <span aria-hidden="true" className="block w-full"><ReaderCardImage input={thumbnail} className="w-full" /></span>
              {COUNTER_LABELS[option]}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Second trait</h3>
        <Segmented label="Second trait" options={TRAITS} labels={TRAIT_LABELS} value={trait} onChange={(next) => onChange({ trait: next })} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Layout</h3>
        <Segmented label="Layout" options={LAYOUTS} labels={LAYOUT_LABELS} value={layout} onChange={(next) => onChange({ layout: next })} />
      </section>
    </>
  );
}
