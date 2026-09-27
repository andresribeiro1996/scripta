import { READER_PLATES, renderGlyph, type IdentityKey } from "@scripta/shared";

export function ReaderGlyph({ identity }: { identity?: IdentityKey }) {
  if (!identity) return null;
  const name = READER_PLATES.find((plate) => plate.key === identity)!.name;
  return (
    <span role="img" aria-label={`the ${name}`} className="inline-flex h-6 w-6 shrink-0 align-middle">
      <span className="contents dark:hidden" dangerouslySetInnerHTML={{ __html: renderGlyph(identity, 24, "paper") }} />
      <span className="hidden dark:contents" dangerouslySetInnerHTML={{ __html: renderGlyph(identity, 24, "reversed") }} />
    </span>
  );
}
