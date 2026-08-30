// Pure function that walks a mural's opaque `blocks` JSON (see
// domain/types.ts's MuralRow — `blocks` is stored, and stays, as raw
// JSON text this module never validates beyond "is it an array") and
// figures out exactly which private data it references: which books
// (by bookKey), which specific highlights, which gallery images, and
// whether it needs "currently reading" or which stats numbers. This is
// the input to library/publicResolver.ts's redacted cross-module lookup,
// which backs the public GET /murals/shared/:token route.
//
// This necessarily duplicates knowledge of the frontend's MuralBlock
// discriminated union (frontend/src/lib/murals.ts) — there is no shared
// package between the frontend and backend apps, the same situation
// LibraryData/Mural already have independently on each side (see this
// module's own domain/types.ts). A new block type added to the frontend
// needs a matching `case` added HERE too, or its content simply won't
// resolve on the public mural page — fails safe: that block just renders
// empty publicly (falls into the default branch below), the editor and
// every authenticated route are entirely unaffected.
//
// Every read here is defensive: `blocks` itself might not be an array,
// an element might not be an object, `.type` might not be a string, and
// any field read off a block might not be the type expected — this
// function is fed straight from JSON.parse of a column no schema/zod
// validates deeply (murals/routes.ts's updateMuralSchema only checks
// `blocks` is an array of *something*), so nothing here may ever assume
// shape. A malformed/unexpected element is simply skipped, never thrown.

export interface ExtractedReferences {
  bookKeys: Set<string>;
  highlightRefs: Array<{ bookKey: string; highlightId: string }>;
  imageIds: Set<string>;
  needsCurrentlyReading: boolean;
  statsMetrics: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Adds every non-empty-string entry of `value` (if it's even an array)
 *  to `target` — shared by every block type that references books/
 *  metrics as a plain string array (shelf's bookKeys, stats' metrics, a
 *  tier's bookKeys, a tierlist's pool). */
function addStringArrayEntries(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (isNonEmptyString(entry)) target.add(entry);
  }
}

export function extractReferences(blocks: unknown): ExtractedReferences {
  const refs: ExtractedReferences = {
    bookKeys: new Set(),
    highlightRefs: [],
    imageIds: new Set(),
    needsCurrentlyReading: false,
    statsMetrics: new Set()
  };

  if (!Array.isArray(blocks)) return refs;

  for (const block of blocks) {
    if (!isRecord(block)) continue;
    const type = block.type;
    if (typeof type !== "string") continue;

    switch (type) {
      case "spotlight": {
        if (isNonEmptyString(block.bookKey)) refs.bookKeys.add(block.bookKey);
        break;
      }

      case "shelf": {
        addStringArrayEntries(refs.bookKeys, block.bookKeys);
        break;
      }

      case "quote": {
        if (isNonEmptyString(block.bookKey)) {
          refs.bookKeys.add(block.bookKey);
          if (isNonEmptyString(block.highlightId)) {
            refs.highlightRefs.push({ bookKey: block.bookKey, highlightId: block.highlightId });
          }
        }
        break;
      }

      case "quoteCollection": {
        if (Array.isArray(block.quotes)) {
          for (const quote of block.quotes) {
            if (!isRecord(quote)) continue;
            if (isNonEmptyString(quote.bookKey)) {
              refs.bookKeys.add(quote.bookKey);
              if (isNonEmptyString(quote.highlightId)) {
                refs.highlightRefs.push({ bookKey: quote.bookKey, highlightId: quote.highlightId });
              }
            }
          }
        }
        break;
      }

      case "image": {
        // "skip if empty string" per the brief — an unconfigured image
        // block (defaultBlockForType's `imageId: ""`) references nothing.
        if (isNonEmptyString(block.imageId)) refs.imageIds.add(block.imageId);
        break;
      }

      case "currentlyReading": {
        refs.needsCurrentlyReading = true;
        break;
      }

      case "stats": {
        addStringArrayEntries(refs.statsMetrics, block.metrics);
        break;
      }

      case "tierlist": {
        if (Array.isArray(block.tiers)) {
          for (const tier of block.tiers) {
            if (!isRecord(tier)) continue;
            addStringArrayEntries(refs.bookKeys, tier.bookKeys);
          }
        }
        addStringArrayEntries(refs.bookKeys, block.pool);
        break;
      }

      // "text" and "empty" reference nothing. Any block `type` this
      // backend copy doesn't recognize (a frontend addition not yet
      // mirrored here) falls through to this same no-op default — fails
      // safe, per this file's own top comment.
      case "text":
      case "empty":
      default:
        break;
    }
  }

  return refs;
}
