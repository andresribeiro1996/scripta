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
      {/* `h-8 w-8` (32px) rather than the old `h-3 w-6` (12x24px) raw-input
          dimensions — this is the only entry point to a tier's colour, and
          every OTHER control this branch touched (the up/down chevrons,
          the ⋮ menu) already moved to a 44px `toolbarIconClass()` target.
          It can't quite reach 44px itself: it sits inside the tier chip's
          fixed `w-[3em]` column alongside the label text and, in the read-
          only mural block, no button at all (`colorControl` is undefined
          there — see TierRowShell), so growing it further would start
          crowding the label or forcing the chip wider for every viewer,
          not just the editor. 32px is still a large improvement over 12px
          tall and comfortably inside the chip. */}
      <button
        onClick={() => setOpen(true)}
        title="Tier color"
        aria-label="Tier color"
        className="h-8 w-8 shrink-0 rounded-sm ring-1 ring-white/70"
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
                // Commit on `onBlur`, not the first `onChange` — the OS
                // colour wheel fires `onChange` continuously as you drag
                // around it, so committing (and closing the sheet) on the
                // first one saved whatever intermediate colour your thumb
                // first landed on and slammed the sheet shut mid-
                // interaction. The control this replaced used `onBlur`
                // for exactly this reason; restoring it lets you fiddle
                // freely and only commits the final colour once you leave
                // the picker.
                onBlur={(e) => {
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
