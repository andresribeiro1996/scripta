#!/usr/bin/env python3
"""
kobo-export: Export a Kobo e-reader's library metadata and highlights/notes
to a single JSON file.

Reads directly from the device's own KoboReader.sqlite database, which sits
on the Kobo's USB storage at ".kobo/KoboReader.sqlite" once it's plugged
into a computer. No jailbreak, Calibre, or extra dependencies required
(stdlib only).

Usage:
    # Point at the mounted Kobo drive (auto-locates .kobo/KoboReader.sqlite)
    python export.py --drive E:\\ --out library.json

    # Or point directly at a copy of the database file
    python export.py --db "C:\\path\\to\\KoboReader.sqlite" --out library.json

The schema below is reverse-engineered from the Kobo community (it isn't
officially documented by Kobo/Rakuten) and has drifted slightly across
firmware versions, so every column read is defensive: missing columns are
skipped rather than raising.
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path


# Columns we'd like from `content` (book-level rows), if present.
BOOK_COLUMNS = [
    "ContentID",
    "Title",
    "Attribution",       # author
    "Series",
    "SeriesNumber",
    "ISBN",
    "Publisher",
    "Language",
    "___PercentRead",    # reading progress, 0-100
    "ReadStatus",        # 0 unread, 1 reading, 2 finished
    "DateLastRead",
    "DateCreated",
    "Rating",
    "TimeSpentReading",  # seconds, on some firmwares
    "WordCount",
    "MimeType",
    "ImageId",           # cover lookup key on Kobo's own CDN (cdn.kobo.com); see viewer/README.md
]

# Columns we'd like from `Bookmark` (highlights/notes/bookmarks), if present.
BOOKMARK_COLUMNS = [
    "BookmarkID",
    "VolumeID",       # ContentID of the parent book
    "Text",           # the highlighted passage
    "Annotation",     # the user's note, if any
    "Type",           # 'highlight' or 'note' (varies by firmware)
    "DateCreated",
    "DateModified",
    "ChapterProgress",
]


def existing_columns(cursor, table, wanted):
    cursor.execute(f"PRAGMA table_info({table})")
    have = {row[1] for row in cursor.fetchall()}
    return [c for c in wanted if c in have]


def locate_database(drive: Path) -> Path:
    candidate = drive / ".kobo" / "KoboReader.sqlite"
    if candidate.exists():
        return candidate
    raise FileNotFoundError(
        f"Couldn't find .kobo/KoboReader.sqlite under {drive}. "
        "Make sure this is the path to the Kobo's mounted USB drive."
    )


def export(db_path: Path) -> dict:
    # Open read-only so we never risk touching the device's live database.
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    book_cols = existing_columns(cur, "content", BOOK_COLUMNS)
    bookmark_cols = existing_columns(cur, "Bookmark", BOOKMARK_COLUMNS)

    if not book_cols:
        raise RuntimeError("`content` table has none of the expected columns — unexpected schema.")

    # Top-level book rows: ContentType 6 identifies a book (as opposed to a
    # chapter/section, which is ContentType 9/899 with BookID pointing back
    # to the parent). BookID IS NULL is the belt-and-braces filter for that.
    #
    # ContentType 6 alone isn't enough, though: Kobo's Nickel software also
    # caches store/recommendation catalog entries into this same table for
    # offline browsing — books you've merely *seen*, not ones you own or
    # have on the device. Those show up with IsDownloaded='false' and
    # ___FileSize=0. Filtering on both (where the columns exist) is what
    # actually narrows this down to books present on the device — without
    # it, a device with a few dozen real books can report several hundred.
    filter_cols = existing_columns(cur, "content", ["IsDownloaded", "___FileSize"])
    extra_where = ""
    if "IsDownloaded" in filter_cols:
        extra_where += " AND IsDownloaded = 'true'"
    if "___FileSize" in filter_cols:
        extra_where += " AND ___FileSize > 0"

    cols_sql = ", ".join(book_cols)
    cur.execute(
        f"SELECT {cols_sql} FROM content "
        f"WHERE ContentType = '6' AND (BookID IS NULL OR BookID = ''){extra_where}"
    )
    books = [dict(row) for row in cur.fetchall()]

    highlights_by_volume = {}
    if bookmark_cols and "VolumeID" in bookmark_cols:
        cols_sql = ", ".join(bookmark_cols)
        cur.execute(f"SELECT {cols_sql} FROM Bookmark")
        for row in cur.fetchall():
            entry = dict(row)
            vol = entry.get("VolumeID")
            if not vol:
                continue
            highlights_by_volume.setdefault(vol, []).append(entry)

    conn.close()

    for book in books:
        book["highlights"] = highlights_by_volume.get(book.get("ContentID"), [])

    return {
        "source": "kobo-export",
        "schema_version": 1,
        "book_count": len(books),
        "books": books,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--drive", type=Path, help="Path to the mounted Kobo USB drive (e.g. E:\\)")
    src.add_argument("--db", type=Path, help="Direct path to a KoboReader.sqlite file")
    parser.add_argument("--out", type=Path, default=Path("library.json"), help="Output JSON path (default: library.json)")
    parser.add_argument("--compact", action="store_true", help="Write compact JSON instead of pretty-printed")
    args = parser.parse_args()

    try:
        db_path = locate_database(args.drive) if args.drive else args.db
        if not db_path.exists():
            print(f"Error: database file not found at {db_path}", file=sys.stderr)
            sys.exit(1)

        data = export(db_path)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    with open(args.out, "w", encoding="utf-8") as f:
        if args.compact:
            json.dump(data, f, ensure_ascii=False)
        else:
            json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Exported {data['book_count']} books to {args.out}")


if __name__ == "__main__":
    main()
