const LEADING_ARTICLE = /^(?:the|a|an) /;

export function withoutArticle(words: string): string {
  return words.replace(LEADING_ARTICLE, "");
}
