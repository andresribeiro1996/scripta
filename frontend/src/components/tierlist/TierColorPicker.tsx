import { useState } from "react";
import { Sheet } from "../Sheet";

/** The ladder colours the backend seeds a new tier list with
 *  (backend/src/modules/tierlists/service.ts) — offered as presets so a
 *  tier a user adds by hand lands in the same palette as the S/A/B/C/D
 *  rungs it sits beside, instead of whatever the OS colour picker
 *  happened to open on. */
const PRESETS = [
  { label: "S", color: "#c9482f" },
  { label: "A", color: "#d98a3d" },
  { label: "B", color: "#c9a53d" },
  { label: "C", color: "#5c9e5c" },
  { label: "D", color: "#4a7fc9" },
  { label: "Grey", color: "#8a8580" }
];

/** The swatch inside a tier's colour chip. Opens a sheet of presets
 *  rather than the OS colour picker directly: on a phone the native
 *  picker is a full-screen modal with a colour wheel, which is a heavy
 *  detour for what is almost always "make this one red like an S rung".
 *  The custom option is still there for anyone who wants the wheel. */
export function TierColorPicker({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Tier color"
        aria-label="Tier color"
        className="h-3 w-6 shrink-0 rounded-sm ring-1 ring-white/70"
        style={{ backgroundColor: color }}
      />
      {open && (
        <Sheet title="Tier color" onClose={() => setOpen(false)}>
          <div className="flex flex-wrap gap-2 p-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.color}
                onClick={() => {
                  onChange(preset.color);
                  setOpen(false);
                }}
                aria-label={preset.label}
                title={preset.label}
                className={`h-11 w-11 rounded-lg ring-2 ${preset.color === color ? "ring-(--color-accent)" : "ring-transparent"}`}
                style={{ backgroundColor: preset.color }}
              />
            ))}
            <label className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-(--color-border) text-[10px] font-semibold text-(--color-text-dim)">
              Custom
              <input
                type="color"
                defaultValue={color}
                onChange={(e) => {
                  onChange(e.target.value);
                  setOpen(false);
                }}
                className="sr-only"
              />
            </label>
          </div>
        </Sheet>
      )}
    </>
  );
}
