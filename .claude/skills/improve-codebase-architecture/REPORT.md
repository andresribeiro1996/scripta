# Report

One self-contained HTML file, outside the repo: `${TMPDIR:-/tmp}/scripta-architecture-<YYYYMMDD-HHMM>.html`, or the session's scratchpad directory when it has one. Open it with `open <path>` on macOS and give the user the absolute path.

Load Tailwind from `https://cdn.tailwindcss.com` and Mermaid from `https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs`; no other scripts. Support light and dark (`prefers-color-scheme`).

## Header

Repo, date, and a legend: solid box = module, dashed line = seam, red arrow = leak, thick dark box = deep module. No intro paragraph.

## One card per candidate

- **Title** naming the deepening: "Move shelf ordering into `@scripta/shared`".
- **Badges**: strength — `Strong`, `Worth exploring` or `Speculative` — and dependency category from [VOCABULARY.md](VOCABULARY.md).
- **Files**: monospaced list with `file:line` evidence.
- **Before / after diagram**, side by side, about 320px tall. This carries the card; if it needs a paragraph to be understood, redraw it. Mermaid for call graphs and dependencies; hand-built divs or inline SVG for a mass diagram (interface box vs implementation box), stacked layers, or several modules collapsing into one.
- **Problem**: one sentence.
- **Solution**: one sentence.
- **Wins**: short bullets in vocabulary terms — "locality: one place to fix shelf order", "leverage: web and mobile share one implementation", "delete 3 pass-through wrappers".
- **Decision callout** when it contradicts a spec or `docs/architecture-decisions.md`.

Prose is sparse. Name domain things the way the code names them — shelf, mural, tier list, arena — not generic nouns.

## Top recommendation

Last section: the candidate to do first, one sentence why, a link to its card.
