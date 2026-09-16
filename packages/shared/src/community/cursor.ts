const SEPARATOR = "~";

export interface CursorPosition {
  createdAt: string;
  id: string;
}

export function encodeCursor(position: CursorPosition): string {
  return `${encodeURIComponent(position.createdAt)}${SEPARATOR}${encodeURIComponent(position.id)}`;
}

export function decodeCursor(cursor: string): CursorPosition | undefined {
  const parts = cursor.split(SEPARATOR);
  if (parts.length !== 2) return undefined;
  try {
    const createdAt = decodeURIComponent(parts[0]);
    const id = decodeURIComponent(parts[1]);
    if (!createdAt || !id) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}
