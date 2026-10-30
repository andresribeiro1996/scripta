import { digestTarget, type DigestItem } from "@scripta/shared";

// Mobile's profile route is /u/<name>; the shared target is the web app's
// /community/u/<name>, so the two kinds that point at a person are remapped.
// A participation row's tier list or quiz is remapped too, from the web
// dashboard's /dashboard/arena/<kind>/<id> to its own native screen.
export function digestRoute(item: DigestItem): string {
  if (item.kind === "participation") return item.game.kind === "tournament" ? `/arena/${item.game.id}` : item.game.kind === "quiz" ? `/quiz/${item.game.id}?view=results` : `/${item.game.kind}/${item.game.id}`;
  if (item.kind === "reading") return item.book.workId ? `/work/${item.book.workId}` : `/u/${item.actor.username}`;
  if (item.kind === "follow") return `/u/${item.actor.username}`;
  if (item.kind === "mural") return `/u/${item.actor.username}`;
  return digestTarget(item);
}
