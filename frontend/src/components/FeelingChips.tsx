import { FINISH_FEELINGS, type FinishRating } from "@scripta/shared";

export function FeelingChips({ value, onChange }: { value: number | null; onChange: (rating: FinishRating) => void }) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {FINISH_FEELINGS.map(({ rating, label }) => {
        const selected = value === rating;
        return (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(rating)}
            className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${selected ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) bg-(--color-surface) hover:bg-(--color-surface-hover)"}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
