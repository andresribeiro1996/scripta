export function ToggleSwitch({
  checked,
  disabled,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-11 w-11 shrink-0 disabled:cursor-not-allowed"
    >
      <span
        className={`absolute inset-x-0 top-1/2 h-6 -translate-y-1/2 rounded-full border motion-safe:transition-colors ${
          checked ? "border-(--color-accent) bg-(--color-accent)" : "border-(--color-border) bg-(--color-surface)"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white motion-safe:transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`}
        />
      </span>
    </button>
  );
}
