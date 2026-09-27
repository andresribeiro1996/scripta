import type { WaitlistEntry } from "./domain/ports.js";

const field = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

export function waitlistCsv(entries: WaitlistEntry[]): string {
  return ["email,created_at", ...entries.map((entry) => `${field(entry.email)},${field(entry.createdAt)}`)].join("\n") + "\n";
}
