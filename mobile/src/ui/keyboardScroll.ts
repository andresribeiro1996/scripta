// Where a scroll view has to sit for a focused field to clear the keyboard.
// Kept out of the component so the arithmetic is testable without a renderer:
// getting it wrong leaves a field silently stranded behind the keyboard, which
// is exactly the failure this is here to prevent.
//
// All values are in scroll-content coordinates, except `view.height`, which is
// the height NOT covered by the keyboard. Returns the offset to scroll to, or
// null when the field already clears the keyboard.
export function revealOffset(
  field: { top: number; height: number },
  view: { scrollY: number; height: number },
  margin: number,
): number | null {
  const top = Math.max(0, field.top - margin);
  const bottom = field.top + field.height + margin;
  const next =
    top < view.scrollY
      ? top
      : bottom > view.scrollY + view.height
        ? // A field taller than the space left over can't clear on both sides;
          // showing its top beats showing its bottom.
          Math.max(0, Math.min(bottom - view.height, top))
        : view.scrollY;
  return next === view.scrollY ? null : next;
}
