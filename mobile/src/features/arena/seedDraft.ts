import type { SeedBook } from "@scripta/shared";

export type SeedSlots = Array<SeedBook | null>;

export function slotsUnsaved(local: SeedSlots, saved: SeedSlots | null): boolean {
  return saved === null ? local.some((slot) => slot !== null) : JSON.stringify(local) !== JSON.stringify(saved);
}

export function slotsAfterServerLoad(local: SeedSlots, saved: SeedSlots | null, loaded: SeedSlots): SeedSlots {
  return slotsUnsaved(local, saved) ? local : loaded;
}

export function seedFormUnsaved(form: { name: string; size: number; duration: string }, initial: { name: string; size: number; duration: string }): boolean {
  return form.name !== initial.name || form.size !== initial.size || form.duration !== initial.duration;
}
