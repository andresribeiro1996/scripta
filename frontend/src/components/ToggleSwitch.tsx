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
      className={`relative h-6 w-11 shrink-0 rounded-full border motion-safe:transition-colors disabled:cursor-not-allowed ${
        checked ? "border-(--color-accent) bg-(--color-accent)" : "border-(--color-border) bg-(--color-surface)"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white motion-safe:transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}
