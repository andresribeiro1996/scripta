// Domain types for the tierlists module.

/** Row shape as stored — `data` is the tier list's document ({tiers,
 *  pool}) as raw JSON text, kept opaque all the way down (same treatment
 *  as `blocks` in modules/murals/domain/types.ts's MuralRow): parsed
 *  only at the edges (service.ts parses on read, stringifies on write).
 *  This module doesn't validate the document's shape beyond "is it an
 *  object." */
export interface TierlistRow {
  id: string;
  owner_user_id: string;
  name: string;
  data: string;
  created_at: string;
  updated_at: string;
}

/** What the service hands back to routes.ts — `data` here is the parsed
 *  JSON value, not the raw text. */
export interface Tierlist {
  id: string;
  name: string;
  data: unknown;
  createdAt: string;
  updatedAt: string;
}
