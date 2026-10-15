export type TranslationReviewGroup = "possible" | "blocked" | "merged";

export const TRANSLATION_REVIEW_GROUPS: TranslationReviewGroup[] = ["possible", "blocked", "merged"];

export const TRANSLATION_REVIEW_HEADINGS: Record<TranslationReviewGroup, string> = {
  possible: "Possible translations",
  blocked: "Blocked by an arena",
  merged: "Merged automatically"
};

export type TranslationReviewItem = {
  workId: string;
  title: string;
  author: string;
  originalTitle: string | null;
  coverUrl: string | null;
  synopsis: string | null;
  holders: number;
  finished: boolean;
  proposed: { workId: string; title: string; author: string; year: number | null; editions: number; languages: string[] };
  group: TranslationReviewGroup;
  evidence: { model: string; confidence: number | null };
  mergedAt: string | null;
};

export type TranslationReview = { items: TranslationReviewItem[]; total: number };

export type TranslationReviewAction = { merge: string } | { reject: true } | { undo: true };

export function translationEvidenceLabel(item: Pick<TranslationReviewItem, "group" | "evidence">): string {
  const decision = item.evidence.model === "code" || item.evidence.model === "manual" ? (item.evidence.model === "code" ? "Code: original title + author surname" : "Merged by hand") : `Jev ${(item.evidence.confidence ?? 0).toFixed(2)}`;
  return item.group === "blocked" ? `Both in an arena · ${decision}` : decision;
}

export function withoutTranslation(review: TranslationReview, workId: string): TranslationReview {
  const items = review.items.filter((item) => item.workId !== workId);
  return items.length === review.items.length ? review : { items, total: review.total - 1 };
}
