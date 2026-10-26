# Series rows for the search hard examples (2026-10-26)

PR #374's ranking puts a matched series' members first. Two of its hard examples failed in production because the data was missing or wrong, not because of the ranking:

- **"harry potter":** production has no `work_series` row named "Harry Potter" from any source. Without one, nothing leads.
  - This file adds Rowling's seven novels at positions 1–7 (Wikidata Q8337's order).
  - The rows go on their canonical works: Pedra Filosofal (OL82563W), Câmara dos Segredos (OL82537W), Prisioneiro de Azkaban (OL82536W), Cálice de Fogo (`1939b932…`), Ordem da Fénix (OL82548W), Príncipe Misterioso (OL82565W) and Talismãs da Morte (OL82586W).
- **"dune":** the Wikidata row puts *Dune Messiah* (OL893461W) at position 1, tied with *Dune*. This file replaces that row with position 2.

Simulated read-only in production on 2026-10-26 with these rows and the Wikidata sitelink counts, "harry potter" lists the seven novels 1–7, then the other "Harry Potter" titles. "dune" lists Herbert's six novels in order.

## Run

After PR #374 deploys, outside any import, run from the Mac:

```bash
railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "cd /app/backend && node scripts/undo-series-merges.mjs --undo ../docs/repairs/2026-10-26-series-rows.json"
```

Expected: `undone: []`, `failures: []`, `dropped: 1`, `added: 8`.
