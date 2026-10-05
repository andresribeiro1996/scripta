# Vocabulary

Use these terms exactly. "Component", "service", "API" and "boundary" mean other things in this repo (React components, backend `service.ts` files, HTTP routes).

- **Module**: anything with an interface and an implementation — a function, a file, a backend module, `@scripta/shared`.
- **Interface**: everything a caller must know to use the module: types, but also invariants, ordering, error modes, required config.
- **Implementation**: the code inside.
- **Depth**: behaviour a caller or test gets per unit of interface it must learn. **Deep**: lots behind a small interface. **Shallow**: interface nearly as big as the implementation.
- **Seam**: where a module's interface lives — the place behaviour can change without editing the callers.
- **Adapter**: a concrete thing that fills a seam, like `adapters/sqlite/` behind a backend module's repository.
- **Leverage**: what callers get from depth — one implementation pays back across every call site and test.
- **Locality**: what maintainers get — change, bugs and verification concentrate in one place.

## Principles

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If it reappears across callers, it earns its keep.
- **The interface is the test surface.** If a test has to reach past the interface, the module is the wrong shape.
- **One adapter is a hypothetical seam; two is a real one.** Add a seam only when something actually varies across it — production and test count.
- **Replace, don't layer.** When a module is deepened, tests move to its new interface and the old tests on the shallow pieces are deleted.

## Dependencies decide the testing

Classify what the deepened module depends on:

1. **In-process** (pure logic, in-memory state): merge and test through the new interface. Most of `@scripta/shared` is here.
2. **Local stand-in** (SQLite on a temp file, a fixture data dir): test with the stand-in; no port needed.
3. **External** (OAuth providers, cover sources, R2): inject a port; tests pass a fake adapter.

## Design it twice

When the interface shape is open, write the constraints and dependency category for the user, then dispatch three `Plan` agents in parallel, each with the same brief (files, callers, dependencies, this vocabulary) and a different constraint:

1. Smallest interface: one to three entry points.
2. Make the most common caller trivial.
3. Ports and adapters for every external dependency.

Each returns the interface (types plus invariants and error modes), a caller example, what hides behind the seam, and trade-offs. Present them, compare on depth, locality and seam placement, and recommend one, or a hybrid.
