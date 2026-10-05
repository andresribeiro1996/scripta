---
name: improve-codebase-architecture
description: Survey Scripta for deepening opportunities — shallow modules, logic duplicated across clients, seams that leak — present them as an HTML report, then grill through the one the user picks. Use only when the user asks for an architecture review.
disable-model-invocation: true
---

# Improve codebase architecture

Find **deepening opportunities**: refactors that turn shallow modules into deep ones, so the code is easier to test and for an agent to navigate. Read [VOCABULARY.md](VOCABULARY.md) first and use its terms exactly in every candidate.

## 1. Explore

Scope before you scan. If the user named an area, take it. Otherwise find the hot spots — deepening pays off where code keeps changing:

```bash
git log --since=6.weeks --name-only --format= | rg -v '^$|\.md$|package(-lock)?\.json$' | sort | uniq -c | sort -rn | head -40
```

Read `docs/architecture.md` and the `README.md` of each package in scope. Then dispatch `Explore` (`model: "sonnet"`) over the hot spots with the questions below and the vocabulary. Ask it for `file:line` evidence, not opinions.

- **Duplication across clients**: the same rule implemented in `frontend/` and `mobile/` (or in a client and the backend) instead of once in `@scripta/shared`. This is the highest-leverage signal in this repo.
- **Shallow modules**: an interface nearly as complex as its implementation; pass-through wrappers; a concept that needs five small files to understand.
- **Leaking seams**: a backend module importing another module's internals instead of its `index.ts`; domain logic in `routes.ts` or a SQLite adapter instead of `domain/` or `service.ts`.
- **Untestable**: logic only reachable through a screen, a route or a device; pure functions extracted for tests while the bugs live in how they're called.

Apply the **deletion test** to each suspect. Keep only candidates where deleting the module would scatter complexity back over its callers, or where merging modules would concentrate it.

Check `docs/superpowers/specs/` and `docs/architecture-decisions.md` for decisions in the area. Surface a candidate that contradicts one only if the friction is real, and say so on its card.

## 2. Report

Write the report as described in [REPORT.md](REPORT.md). Don't propose interfaces yet. Ask: "Which of these do you want to explore?"

## 3. Grill the chosen candidate

Map the decisions as a tree — constraints, which callers move, what goes behind the seam, which tests survive — and work it in rounds. Each round asks every question whose prerequisites are settled, numbered, each with your recommended answer. Look up facts yourself (dispatch `Explore`); only decisions go to the user. Done when no branch is left assumed and the user agrees.

If the interface shape is open, use **design it twice** from [VOCABULARY.md](VOCABULARY.md).

If the user rejects the candidate for a reason a future review would need, offer to append it to `docs/architecture-decisions.md` (create it if missing): one heading per decision, two or three lines on what was rejected and why. Skip passing reasons like "not now".

Once agreed, the refactor follows the normal path: a spec in `docs/superpowers/specs/`, a plan, then `implementer` per task.
