import { Link } from "react-router-dom";
import { ChevronLeftIcon } from "../Toolbar";

const backClass = "mb-2 inline-flex items-center gap-1 text-xs text-(--color-text-dim) hover:text-(--color-text)";

export function BackLink({ backTo, onBack }: { backTo: string; onBack: (() => void) | null }) {
  const content = (
    <>
      <ChevronLeftIcon size={13} />
      Back
    </>
  );
  return onBack ? (
    <button type="button" onClick={onBack} className={backClass}>{content}</button>
  ) : (
    <Link to={backTo} className={backClass}>{content}</Link>
  );
}
