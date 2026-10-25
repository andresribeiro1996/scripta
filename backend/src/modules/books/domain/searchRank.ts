const LEADING_ARTICLE = /^(?:the|a|an|o|os|as|um|uma) /;
const EXACT_TITLE_BONUS = 1;
const SIGNAL_WEIGHTS = { editions: 1, languages: 1, hasCover: 1, wikipediaSites: 1 };
const ROMAN_DIGITS = new Map([["i", 1], ["v", 5], ["x", 10], ["l", 50], ["c", 100], ["d", 500], ["m", 1000]]);

export type WorkSignals = { editions: number; languages: number; hasCover: boolean; wikipediaSites: number | null };
export type RankCandidate = { workId: string; textScore: number; exactTitle: boolean; signals: WorkSignals };

export function withoutArticle(words: string): string {
  return words.replace(LEADING_ARTICLE, "");
}

function rankScore({ textScore, exactTitle, signals }: RankCandidate): number {
  return textScore
    + (exactTitle ? EXACT_TITLE_BONUS : 0)
    + SIGNAL_WEIGHTS.editions * Math.log1p(signals.editions)
    + SIGNAL_WEIGHTS.languages * Math.log1p(signals.languages)
    + SIGNAL_WEIGHTS.hasCover * Math.log1p(Number(signals.hasCover))
    + SIGNAL_WEIGHTS.wikipediaSites * Math.log1p(signals.wikipediaSites ?? 0);
}

export function rankWorks(candidates: RankCandidate[]): string[] {
  return candidates
    .map((candidate) => ({ workId: candidate.workId, score: rankScore(candidate) }))
    .sort((left, right) => right.score - left.score)
    .map(({ workId }) => workId);
}

function positionValue(position: string | null): number {
  const text = position?.trim().toLowerCase() ?? "";
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (!/^[ivxlcdm]+$/.test(text)) return Infinity;
  const digits = [...text].map((letter) => ROMAN_DIGITS.get(letter)!);
  return digits.reduce((sum, digit, index) => sum + (digit < (digits[index + 1] ?? 0) ? -digit : digit), 0);
}

export function seriesOrder(members: Array<{ workId: string; position: string | null }>): string[] {
  return members
    .map(({ workId, position }) => ({ workId, at: positionValue(position) }))
    .sort((left, right) => (left.at === right.at ? 0 : left.at - right.at))
    .map(({ workId }) => workId);
}
