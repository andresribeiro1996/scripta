// The Postgres implementation of the LibraryRepository port.
//
// A sibling of adapters/sqlite/, not a replacement: service.ts and
// domain/ are untouched by this file existing, which is what the
// ports/adapters split was for. Which one a deployment uses is decided in
// plugin.ts by whether DATABASE_URL is set.
//
// The reason to run this instead of SQLite is not throughput — SQLite is
// fast enough for this workload — it is that a file on a volume can only
// be attached to one machine, so a SQLite deployment cannot have
// replicas, rolling deploys, or point-in-time restore. See
// docs/DEPLOYMENT-PLAN.md phase 3.

import type { Pool, PoolClient } from "pg";
import type { LibraryRepository } from "../../domain/ports.js";
import type { Book, BlockLayout, Group, GroupType, LibraryContents, LibrarySettings, Mural, MuralBlock } from "../../domain/types.js";

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function intOrNull(value: unknown): number | null {
  if (typeof value === "number") return value;
  // Postgres returns some integer types as strings via node-postgres; be
  // liberal here rather than silently turning a real value into null.
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Timestamps come back as Date objects from node-postgres, but the
 *  domain (and the wire format the frontend sees) speaks ISO strings —
 *  the same values the SQLite adapter stores directly. Normalising here
 *  keeps that difference inside the adapter. */
function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return textOrNull(value);
}

export function createPgLibraryRepository(pool: Pool): LibraryRepository {
  /** Runs `fn` inside a transaction on a dedicated connection, so
   *  concurrent requests can't interleave statements on one client. */
  async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async function writeSettings(client: PoolClient, userId: string, settings: LibrarySettings): Promise<void> {
    await client.query(
      `INSERT INTO library_settings (user_id, name, source, schema_version, style, extra, version, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET
         name = EXCLUDED.name,
         source = EXCLUDED.source,
         schema_version = EXCLUDED.schema_version,
         style = EXCLUDED.style,
         extra = EXCLUDED.extra,
         version = EXCLUDED.version,
         updated_at = EXCLUDED.updated_at`,
      [
        userId,
        settings.name,
        settings.source,
        settings.schemaVersion,
        settings.style === null ? null : JSON.stringify(settings.style),
        JSON.stringify(settings.extra ?? {}),
        settings.version,
        settings.updatedAt
      ]
    );
  }

  async function writeBook(client: PoolClient, userId: string, book: Book, updatedAt: string): Promise<void> {
    await client.query(
      `INSERT INTO books (user_id, book_key, title, author, isbn, series, sort_position, data, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, book_key) DO UPDATE SET
         title = EXCLUDED.title,
         author = EXCLUDED.author,
         isbn = EXCLUDED.isbn,
         series = EXCLUDED.series,
         sort_position = EXCLUDED.sort_position,
         data = EXCLUDED.data,
         updated_at = EXCLUDED.updated_at`,
      [userId, book.bookKey, book.title, book.author, book.isbn, book.series, book.sortPosition, JSON.stringify(book.data), updatedAt]
    );

    // Replace rather than merge — the caller owns the full highlight list
    // for this book, same contract as the SQLite adapter.
    await client.query(`DELETE FROM highlights WHERE user_id = $1 AND book_key = $2`, [userId, book.bookKey]);
    for (const [index, highlight] of book.highlights.entries()) {
      await client.query(
        `INSERT INTO highlights (user_id, book_key, bookmark_id, data, position)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, book_key, bookmark_id) DO UPDATE SET
           data = EXCLUDED.data, position = EXCLUDED.position`,
        [userId, book.bookKey, String(highlight.BookmarkID), JSON.stringify(highlight), index]
      );
    }
  }

  async function writeGroup(client: PoolClient, userId: string, group: Group, position: number): Promise<void> {
    await client.query(
      `INSERT INTO groups (user_id, id, type, name, style, position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, id) DO UPDATE SET
         type = EXCLUDED.type, name = EXCLUDED.name, style = EXCLUDED.style,
         position = EXCLUDED.position, updated_at = EXCLUDED.updated_at`,
      [
        userId,
        group.id,
        group.type,
        group.name,
        group.style === null ? null : JSON.stringify(group.style),
        position,
        group.createdAt,
        group.updatedAt
      ]
    );

    await client.query(`DELETE FROM group_books WHERE user_id = $1 AND group_id = $2`, [userId, group.id]);
    for (const [index, bookKey] of group.bookKeys.entries()) {
      await client.query(
        `INSERT INTO group_books (user_id, group_id, book_key, position) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, group_id, book_key) DO UPDATE SET position = EXCLUDED.position`,
        [userId, group.id, bookKey, index]
      );
    }
  }

  async function writeMural(client: PoolClient, userId: string, mural: Mural, position: number): Promise<void> {
    await client.query(
      `INSERT INTO murals (user_id, id, name, cover_image_id, cover_image_url, position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, id) DO UPDATE SET
         name = EXCLUDED.name, cover_image_id = EXCLUDED.cover_image_id,
         cover_image_url = EXCLUDED.cover_image_url, position = EXCLUDED.position,
         updated_at = EXCLUDED.updated_at`,
      [userId, mural.id, mural.name, mural.coverImageId, mural.coverImageUrl, position, mural.createdAt, mural.updatedAt]
    );

    await client.query(`DELETE FROM mural_blocks WHERE user_id = $1 AND mural_id = $2`, [userId, mural.id]);
    for (const [index, block] of mural.blocks.entries()) {
      await client.query(
        `INSERT INTO mural_blocks (user_id, id, mural_id, type, x, y, w, h, position, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, id) DO UPDATE SET
           mural_id = EXCLUDED.mural_id, type = EXCLUDED.type,
           x = EXCLUDED.x, y = EXCLUDED.y, w = EXCLUDED.w, h = EXCLUDED.h,
           position = EXCLUDED.position, data = EXCLUDED.data`,
        [userId, block.id, mural.id, block.type, block.layout.x, block.layout.y, block.layout.w, block.layout.h, index, JSON.stringify(block.data)]
      );
    }
  }

  async function bumpVersion(client: PoolClient, userId: string): Promise<number> {
    const { rows } = await client.query(
      `UPDATE library_settings SET version = version + 1, updated_at = now()
       WHERE user_id = $1 RETURNING version`,
      [userId]
    );
    return intOrNull(rows[0]?.version) ?? 0;
  }

  return {
    async getContents(userId) {
      const settingsResult = await pool.query(`SELECT * FROM library_settings WHERE user_id = $1`, [userId]);
      const settingsRow = settingsResult.rows[0];
      if (!settingsRow) return undefined;

      const settings: LibrarySettings = {
        name: textOrNull(settingsRow.name),
        source: textOrNull(settingsRow.source),
        schemaVersion: intOrNull(settingsRow.schema_version),
        // JSONB comes back already parsed — no JSON.parse here, unlike the
        // SQLite adapter where these columns are TEXT.
        style: settingsRow.style ?? null,
        extra: (settingsRow.extra ?? {}) as Record<string, unknown>,
        version: intOrNull(settingsRow.version) ?? 1,
        updatedAt: isoOrNull(settingsRow.updated_at) ?? new Date().toISOString()
      };

      // One query per table, stitched in memory — the same shape as the
      // SQLite adapter, and for the same reason: a query per book for its
      // highlights is the N+1 that makes a large library slow to read.
      const [booksResult, highlightsResult, groupsResult, groupBooksResult, muralsResult, blocksResult] = await Promise.all([
        pool.query(`SELECT * FROM books WHERE user_id = $1 ORDER BY sort_position NULLS LAST, book_key`, [userId]),
        pool.query(`SELECT * FROM highlights WHERE user_id = $1 ORDER BY book_key, position`, [userId]),
        pool.query(`SELECT * FROM groups WHERE user_id = $1 ORDER BY position`, [userId]),
        pool.query(`SELECT group_id, book_key FROM group_books WHERE user_id = $1 ORDER BY group_id, position`, [userId]),
        pool.query(`SELECT * FROM murals WHERE user_id = $1 ORDER BY position`, [userId]),
        pool.query(`SELECT * FROM mural_blocks WHERE user_id = $1 ORDER BY mural_id, position`, [userId])
      ]);

      const highlightsByBook = new Map<string, Array<Record<string, unknown>>>();
      for (const row of highlightsResult.rows) {
        const key = String(row.book_key);
        const list = highlightsByBook.get(key) ?? [];
        list.push(row.data as Record<string, unknown>);
        highlightsByBook.set(key, list);
      }

      const books: Book[] = booksResult.rows.map((row) => {
        const key = String(row.book_key);
        return {
          bookKey: key,
          title: textOrNull(row.title),
          author: textOrNull(row.author),
          isbn: textOrNull(row.isbn),
          series: textOrNull(row.series),
          sortPosition: intOrNull(row.sort_position),
          data: (row.data ?? {}) as Record<string, unknown>,
          highlights: highlightsByBook.get(key) ?? []
        };
      });

      const bookKeysByGroup = new Map<string, string[]>();
      for (const row of groupBooksResult.rows) {
        const groupId = String(row.group_id);
        const list = bookKeysByGroup.get(groupId) ?? [];
        list.push(String(row.book_key));
        bookKeysByGroup.set(groupId, list);
      }

      const groups: Group[] = groupsResult.rows.map((row) => {
        const id = String(row.id);
        return {
          id,
          type: (row.type === "series" ? "series" : "collection") as GroupType,
          name: textOrNull(row.name) ?? "",
          style: row.style ?? null,
          bookKeys: bookKeysByGroup.get(id) ?? [],
          createdAt: isoOrNull(row.created_at) ?? settings.updatedAt,
          updatedAt: isoOrNull(row.updated_at) ?? settings.updatedAt
        };
      });

      const blocksByMural = new Map<string, MuralBlock[]>();
      for (const row of blocksResult.rows) {
        const muralId = String(row.mural_id);
        const list = blocksByMural.get(muralId) ?? [];
        list.push({
          id: String(row.id),
          type: textOrNull(row.type) ?? "empty",
          layout: {
            x: intOrNull(row.x) ?? 0,
            y: intOrNull(row.y) ?? 0,
            w: intOrNull(row.w) ?? 1,
            h: intOrNull(row.h) ?? 1
          },
          data: (row.data ?? {}) as Record<string, unknown>
        });
        blocksByMural.set(muralId, list);
      }

      const murals: Mural[] = muralsResult.rows.map((row) => {
        const id = String(row.id);
        return {
          id,
          name: textOrNull(row.name) ?? "",
          blocks: blocksByMural.get(id) ?? [],
          coverImageId: textOrNull(row.cover_image_id),
          coverImageUrl: textOrNull(row.cover_image_url),
          createdAt: isoOrNull(row.created_at) ?? settings.updatedAt,
          updatedAt: isoOrNull(row.updated_at) ?? settings.updatedAt
        };
      });

      return { settings, books, groups, murals };
    },

    async getVersion(userId) {
      const { rows } = await pool.query(`SELECT version FROM library_settings WHERE user_id = $1`, [userId]);
      return rows[0] ? (intOrNull(rows[0].version) ?? 1) : undefined;
    },

    async replaceContents(userId, contents) {
      await inTransaction(async (client) => {
        await client.query(`DELETE FROM books WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM highlights WHERE user_id = $1`, [userId]);
        // group_books and mural_blocks go with their parents via
        // ON DELETE CASCADE — enforced by default here, unlike SQLite
        // where it needs a per-connection pragma.
        await client.query(`DELETE FROM groups WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM murals WHERE user_id = $1`, [userId]);

        await writeSettings(client, userId, contents.settings);
        for (const book of contents.books) await writeBook(client, userId, book, contents.settings.updatedAt);
        for (const [index, group] of contents.groups.entries()) await writeGroup(client, userId, group, index);
        for (const [index, mural] of contents.murals.entries()) await writeMural(client, userId, mural, index);
      });
      return contents;
    },

    async upsertBook(userId, book) {
      await inTransaction(async (client) => {
        await writeBook(client, userId, book, new Date().toISOString());
        await bumpVersion(client, userId);
      });
    },

    async deleteBook(userId, bookKey) {
      await inTransaction(async (client) => {
        await client.query(`DELETE FROM highlights WHERE user_id = $1 AND book_key = $2`, [userId, bookKey]);
        await client.query(`DELETE FROM books WHERE user_id = $1 AND book_key = $2`, [userId, bookKey]);
        await bumpVersion(client, userId);
      });
    },

    async upsertGroup(userId, group) {
      await inTransaction(async (client) => {
        const existing = await client.query(`SELECT position FROM groups WHERE user_id = $1 AND id = $2`, [userId, group.id]);
        const next = await client.query(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM groups WHERE user_id = $1`, [userId]);
        const position = existing.rows[0] ? (intOrNull(existing.rows[0].position) ?? 0) : (intOrNull(next.rows[0]?.p) ?? 0);
        await writeGroup(client, userId, group, position);
        await bumpVersion(client, userId);
      });
    },

    async deleteGroup(userId, groupId) {
      await inTransaction(async (client) => {
        await client.query(`DELETE FROM groups WHERE user_id = $1 AND id = $2`, [userId, groupId]);
        await bumpVersion(client, userId);
      });
    },

    async upsertMural(userId, mural) {
      await inTransaction(async (client) => {
        const existing = await client.query(`SELECT position FROM murals WHERE user_id = $1 AND id = $2`, [userId, mural.id]);
        const next = await client.query(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM murals WHERE user_id = $1`, [userId]);
        const position = existing.rows[0] ? (intOrNull(existing.rows[0].position) ?? 0) : (intOrNull(next.rows[0]?.p) ?? 0);
        await writeMural(client, userId, mural, position);
        await bumpVersion(client, userId);
      });
    },

    async deleteMural(userId, muralId) {
      await inTransaction(async (client) => {
        await client.query(`DELETE FROM murals WHERE user_id = $1 AND id = $2`, [userId, muralId]);
        await bumpVersion(client, userId);
      });
    },

    async saveMuralBlockLayout(userId, muralId, blockId, layout: BlockLayout) {
      return inTransaction(async (client) => {
        const result = await client.query(
          `UPDATE mural_blocks SET x = $1, y = $2, w = $3, h = $4
           WHERE user_id = $5 AND mural_id = $6 AND id = $7`,
          [layout.x, layout.y, layout.w, layout.h, userId, muralId, blockId]
        );
        const updated = (result.rowCount ?? 0) > 0;

        if (!updated) {
          // Nothing changed — don't bump the version, or a request naming
          // a block deleted elsewhere would invalidate every other
          // device's version for no reason.
          const current = await client.query(`SELECT version FROM library_settings WHERE user_id = $1`, [userId]);
          return { updated, version: intOrNull(current.rows[0]?.version) ?? 0 };
        }

        await client.query(`UPDATE murals SET updated_at = now() WHERE user_id = $1 AND id = $2`, [userId, muralId]);
        return { updated, version: await bumpVersion(client, userId) };
      });
    }
  };
}
