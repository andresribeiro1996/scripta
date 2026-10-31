import { readerGlyphLabel, renderGlyph, type IdentityKey } from "@scripta/shared";
import { useLocale } from "../i18n";

export function ReaderGlyph({ identity }: { identity?: IdentityKey }) {
  const locale = useLocale();
  const label = readerGlyphLabel(identity, locale);
  if (!identity || !label) return null;
  return (
    <span role="img" aria-label={label} className="inline-flex h-6 w-6 shrink-0 align-middle">
      <span className="contents dark:hidden" dangerouslySetInnerHTML={{ __html: renderGlyph(identity, 24, "paper") }} />
      <span className="hidden dark:contents" dangerouslySetInnerHTML={{ __html: renderGlyph(identity, 24, "reversed") }} />
    </span>
  );
}
