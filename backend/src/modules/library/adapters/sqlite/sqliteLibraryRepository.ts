// The SQLite implementation of the LibraryRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// LibraryRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { LibraryRepository } from "../../domain/ports.js";
import type { Book, BlockLayout, Group, GroupType, LibraryContents, LibrarySettings, Mural, MuralBlock } from "../../domain/types.js";

// node:sqlite hands back `unknown` column values; these narrow them at
// the one boundary where raw rows enter the typed world.
function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    // A row we can't parse is a row we'd otherwise throw the user's whole
    // library away over. Fall back rather than fail the read.
    return fallback;
  }
}

export function createSqliteLibraryRepository(db: DatabaseSync): LibraryRepository {
  const selectSettings = db.prepare(`SELECT * FROM library_settings WHERE user_id = ?`);
  const selectVersion = db.prepare(`SELECT version FROM library_settings WHERE user_id = ?`);
  const selectBooks = db.prepare(
    `SELECT * FROM books WHERE user_id = ? ORDER BY sort_position IS NULL, sort_position, book_key`
  );
  const selectHighlights = db.prepare(`SELECT * FROM highlights WHERE user_id = ? ORDER BY book_key, position`);
  const selectGroups = db.prepare(`SELECT * FROM groups WHERE user_id = ? ORDER BY position`);
  const selectGroupBooks = db.prepare(
    `SELECT group_id, book_key FROM group_books WHERE user_id = ? ORDER BY group_id, position`
  );
  const selectMurals = db.prepare(`SELECT * FROM murals WHERE user_id = ? ORDER BY position`);
  const selectMuralBlocks = db.prepare(`SELECT * FROM mural_blocks WHERE user_id = ? ORDER BY mural_id, position`);

  const upsertSettingsStmt = db.prepare(`
    INSERT INTO library_settings (user_id, name, source, schema_version, style, extra, version, updated_at)
    VALUES ($user_id, $name, $source, $schema_version, $style, $extra, $version, $updated_at)
    ON CONFLICT(user_id) DO UPDATE SET
      name = excluded.name,
      source = excluded.source,
      schema_version = excluded.schema_version,
      style = excluded.style,
      extra = excluded.extra,
      version = excluded.version,
      updated_at = excluded.updated_at
  `);

  const upsertBookStmt = db.prepare(`
    INSERT INTO books (user_id, book_key, title, author, isbn, series, sort_position, data, updated_at)
    VALUES ($user_id, $book_key, $title, $author, $isbn, $series, $sort_position, $data, $updated_at)
    ON CONFLICT(user_id, book_key) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      isbn = excluded.isbn,
      series = excluded.series,
      sort_position = excluded.sort_position,
      data = excluded.data,
      updated_at = excluded.updated_at
  `);

  const insertHighlightStmt = db.prepare(`
    INSERT INTO highlights (user_id, book_key, bookmark_id, data, position)
    VALUES ($user_id, $book_key, $bookmark_id, $data, $position)
    ON CONFLICT(user_id, book_key, bookmark_id) DO UPDATE SET
      data = excluded.data,
      position = excluded.position
  `);

  const upsertGroupStmt = db.prepare(`
    INSERT INTO groups (user_id, id, type, name, style, position, created_at, updated_at)
    VALUES ($user_id, $id, $type, $name, $style, $position, $created_at, $updated_at)
    ON CONFLICT(user_id, id) DO UPDATE SET
      type = excluded.type,
      name = excluded.name,
      style = excluded.style,
      position = excluded.position,
      updated_at = excluded.updated_at
  `);

  const insertGroupBookStmt = db.prepare(
    `INSERT INTO group_books (user_id, group_id, book_key, position) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, group_id, book_key) DO UPDATE SET position = excluded.position`
  );

  const upsertMuralStmt = db.prepare(`
    INSERT INTO murals (user_id, id, name, cover_image_id, cover_image_url, position, created_at, updated_at)
    VALUES ($user_id, $id, $name, $cover_image_id, $cover_image_url, $position, $created_at, $updated_at)
    ON CONFLICT(user_id, id) DO UPDATE SET
      name = excluded.name,
      cover_image_id = excluded.cover_image_id,
      cover_image_url = excluded.cover_image_url,
      position = excluded.position,
      updated_at = excluded.updated_at
  `);

  const upsertMuralBlockStmt = db.prepare(`
    INSERT INTO mural_blocks (user_id, id, mural_id, type, x, y, w, h, position, data)
    VALUES ($user_id, $id, $mural_id, $type, $x, $y, $w, $h, $position, $data)
    ON CONFLICT(user_id, id) DO UPDATE SET
      mural_id = excluded.mural_id,
      type = excluded.type,
      x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
      position = excluded.position,
      data = excluded.data
  `);

  const deleteBookStmt = db.prepare(`DELETE FROM books WHERE user_id = ? AND book_key = ?`);
  const deleteBookHighlightsStmt = db.prepare(`DELETE FROM highlights WHERE user_id = ? AND book_key = ?`);
  const deleteGroupStmt = db.prepare(`DELETE FROM groups WHERE user_id = ? AND id = ?`);
  const deleteMuralStmt = db.prepare(`DELETE FROM murals WHERE user_id = ? AND id = ?`);
  const deleteGroupBooksStmt = db.prepare(`DELETE FROM group_books WHERE user_id = ? AND group_id = ?`);
  const deleteMuralBlocksStmt = db.prepare(`DELETE FROM mural_blocks WHERE user_id = ? AND mural_id = ?`);

  const deleteAllBooks = db.prepare(`DELETE FROM books WHERE user_id = ?`);
  const deleteAllHighlights = db.prepare(`DELETE FROM highlights WHERE user_id = ?`);
  const deleteAllGroups = db.prepare(`DELETE FROM groups WHERE user_id = ?`);
  const deleteAllMurals = db.prepare(`DELETE FROM murals WHERE user_id = ?`);

  const updateBlockLayoutStmt = db.prepare(`
    UPDATE mural_blocks SET x = $x, y = $y, w = $w, h = $h
    WHERE id = $id AND mural_id = $mural_id AND user_id = $user_id
  `);
  const touchMuralStmt = db.prepare(`UPDATE murals SET updated_at = ? WHERE id = ? AND user_id = ?`);
  const bumpVersionStmt = db.prepare(
    `UPDATE library_settings SET version = version + 1, updated_at = ? WHERE user_id = ?`
  );

  function writeSettings(userId: string, settings: LibrarySettings): void {
    upsertSettingsStmt.run({
      $user_id: userId,
      $name: settings.name,
      $source: settings.source,
      $schema_version: settings.schemaVersion,
      $style: settings.style === null ? null : JSON.stringify(settings.style),
      $extra: JSON.stringify(settings.extra ?? {}),
      $version: settings.version,
      $updated_at: settings.updatedAt
    });
  }

  function writeBook(userId: string, book: Book, updatedAt: string): void {
    upsertBookStmt.run({
      $user_id: userId,
      $book_key: book.bookKey,
      $title: book.title,
      $author: book.author,
      $isbn: book.isbn,
      $series: book.series,
      $sort_position: book.sortPosition,
      $data: JSON.stringify(book.data),
      $updated_at: updatedAt
    });

    // Replace rather than merge: the caller owns the full highlight list
    // for this book (merge.ts's unionHighlights already ran on the way
    // in), so a highlight absent here is genuinely deleted.
    deleteBookHighlightsStmt.run(userId, book.bookKey);
    book.highlights.forEach((highlight, index) => {
      insertHighlightStmt.run({
        $user_id: userId,
        $book_key: book.bookKey,
        $bookmark_id: String(highlight.BookmarkID),
        $data: JSON.stringify(highlight),
        $position: index
      });
    });
  }

  function writeGroup(userId: string, group: Group, position: number): void {
    upsertGroupStmt.run({
      $id: group.id,
      $user_id: userId,
      $type: group.type,
      $name: group.name,
      $style: group.style === null ? null : JSON.stringify(group.style),
      $position: position,
      $created_at: group.createdAt,
      $updated_at: group.updatedAt
    });
    deleteGroupBooksStmt.run(userId, group.id);
    group.bookKeys.forEach((key, index) => insertGroupBookStmt.run(userId, group.id, key, index));
  }

  function writeMural(userId: string, mural: Mural, position: number): void {
    upsertMuralStmt.run({
      $id: mural.id,
      $user_id: userId,
      $name: mural.name,
      $cover_image_id: mural.coverImageId,
      $cover_image_url: mural.coverImageUrl,
      $position: position,
      $created_at: mural.createdAt,
      $updated_at: mural.updatedAt
    });
    deleteMuralBlocksStmt.run(userId, mural.id);
    mural.blocks.forEach((block, index) => {
      upsertMuralBlockStmt.run({
        $id: block.id,
        $mural_id: mural.id,
        $user_id: userId,
        $type: block.type,
        $x: block.layout.x,
        $y: block.layout.y,
        $w: block.layout.w,
        $h: block.layout.h,
        $position: index,
        $data: JSON.stringify(block.data)
      });
    });
  }

  return {
    getContents(userId) {
      const settingsRow = selectSettings.get(userId) as Record<string, unknown> | undefined;
      if (!settingsRow) return undefined;

      const settings: LibrarySettings = {
        name: textOrNull(settingsRow.name),
        source: textOrNull(settingsRow.source),
        schemaVersion: intOrNull(settingsRow.schema_version),
        style: settingsRow.style === null ? null : parseJson(settingsRow.style, null),
        extra: parseJson(settingsRow.extra, {}) as Record<string, unknown>,
        version: intOrNull(settingsRow.version) ?? 1,
        updatedAt: textOrNull(settingsRow.updated_at) ?? new Date().toISOString()
      };

      // One query per table, then stitched in memory — rather than a
      // query per book for its highlights, which is the N+1 that would
      // make a large library slow to read.
      const highlightsByBook = new Map<string, Array<Record<string, unknown>>>();
      for (const raw of selectHighlights.all(userId) as Array<Record<string, unknown>>) {
        const key = String(raw.book_key);
        const list = highlightsByBook.get(key) ?? [];
        list.push(parseJson(raw.data, {}) as Record<string, unknown>);
        highlightsByBook.set(key, list);
      }

      const books: Book[] = (selectBooks.all(userId) as Array<Record<string, unknown>>).map((raw) => {
        const key = String(raw.book_key);
        return {
          bookKey: key,
          title: textOrNull(raw.title),
          author: textOrNull(raw.author),
          isbn: textOrNull(raw.isbn),
          series: textOrNull(raw.series),
          sortPosition: intOrNull(raw.sort_position),
          data: parseJson(raw.data, {}) as Record<string, unknown>,
          highlights: highlightsByBook.get(key) ?? []
        };
      });

      const bookKeysByGroup = new Map<string, string[]>();
      for (const raw of selectGroupBooks.all(userId) as Array<Record<string, unknown>>) {
        const groupId = String(raw.group_id);
        const list = bookKeysByGroup.get(groupId) ?? [];
        list.push(String(raw.book_key));
        bookKeysByGroup.set(groupId, list);
      }

      const groups: Group[] = (selectGroups.all(userId) as Array<Record<string, unknown>>).map((raw) => {
        const id = String(raw.id);
        return {
          id,
          type: (raw.type === "series" ? "series" : "collection") as GroupType,
          name: textOrNull(raw.name) ?? "",
          style: raw.style === null ? null : parseJson(raw.style, null),
          bookKeys: bookKeysByGroup.get(id) ?? [],
          createdAt: textOrNull(raw.created_at) ?? settings.updatedAt,
          updatedAt: textOrNull(raw.updated_at) ?? settings.updatedAt
        };
      });

      const blocksByMural = new Map<string, MuralBlock[]>();
      for (const raw of selectMuralBlocks.all(userId) as Array<Record<string, unknown>>) {
        const muralId = String(raw.mural_id);
        const list = blocksByMural.get(muralId) ?? [];
        list.push({
          id: String(raw.id),
          type: textOrNull(raw.type) ?? "empty",
          layout: {
            x: intOrNull(raw.x) ?? 0,
            y: intOrNull(raw.y) ?? 0,
            w: intOrNull(raw.w) ?? 1,
            h: intOrNull(raw.h) ?? 1
          },
          data: parseJson(raw.data, {}) as Record<string, unknown>
        });
        blocksByMural.set(muralId, list);
      }

      const murals: Mural[] = (selectMurals.all(userId) as Array<Record<string, unknown>>).map((raw) => {
        const id = String(raw.id);
        return {
          id,
          name: textOrNull(raw.name) ?? "",
          blocks: blocksByMural.get(id) ?? [],
          coverImageId: textOrNull(raw.cover_image_id),
          coverImageUrl: textOrNull(raw.cover_image_url),
          createdAt: textOrNull(raw.created_at) ?? settings.updatedAt,
          updatedAt: textOrNull(raw.updated_at) ?? settings.updatedAt
        };
      });

      return { settings, books, groups, murals };
    },

    getVersion(userId) {
      const row = selectVersion.get(userId) as Record<string, unknown> | undefined;
      return row ? (intOrNull(row.version) ?? 1) : undefined;
    },

    replaceContents(userId, contents) {
      // One transaction: a library half-written because the process died
      // mid-loop would be worse than the blob this replaces.
      db.exec("BEGIN IMMEDIATE");
      try {
        deleteAllBooks.run(userId);
        deleteAllHighlights.run(userId);
        // groups/murals cascade to their children via ON DELETE CASCADE
        // (foreign_keys pragma is enabled in connection.ts).
        deleteAllGroups.run(userId);
        deleteAllMurals.run(userId);

        writeSettings(userId, contents.settings);
        for (const book of contents.books) writeBook(userId, book, contents.settings.updatedAt);
        contents.groups.forEach((group, index) => writeGroup(userId, group, index));
        contents.murals.forEach((mural, index) => writeMural(userId, mural, index));

        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return contents;
    },

    upsertBook(userId, book) {
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        writeBook(userId, book, now);
        bumpVersionStmt.run(now, userId);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    deleteBook(userId, bookKey) {
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        deleteBookHighlightsStmt.run(userId, bookKey);
        deleteBookStmt.run(userId, bookKey);
        bumpVersionStmt.run(now, userId);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    upsertGroup(userId, group) {
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = db.prepare(`SELECT position FROM groups WHERE user_id = ? AND id = ?`).get(userId, group.id) as
          | Record<string, unknown>
          | undefined;
        const next = db.prepare(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM groups WHERE user_id = ?`).get(userId) as
          | Record<string, unknown>
          | undefined;
        const position = existing ? (intOrNull(existing.position) ?? 0) : (intOrNull(next?.p) ?? 0);
        writeGroup(userId, group, position);
        bumpVersionStmt.run(now, userId);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    deleteGroup(userId, groupId) {
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        deleteGroupStmt.run(userId, groupId);
        bumpVersionStmt.run(now, userId);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    upsertMural(userId, mural) {
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = db.prepare(`SELECT position FROM murals WHERE user_id = ? AND id = ?`).get(userId, mural.id) as
          | Record<string, unknown>
          | undefined;
        const next = db.prepare(`SELECT COALESCE(MAX(position) + 1, 0) AS p FROM murals WHERE user_id = ?`).get(userId) as
          | Record<string, unknown>
          | undefined;
        const position = existing ? (intOrNull(existing.position) ?? 0) : (intOrNull(next?.p) ?? 0);
        writeMural(userId, mural, position);
        bumpVersionStmt.run(now, userId);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    deleteMural(userId, muralId) {
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        deleteMuralStmt.run(userId, muralId);
        bumpVersionStmt.run(now, userId);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    saveMuralBlockLayout(userId, muralId, blockId, layout: BlockLayout) {
      // The whole point of the rework, in one statement: moving a block
      // touches one row, not the account's entire library.
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        updateBlockLayoutStmt.run({
          $x: layout.x,
          $y: layout.y,
          $w: layout.w,
          $h: layout.h,
          $id: blockId,
          $mural_id: muralId,
          $user_id: userId
        });
        touchMuralStmt.run(now, muralId, userId);
        bumpVersionStmt.run(now, userId);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
  };
}
