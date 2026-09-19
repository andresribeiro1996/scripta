import type { CommunityAuthor } from "@scripta/shared/community";

export function AuthorAvatar({ author, size = 20 }: { author: CommunityAuthor; size?: number }) {
  if (author.avatarUrl) {
    return <img src={author.avatarUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) text-[10px] font-bold text-(--color-accent)"
      style={{ width: size, height: size }}
    >
      {author.username.slice(0, 1).toUpperCase()}
    </span>
  );
}
