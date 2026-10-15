export type SynopsisReviewGroup = "hidden" | "doubtful";

export const SYNOPSIS_REVIEW_GROUPS: SynopsisReviewGroup[] = ["hidden", "doubtful"];

export const SYNOPSIS_REVIEW_HEADINGS: Record<SynopsisReviewGroup, string> = {
  hidden: "Hidden from readers",
  doubtful: "Shown, but doubtful"
};

export type SynopsisReviewItem = {
  hash: string;
  title: string;
  author: string;
  coverUrl: string | null;
  editions: number;
  works: number;
  source: string | null;
  text: string;
  holders: number;
  finished: boolean;
  group: SynopsisReviewGroup;
  model: string;
  kind: string;
  usable: number;
};

export type SynopsisReview = { items: SynopsisReviewItem[]; total: number };

export type SynopsisDecision = "keep" | "hide";

const KIND_LABELS: Record<string, string> = {
  synopsis: "synopsis",
  author_bio: "author bio",
  praise: "praise",
  collection: "collection",
  product: "product",
  contents: "contents",
  other_book: "other book",
  fragment: "fragment"
};

export function synopsisEvidenceLabel(item: Pick<SynopsisReviewItem, "model" | "kind" | "usable">): string {
  if (item.model === "rule") return "Rule: under 40 letters";
  return `Jev: ${KIND_LABELS[item.kind] ?? item.kind} (${item.usable.toFixed(2)})`;
}

export function withoutSynopsis(review: SynopsisReview, hash: string): SynopsisReview {
  const items = review.items.filter((item) => item.hash !== hash);
  return items.length === review.items.length ? review : { items, total: review.total - 1 };
}
