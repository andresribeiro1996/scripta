// Typed errors the murals domain can throw. Empty for now: this task is
// plain CRUD, and "not found or not owned" is signaled as a plain
// undefined/boolean return from service.ts instead (checked directly in
// routes.ts) — same convention as modules/gallery/service.ts's
// deleteImage/getImageFile and modules/library/routes.ts's `if (!library)`
// check, not a thrown error. Reserved for Task 4, which adds real
// share-token business rules (e.g. sharing an already-shared mural) that
// belong here, the same way modules/auth/domain/errors.ts and
// modules/gallery/domain/errors.ts hold theirs.
