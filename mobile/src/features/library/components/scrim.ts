export function scrimStops(intensity: number): { offset: number; opacity: number }[] {
  const peak = Math.min(1, Math.max(0, intensity / 100));
  return [{ offset: 0, opacity: peak }, { offset: 0.36, opacity: peak }, { offset: 0.7, opacity: 0 }];
}
