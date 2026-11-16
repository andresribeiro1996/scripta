import { contentStatusBadge } from "@scripta/shared/community";
import { useLocale } from "../../i18n";

export function QuizStatusBadge({ status, className = "" }: { status: "draft" | "open" | "closed"; className?: string }) {
  const styles: Record<"draft" | "open" | "closed", string> = {
    draft: "border-(--color-border) bg-(--color-surface) text-(--color-text-dim)",
    open: "border-(--color-info) bg-(--color-info-soft) text-(--color-info)",
    closed: "border-(--color-success) bg-(--color-success-soft) text-(--color-success)"
  };
  const locale = useLocale();
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-sm font-semibold ${styles[status]} ${className}`}
    >
      {contentStatusBadge(status, locale).label}
    </span>
  );
}
