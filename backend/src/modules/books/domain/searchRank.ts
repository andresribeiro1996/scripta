const LEADING_ARTICLE = /^(?:the|a|an|o|os|as|um|uma) /;

export function withoutArticle(words: string): string {
  return words.replace(LEADING_ARTICLE, "");
}
