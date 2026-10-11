import { Link } from "react-router-dom";
import { ChevronLeftIcon } from "../Toolbar";

const backClass = "inline-flex items-center gap-1 text-xs text-(--color-text-dim) hover:text-(--color-text)";

export function BackLink({ backTo, onBack, className = "mb-2" }: { backTo: string; onBack: (() => void) | null; className?: string }) {
  const content = (
    <>
      <ChevronLeftIcon size={13} />
      Back
    </>
  );
  return onBack ? (
    <button type="button" onClick={onBack} className={`${backClass} ${className}`}>{content}</button>
  ) : (
    <Link to={backTo} className={`${backClass} ${className}`}>{content}</Link>
  );
}
