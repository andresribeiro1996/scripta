// The exporter's own library.json — parsed entirely on-device, no server
// round trip needed (it's already LibraryData). Mirrors frontend/src/lib/
// fileImport.ts's JSON branch exactly: parse, then require a `books`
// array — the same minimum the backend's own PUT /library schema checks
// (backend/src/modules/library/routes.ts's saveLibrarySchema) and the
// same error copy, so a user who hits this on either client sees the
// same explanation.
//
// Deliberately pure/RN-free (no expo-document-picker import here) — the
// actual picker call lives in components/ImportForm.tsx, which reads the
// chosen file via plain `fetch(uri).then(r => r.text())` (works for a
// local file:// / cache-copied URI in React Native's own networking
// layer, same trick features/import/api.ts's multipart upload already
// leans on implicitly) and hands the text to parseLibraryJson below.
// Keeping this module RN-free is what lets its own characterization test
// run under plain `tsx --test` rather than needing Metro — see
// localImport.test.ts's own top comment.

import type { LibraryData } from "@scripta/shared";
import { t } from "../../../i18n";

export class InvalidLibraryJsonError extends Error {}

export function parseLibraryJson(text: string): LibraryData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidLibraryJsonError(t("library.invalidJson"));
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { books?: unknown }).books)) {
    throw new InvalidLibraryJsonError(t("library.missingBooksArray"));
  }
  return parsed as LibraryData;
}
