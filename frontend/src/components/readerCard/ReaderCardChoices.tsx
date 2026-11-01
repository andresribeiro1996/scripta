import { useMemo, useState } from "react";
import { SIGNATURE_NOTE_MAX, bookKey, bookPassages, isFinishedBook, searchPassages, type ChosenHighlight, type ChosenSignature, type Passage, type ReaderCardChosen, type ReaderCardStylePatch } from "@scripta/shared";
import { BookSearchList } from "../murals/pickers";
import { SearchField } from "../Toolbar";
import { PANEL_HEADING } from "../page/surfaceClasses";
import { DraftField } from "./DraftField";
import { useLocale, useT } from "../../i18n";

export type SaveStyle = (patch: ReaderCardStylePatch) => Promise<boolean>;
type Book = Record<string, unknown>;

const LINK = "inline-flex min-h-11 items-center text-xs font-semibold text-(--color-accent)";
const DIM = "text-sm text-(--color-text-dim)";

function NoteField({ signature, onChange }: { signature: ChosenSignature; onChange: SaveStyle }) {
  const t = useT();
  return <DraftField label={t("readerCard.note")} initial={signature.note} max={SIGNATURE_NOTE_MAX} onSave={(note) => onChange({ signature: { bookKey: signature.bookKey, note } })} />;
}

export function SignatureChoice({ books, signature, chosen, onChange }: { books: Book[]; signature: ChosenSignature | null; chosen?: ReaderCardChosen["signature"]; onChange: SaveStyle }) {
  const t = useT();
  const finished = useMemo(() => books.filter(isFinishedBook), [books]);
  const [picking, setPicking] = useState(false);
  return (
    <section>
      <h3 className={`${PANEL_HEADING} mb-2`}>{t("readerCard.signatureBook")}</h3>
      {signature && chosen ? <p className="text-sm">{chosen.title} <span className="text-(--color-text-dim)">— {chosen.author}</span></p> : null}
      {signature && !chosen ? <p className={DIM}>{t("readerCard.noLongerInLibrary")}</p> : null}
      {!signature && finished.length === 0 ? <p className={DIM}>{t("readerCard.finishToChoose")}</p> : null}
      <div className="mt-2 flex gap-4">
        {finished.length > 0 ? <button type="button" className={LINK} onClick={() => setPicking((open) => !open)}>{picking ? t("shell.cancel") : signature ? t("addBook.change") : t("readerCard.choose")}</button> : null}
        {signature ? <button type="button" className={LINK} onClick={() => void onChange({ signature: null })}>{t("arena.remove")}</button> : null}
      </div>
      {picking ? (
        <div className="mt-2">
          <BookSearchList
            books={finished}
            isSelected={(book) => bookKey(book) === signature?.bookKey}
            onSelect={(book) => {
              const key = bookKey(book);
              setPicking(false);
              void onChange({ signature: { bookKey: key, note: key === signature?.bookKey ? signature.note : null } });
            }}
          />
        </div>
      ) : null}
      {signature && chosen ? <NoteField key={signature.bookKey} signature={signature} onChange={onChange} /> : null}
    </section>
  );
}

export function HighlightChoice({ books, highlight, chosen, onChange }: { books: Book[]; highlight: ChosenHighlight | null; chosen?: ReaderCardChosen["highlight"]; onChange: SaveStyle }) {
  const locale = useLocale();
  const t = useT();
  const withPassages = useMemo(() => books.filter((book) => bookPassages(book, locale).length > 0), [books, locale]);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState<Book | null>(null);
  const matches = useMemo(() => searchPassages(books, query, locale), [books, query, locale]);
  const close = () => { setPicking(false); setBrowsing(null); setQuery(""); };
  const choose = (passage: Passage) => { close(); void onChange({ highlight: { bookKey: passage.bookKey, highlightId: passage.highlightId } }); };
  const list = (passages: Passage[]) => (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-(--color-border)">
      {passages.map((passage) => (
        <button key={`${passage.bookKey}:${passage.highlightId}`} type="button" onClick={() => choose(passage)} className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-(--color-surface-hover)">
          “{passage.text}” <span className="text-(--color-text-dim)">— {passage.title}</span>
        </button>
      ))}
    </div>
  );
  return (
    <section>
      <h3 className={`${PANEL_HEADING} mb-2`}>{t("readerCard.highlight")}</h3>
      {highlight && chosen ? <p className="text-sm italic">{`“${chosen.text}”`} <span className="not-italic text-(--color-text-dim)">— {chosen.title}</span></p> : null}
      {highlight && !chosen ? <p className={DIM}>{t("readerCard.noLongerInLibrary")}</p> : null}
      {withPassages.length === 0 ? <p className={DIM}>{t("readerCard.noKoboHighlights")}</p> : null}
      <div className="mt-2 flex gap-4">
        {withPassages.length > 0 ? <button type="button" className={LINK} onClick={() => (picking ? close() : setPicking(true))}>{picking ? t("shell.cancel") : highlight ? t("addBook.change") : t("readerCard.choose")}</button> : null}
        {highlight ? <button type="button" className={LINK} onClick={() => void onChange({ highlight: null })}>{t("arena.remove")}</button> : null}
      </div>
      {picking ? (
        <div className="mt-2 space-y-2">
          <SearchField fill value={query} onChange={setQuery} placeholder={t("readerCard.searchHighlightsPlaceholder")} label={t("readerCard.searchHighlights")} />
          {query.trim() ? (matches.length ? list(matches) : <p className={DIM}>{t("readerCard.noHighlightsMatch")}</p>) : browsing ? (
            <>
              <button type="button" className={LINK} onClick={() => setBrowsing(null)}>{t("shell.backToBooks")}</button>
              {list(bookPassages(browsing, locale))}
            </>
          ) : (
            <BookSearchList books={withPassages} onSelect={setBrowsing} />
          )}
        </div>
      ) : null}
    </section>
  );
}
