import { useId } from "react";
import { themes, type ThemeColors, type ThemePreference } from "@scripta/shared/themes";

function Swatch({ colors }: { colors: ThemeColors }) {
  return (
    <div className="flex flex-1 p-1.5" style={{ background: colors.background }}>
      <div className="flex flex-1 flex-col justify-between rounded p-1.5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: colors.text }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: colors.textDim }} />
        <div className="h-2.5 rounded" style={{ background: colors.accent }} />
      </div>
    </div>
  );
}

function optionLabel(option: ThemePreference): string {
  return option === "system" ? "System" : themes[option].label;
}

function OptionSwatch({ option }: { option: ThemePreference }) {
  if (option === "system") {
    return (
      <>
        <Swatch colors={themes.light.colors} />
        <Swatch colors={themes.dark.colors} />
      </>
    );
  }
  return <Swatch colors={themes[option].colors} />;
}

export function ThemeOptionGrid<T extends ThemePreference>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (option: T) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {options.map((option) => (
          <label key={option} className="cursor-pointer">
            <input type="radio" name={name} value={option} checked={value === option} onClick={() => onChange(option)} readOnly className="peer sr-only" />
            <div className="flex h-16 overflow-hidden rounded-lg border border-(--color-border) peer-checked:ring-2 peer-checked:ring-(--color-accent) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--color-accent)">
              <OptionSwatch option={option} />
            </div>
            <span className="mt-1.5 block text-center text-xs">{optionLabel(option)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
