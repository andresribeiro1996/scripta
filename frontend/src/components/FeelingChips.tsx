import { finishFeelings, type FinishRating } from "@scripta/shared";
import { useLocale, useT } from "../i18n";

export function FeelingChips({
  value,
  onChange,
  label
}: {
  value: number | null;
  onChange: (rating: FinishRating) => void;
  label?: string;
}) {
  const locale = useLocale();
  const t = useT();
  return (
    <div role="radiogroup" aria-label={label ?? t("addBook.howDidItLand")} className="flex flex-wrap gap-2">
      {finishFeelings(locale).map(({ rating, label: feelingLabel }) => {
        const selected = value === rating;
        return (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(rating)}
            className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${selected ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) bg-(--color-surface) hover:bg-(--color-surface-hover)"}`}
          >
            {feelingLabel}
          </button>
        );
      })}
    </div>
  );
}
