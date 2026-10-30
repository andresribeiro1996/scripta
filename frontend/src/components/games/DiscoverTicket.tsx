import { Link } from "react-router-dom";
import type { DiscoverItem } from "@scripta/shared/community";
import { TIER_LADDER, contentStats, contentStatus, contentTarget, gameActionLabel } from "@scripta/shared/community";
import { AuthorAvatar } from "../CommunityAuthorAvatar";
import { ReaderGlyph } from "../ReaderGlyph";
import { GameTicket, StatusBadge } from "./GameTicket";

export function DiscoverTicket({ item }: { item: DiscoverItem }) {
  const { content, author } = item;
  const status = contentStatus(content);
  return (
    <li className={`flex ${content.kind === "quiz" ? "self-stretch" : ""}`}>
      <GameTicket
        kind={content.kind}
        name={content.name}
        to={contentTarget(content)}
        actionLabel={gameActionLabel(content)}
        covers={content.covers}
        ladder={content.kind === "tierlist" ? TIER_LADDER : undefined}
        preview={content.kind === "quiz" ? content.preview : undefined}
        stats={contentStats(content)}
        meta={
          <span className="flex min-w-0 items-center gap-2">
            <AuthorAvatar author={author} size={32} />
            {author.unavailable ? (
              <span className="min-w-0 truncate font-semibold">{author.username}</span>
            ) : (
              <Link to={`/community/u/${author.username}`} className="relative z-10 -my-3 block min-w-0 truncate leading-11 font-semibold hover:text-(--color-accent)">
                {author.username}
              </Link>
            )}
            <ReaderGlyph identity={author.readerGlyph} />
          </span>
        }
        badges={
          <>
            <StatusBadge label={status.label} tone={status.tone} />
            {status.votedBadge && <StatusBadge label="Voted" tone="info" />}
          </>
        }
      />
    </li>
  );
}
