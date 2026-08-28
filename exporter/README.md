# kobo-export

Export a Kobo e-reader's library metadata and highlights/notes to a single JSON file.

No jailbreak, no Calibre, no third-party dependencies — it's a stdlib-only Python script that reads directly from the device's own `KoboReader.sqlite` database, which is sitting in plain sight on the Kobo's USB storage once you plug it into a computer.

## Usage

1. Plug your Kobo into your computer via USB. It'll show up as a normal removable drive (e.g. `E:\` on Windows).
2. Run:

```bash
python export.py --drive E:\ --out library.json
```

Or, if you've copied the database file off the device already:

```bash
python export.py --db "C:\path\to\KoboReader.sqlite" --out library.json
```

That's it — `library.json` will contain your book metadata (title, author, series, ISBN, reading progress, rating, etc.) with each book's highlights and notes nested under it.

## Output shape

```json
{
  "source": "kobo-export",
  "schema_version": 1,
  "book_count": 42,
  "books": [
    {
      "ContentID": "...",
      "Title": "...",
      "Attribution": "Author Name",
      "Series": "...",
      "SeriesNumber": "1",
      "ISBN": "...",
      "___PercentRead": 63,
      "ReadStatus": 1,
      "DateLastRead": "2026-08-01T12:00:00Z",
      "Rating": 4,
      "ImageId": "445d6933-ac83-46c6-bb76-30802ceee152",
      "highlights": [
        {
          "BookmarkID": "...",
          "Text": "the highlighted passage",
          "Annotation": "your note, if any",
          "Type": "highlight",
          "DateCreated": "2026-07-15T09:30:00Z",
          "ChapterProgress": 0.42
        }
      ]
    }
  ]
}
```

Column names are kept as-is from Kobo's own database (`___PercentRead`, `Attribution` for author, etc.) rather than renamed, since the schema isn't officially documented and this keeps the mapping traceable back to source. A future cleanup pass could normalize these into friendlier field names once the viewer's needs are clearer.

## Notes / caveats

- **Read-only**: the script opens the database in read-only mode and never writes to it — your device's data is untouched.
- **Schema drift**: Kobo hasn't published this schema; it's been reverse-engineered by the community and has changed slightly across firmware versions. The script checks which columns actually exist before querying, so it degrades gracefully (missing fields just won't appear) rather than crashing on an unfamiliar firmware version.
- **DRM-purchased book *files*** are intentionally out of scope — this only exports metadata and your own annotations, not book content, so there's no DRM concern here.
- Close the Kobo companion app (if you have one open) before exporting, to avoid file-lock issues on some OSes.
- **`ImageId`** is Kobo's own cover-lookup key (`https://cdn.kobo.com/book-images/{ImageId}/...`) — the [viewer](../viewer/README.md) uses it to fetch real cover art. Sideloaded (non-store) books get a mangled file path in this field instead of a real ID, which the viewer detects and skips.
- **Store catalog cache, not just your books**: Nickel (Kobo's software) caches store/recommendation browsing into the same `content` table as your actual books — hundreds of titles you've merely *seen* in the store, not owned or downloaded. Those rows have `IsDownloaded='false'` and `___FileSize=0`. The export filters on both (`IsDownloaded='true' AND ___FileSize > 0`, where those columns exist) to count only books actually present on the device — without it, a library of a few dozen real books can report several hundred.

## Next steps

- ~~A viewer app/site that loads `library.json` and renders it~~ — built, see [viewer/](../viewer/README.md).
- Optional: wrap this same export logic in a Calibre plugin or a small GUI, once the CLI is proven out.
