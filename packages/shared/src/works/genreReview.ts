export type GenreReviewGroup = "rejected" | "none" | "unsure" | "possible";

export const GENRE_REVIEW_GROUPS: GenreReviewGroup[] = ["rejected", "none", "unsure", "possible"];

export const GENRE_REVIEW_HEADINGS: Record<GenreReviewGroup, string> = {
  rejected: "Rejected by TypeSafe",
  none: "Jev found no genre",
  unsure: "Jev was unsure",
  possible: "Possible genres"
};

export type GenreReviewEvidence =
  | { group: "rejected"; status: number | null; reason: string; attempts: number; lastAt: string }
  | { group: "none"; confidence: number }
  | { group: "unsure" | "possible"; genre: string; confidence: number };

export type GenreReviewItem = {
  workId: string;
  title: string;
  author: string;
  coverUrl: string | null;
  synopsis: string | null;
  holders: number;
  finished: boolean;
  evidence: GenreReviewEvidence;
};

export type GenreReview = { items: GenreReviewItem[]; total: number };

export type GenreReviewAction = { genres: string[] } | { retry: true };

export function genreEvidenceLabel(evidence: GenreReviewEvidence): string {
  const score = (confidence: number) => confidence.toFixed(2);
  if (evidence.group === "rejected") return `Rejected ${evidence.attempts}× · ${evidence.reason}`;
  if (evidence.group === "none") return `Jev: none (${score(evidence.confidence)})`;
  if (evidence.group === "unsure") return `Jev: ${evidence.genre}? (${score(evidence.confidence)})`;
  return `Possibly ${evidence.genre} (${score(evidence.confidence)})`;
}

export function withoutWork(review: GenreReview, workId: string): GenreReview {
  const items = review.items.filter((item) => item.workId !== workId);
  return items.length === review.items.length ? review : { items, total: review.total - 1 };
}
