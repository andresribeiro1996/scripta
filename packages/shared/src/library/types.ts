// The library document's own shape — declared separately from merge.ts,
// groups.ts and libraryStyle.ts (which all reference it or are referenced
// by it) so nothing here has to pick one of those files to "belong" to.
// Historically this lived in frontend/src/api/library.ts, the only client
// that had one; frontend's api/library.ts now imports it from here and
// re-exports it under the same name so every existing `from "../api/
// library"` import keeps working unchanged.

import type { Group } from "./groups.js";
import type { LibraryStyleSettings } from "./libraryStyle.js";

export interface LibraryData {
  source?: string;
  schema_version?: number;
  book_count?: number;
  books: Array<Record<string, unknown>>;
  /** User-given name for this library (e.g. "Andre's Library") — never
   *  set by an importer, only by the user via LibraryPage. Absent until
   *  they name it for the first time; falls back to "Library" in the UI. */
  name?: string;
  /** Series and collections — see groups.ts. Optional: absent until the
   *  first group (auto-seeded series or user-created collection) is
   *  saved. */
  groups?: Group[];
  /** Card size/spacing/background preferences — see libraryStyle.ts.
   *  Absent until the user visits /dashboard/style and changes something;
   *  resolveLibraryStyle() fills in defaults wherever this is read. */
  style?: LibraryStyleSettings;
  [key: string]: unknown;
}
