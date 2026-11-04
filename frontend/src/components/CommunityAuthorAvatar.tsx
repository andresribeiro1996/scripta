import type { ReaderProfile } from "@scripta/shared";

export function AuthorAvatar({ author, size = 20 }: { author: ReaderProfile; size?: number }) {
  if (author.avatarUrl) {
    return <img src={author.avatarUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) font-bold text-(--color-accent)"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {author.username.slice(0, 1).toUpperCase()}
    </span>
  );
}
