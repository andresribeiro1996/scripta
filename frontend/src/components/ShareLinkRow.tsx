import { BUTTON_SECONDARY, FIELD_CLASS } from "./page/buttonClasses";

export function ShareLinkRow({ url, copied, onCopy }: { url: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input readOnly aria-label="Share link" value={url} onFocus={(e) => e.currentTarget.select()} className={`${FIELD_CLASS} min-w-0 flex-1 basis-48`} />
      <button type="button" onClick={onCopy} className={`${BUTTON_SECONDARY} shrink-0`}>
        {copied ? "Copied!" : "Copy link"}
      </button>
    </div>
  );
}
