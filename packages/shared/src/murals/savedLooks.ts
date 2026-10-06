import { DEFAULT_BLOCK_STYLE, resolveBlockStyle, type BlockStyle } from "../library/libraryStyle.js";

export type SavedBlockLook = { name: string; style: BlockStyle };
export const savedBlockLooksKey = (userId: string) => `mural-block-looks:${userId}`;

export function readSavedBlockLooks(raw: string | null): SavedBlockLook[] {
  if (raw === null) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("Saved looks could not be read.");
  return data.map((entry) => {
    if (!entry || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 48 || !entry.style || typeof entry.style !== "object" || Array.isArray(entry.style)) throw new Error("Saved looks could not be read.");
    const style: Partial<BlockStyle> = {};
    for (const [key, fallback] of Object.entries(DEFAULT_BLOCK_STYLE)) {
      const value: unknown = entry.style[key];
      if (value === undefined) continue;
      if (fallback === null ? value !== null && typeof value !== "string" : typeof value !== typeof fallback || typeof value === "number" && !Number.isFinite(value)) throw new Error("Saved looks could not be read.");
      Object.assign(style, { [key]: value });
    }
    const sides = style.cardBorderSides;
    if (sides && !Object.keys(DEFAULT_BLOCK_STYLE.cardBorderSides).every((key) => typeof sides[key as keyof typeof sides] === "boolean")) throw new Error("Saved looks could not be read.");
    if (sides === null) throw new Error("Saved looks could not be read.");
    return { name: entry.name.trim(), style: resolveBlockStyle(style) };
  });
}

export function saveBlockLook(looks: SavedBlockLook[], name: string, style: BlockStyle): SavedBlockLook[] {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 48) throw new Error("Use a look name of 1–48 characters.");
  return [...looks.filter((look) => look.name.toLowerCase() !== trimmed.toLowerCase()), { name: trimmed, style: { ...resolveBlockStyle(style), cardBorderSides: { ...style.cardBorderSides } } }];
}
