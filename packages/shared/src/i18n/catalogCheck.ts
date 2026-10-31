import type { Message, Messages } from "./translate.js";

function placeholders(message: Message): string {
  const text = typeof message === "string" ? message : `${message.one}\n${message.other}`;
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort().join(", ");
}

export function catalogMismatches(en: Messages, other: Messages): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(en)) {
    const translated = other[key];
    if (translated === undefined) {
      problems.push(`${key}: missing`);
    } else if (typeof en[key] !== typeof translated) {
      problems.push(`${key}: string and plural messages differ`);
    } else if (placeholders(en[key]) !== placeholders(translated)) {
      problems.push(`${key}: placeholders differ ({${placeholders(en[key])}} vs {${placeholders(translated)}})`);
    }
  }
  for (const key of Object.keys(other)) {
    if (!(key in en)) problems.push(`${key}: extra`);
  }
  return problems;
}
