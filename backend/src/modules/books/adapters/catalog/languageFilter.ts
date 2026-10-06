import type { BookCatalog } from "../../domain/ports.js";

const WORDS: Record<"pt" | "en", Set<string>> = {
  pt: new Set("o de que e do da em um uma para com não os dos das por se na no mais ao ele ela são seu sua foi como".split(" ")),
  en: new Set("the and of to in is that with was for his her he she who their from by it on are".split(" "))
};
const MIN_HITS = 3;
const DOMINANCE = 2;

function detectedLanguage(text: string): "pt" | "en" | null {
  const score = { pt: 0, en: 0 };
  for (const [word] of text.toLowerCase().matchAll(/\p{L}+/gu)) {
    if (WORDS.pt.has(word)) score.pt++;
    if (WORDS.en.has(word)) score.en++;
  }
  if (score.pt >= MIN_HITS && score.pt > score.en * DOMINANCE) return "pt";
  if (score.en >= MIN_HITS && score.en > score.pt * DOMINANCE) return "en";
  return null;
}

export function summaryMatchesLanguage(summary: string, language: string | null): boolean {
  const wanted = language?.split("-")[0];
  const detected = detectedLanguage(summary);
  return !detected || (wanted !== "pt" && wanted !== "en") || detected === wanted;
}

export function onlyMatchingLanguage(catalog: BookCatalog): BookCatalog {
  return {
    ...catalog,
    async fetchDetails(lookup) {
      const details = await catalog.fetchDetails(lookup);
      const summary = details?.metadata.summary;
      if (!details || !summary || summaryMatchesLanguage(summary, lookup.language ?? null)) return details;
      return { ...details, metadata: { ...details.metadata, summary: null }, summarySource: null };
    }
  };
}
