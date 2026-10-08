/** A real switch, not a styled checkbox — `role="switch"` + `aria-checked`
 *  so it's announced correctly, a `<button>` (not an `<input>`) since
 *  there's no plain form value being submitted here, just an on/off
 *  action each way (see SocialsSection's handleEnable/handleDisable).
 *  Flat pill + circle thumb, no shadow, matching the same minimalist
 *  redesign StyleControls.tsx's range sliders already went through
 *  (hand-drawn `appearance: none` controls over the native browser
 *  shape) rather than a plain `<input type="checkbox">`. */
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
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed ${
        checked ? "border-(--color-accent) bg-(--color-accent)" : "border-(--color-border) bg-(--color-surface)"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}
