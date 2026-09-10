# Mural home: postponed work

Status: deliberately outside the [first implementation](2026-09-09-mural-home.md), not committed follow-up scope.

| Item | Why postponed | Revisit when |
|---|---|---|
| Automatic recently finished / recently added / highest-rated shelves | Collection-linked and hand-picked shelves cover the first home; date semantics need care | Users repeatedly maintain these selections manually; extend Shelf with named sources rather than new block types |
| Shortcut card to another mural, collection, or Arena | Existing navigation plus actionable content covers the first version | Users need a specific destination embedded in their composition |
| Annual reading goal | Requires a target plus trustworthy completion dates; `DateLastRead` is not universally a completion timestamp | Completion provenance is defined and users ask to track a target |
| Expanded reading statistics | Current import fields vary in meaning and completeness | A specific metric can be computed honestly from available data |
| Reading streaks | Imports do not establish daily reading activity | Reliable reading-session events or explicit manual logging exists |
| Reading time and pace predictions | Progress snapshots do not establish duration or pace | Timestamped, trustworthy activity data exists and users want these estimates |
| Precise progress everywhere | Goodreads/StoryGraph currently generate placeholder percentages | Per-book provenance distinguishes measured progress from defaults; reuse genuine progress where already reliable |
| AI recommendations | Substantial new behavior, data/cost/privacy decisions; not needed for a useful personal home | Users demonstrate a discovery need that their own collections and simple selections do not meet |
| Social feed | Requires feed content, relationships, moderation, and privacy decisions | Social activity is an explicit product direction |
| Separate reading journal | Text blocks and collections cover lightweight reflection | Users need dated entries, retrieval, or other behavior that text blocks cannot provide |
| Automatic creation of all existing presets after import | Separate from creating a chosen home; risks unwanted clutter and overwriting edits | Explicitly requested; create each preset once and preserve all later user edits |
| Public rotating passages | Existing sharing deliberately redacts private highlight data | An explicit passage-sharing consent model is designed; do not relax redaction implicitly |

These items must not become hidden prerequisites or speculative infrastructure in the first version. Keep new content capabilities inside the existing mural system whenever they fit.
