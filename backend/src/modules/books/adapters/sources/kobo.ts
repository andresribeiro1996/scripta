export function koboCoverUrl(imageId: string): string {
  return `https://cdn.kobo.com/book-images/${encodeURIComponent(imageId)}/1200/1800/False/image.jpg`;
}
