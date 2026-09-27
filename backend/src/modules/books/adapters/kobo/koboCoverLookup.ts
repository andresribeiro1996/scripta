// Kobo's own image proxy — ported from the frontend's lib/covers.ts
// (koboCoverUrl). Requested size: 600×900, not Kobo's own smaller
// default, for the same "don't serve a soft, blown-up thumbnail"
// reasoning documented there.
//
// A plain, synchronous URL builder — no fetch here at all, deliberately.
// Unlike Hardcover/Google/Open Library's fuzzy search (which need a real
// API call just to DISCOVER a candidate URL before any image bytes can
// be fetched), the "URL" and the "image bytes" for a Kobo cover are the
// exact same single request — service.ts's own shared download-and-cache
// step (which fetches once, checks the response, and moves to the next
// candidate on any failure) IS the validation; a separate pre-check fetch
// here would just be the same request made twice for no benefit.
//
// This is the one source keyed by Kobo's own imageId, not an ISBN — some
// books (sideloaded, or missing ISBN metadata) have an imageId with no
// ISBN at all, so it's tried independently, not folded into the ISBN-
// keyed sources below.

export function koboCoverUrl(imageId: string): string {
  return `https://cdn.kobo.com/book-images/${encodeURIComponent(imageId)}/600/900/False/image.jpg`;
}
