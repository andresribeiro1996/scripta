import type { DatabaseSync } from "node:sqlite";

const hasColumn = (db: DatabaseSync, table: string, column: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function rewriteBoard(dataJson: string, publicBooksJson: string | null, workByKey: Map<string, string>) {
  const doc: unknown = JSON.parse(dataJson);
  const board = isRecord(doc) ? doc : {};
  const seen = new Set<string>();
  const kept: string[] = [];
  const take = (keys: unknown) =>
    (Array.isArray(keys) ? keys : []).flatMap((key) => {
      const work = typeof key === "string" ? workByKey.get(key) : undefined;
      if (!work || seen.has(work)) return [];
      seen.add(work);
      kept.push(key as string);
      return [work];
    });
  const tiers = (Array.isArray(board.tiers) ? board.tiers : []).filter(isRecord).map(({ bookKeys, ...tier }) => ({ ...tier, workIds: take(bookKeys) }));
  const oldPool = Array.isArray(board.pool) ? board.pool : [];
  const pool = take(oldPool);
  let publicBooks: string | null = null;
  const snapshot = publicBooksJson === null ? undefined : parse(publicBooksJson);
  if (Array.isArray(snapshot) && snapshot.length === oldPool.length) {
    const byWork = new Map<string, Record<string, unknown>>();
    snapshot.forEach((book, index) => {
      const key = oldPool[index];
      const work = typeof key === "string" ? workByKey.get(key) : undefined;
      if (work && isRecord(book) && !byWork.has(work)) byWork.set(work, { ...book, key, workId: work });
    });
    publicBooks = JSON.stringify(pool.flatMap((work) => (byWork.has(work) ? [byWork.get(work)!] : [])));
  }
  return { data: JSON.stringify({ ...board, tiers, pool }), publicBooks, keys: kept };
}

export function migrateTierlistsToWorks(db: DatabaseSync): void {
  if (!hasColumn(db, "tierlist_works", "key")) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (hasColumn(db, "tierlist_works", "key")) {
      const workByList = new Map<string, Map<string, string>>();
      for (const row of db.prepare("SELECT tierlist_id, key, work_id FROM tierlist_works WHERE work_id IS NOT NULL").all() as Array<{ tierlist_id: string; key: string; work_id: string }>) {
        if (!workByList.has(row.tierlist_id)) workByList.set(row.tierlist_id, new Map());
        workByList.get(row.tierlist_id)!.set(row.key, row.work_id);
      }
      db.exec("CREATE TEMP TABLE kept_keys (tierlist_id TEXT NOT NULL, key TEXT NOT NULL)");
      const keep = db.prepare("INSERT INTO kept_keys (tierlist_id, key) VALUES (?, ?)");
      const update = db.prepare("UPDATE tierlists SET data = ?, public_books = ? WHERE id = ?");
      for (const row of db.prepare("SELECT id, data, public_books FROM tierlists").all() as Array<{ id: string; data: string; public_books: string | null }>) {
        const rewritten = rewriteBoard(row.data, row.public_books, workByList.get(row.id) ?? new Map());
        update.run(rewritten.data, rewritten.publicBooks, row.id);
        for (const key of rewritten.keys) keep.run(row.id, key);
      }
      db.exec(`
        CREATE TABLE tierlist_ballot_placements_new (
          ballot_id TEXT NOT NULL REFERENCES tierlist_ballots(id) ON DELETE CASCADE,
          tierlist_id TEXT NOT NULL,
          work_id TEXT NOT NULL,
          tier_id TEXT NOT NULL,
          PRIMARY KEY (ballot_id, work_id)
        );
        INSERT OR IGNORE INTO tierlist_ballot_placements_new (ballot_id, tierlist_id, work_id, tier_id)
          SELECT p.ballot_id, p.tierlist_id, w.work_id, p.tier_id
          FROM tierlist_ballot_placements AS p
          JOIN tierlist_works AS w ON w.tierlist_id = p.tierlist_id AND w.key = p.book_key
          JOIN kept_keys AS k ON k.tierlist_id = p.tierlist_id AND k.key = p.book_key
          WHERE w.work_id IS NOT NULL
          ORDER BY p.rowid;
        DROP TABLE tierlist_ballot_placements;
        ALTER TABLE tierlist_ballot_placements_new RENAME TO tierlist_ballot_placements;
        CREATE TABLE tierlist_works_new (tierlist_id TEXT NOT NULL, work_id TEXT NOT NULL, PRIMARY KEY (tierlist_id, work_id));
        INSERT OR IGNORE INTO tierlist_works_new (tierlist_id, work_id) SELECT tierlist_id, work_id FROM tierlist_works WHERE work_id IS NOT NULL;
        DROP TABLE tierlist_works;
        ALTER TABLE tierlist_works_new RENAME TO tierlist_works;
        DROP TABLE kept_keys;
        PRAGMA user_version = 1;
      `);
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
