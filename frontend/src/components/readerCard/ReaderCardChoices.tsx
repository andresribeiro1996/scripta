import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SIGNATURE_NOTE_MAX, bookKey, bookPassages, isFinishedBook, noteToSend, searchPassages, type ChosenHighlight, type ChosenSignature, type Passage, type ReaderCardChosen, type ReaderCardStylePatch } from "@scripta/shared";
import { BookSearchList } from "../murals/pickers";

export type SaveStyle = (patch: ReaderCardStylePatch) => Promise<boolean>;
type Book = Record<string, unknown>;

const NOTE_DELAY_MS = 600;
const LINK = "text-xs font-semibold text-(--color-accent)";
const DIM = "text-sm text-(--color-text-dim)";

function NoteField({ signature, onChange }: { signature: ChosenSignature; onChange: SaveStyle }) {
  const [draft, setDraft] = useState(signature.note ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sent = useRef(signature.note);
  const pending = useRef<string | null>(null);
  const latest = useRef({ signature, onChange });
  useEffect(() => { latest.current = { signature, onChange }; });
  const save = useCallback((value: string) => {
    clearTimeout(timer.current);
    pending.current = null;
    const note = noteToSend(value, sent.current);
    if (note === undefined) return;
    const previous = sent.current;
    sent.current = note;
    void latest.current.onChange({ signature: { bookKey: latest.current.signature.bookKey, note } }).then((saved) => {
      if (saved) return;
      sent.current = previous;
      setDraft((current) => (current === value ? (previous ?? "") : current));
    });
  }, []);
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (pending.current !== null) save(pending.current);
  }, [save]);
  return (
    <label className="mt-3 block text-xs text-(--color-text-dim)">
      Note
      <input
        value={draft}
        maxLength={SIGNATURE_NOTE_MAX}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          clearTimeout(timer.current);
          pending.current = value;
          timer.current = setTimeout(() => save(value), NOTE_DELAY_MS);
        }}
        onBlur={() => save(draft)}
        className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text)"
      />
      <span className="mt-1 block text-right">{`${draft.length}/${SIGNATURE_NOTE_MAX}`}</span>
    </label>
  );
}

export function SignatureChoice({ books, signature, chosen, onChange }: { books: Book[]; signature: ChosenSignature | null; chosen?: ReaderCardChosen["signature"]; onChange: SaveStyle }) {
  const finished = useMemo(() => books.filter(isFinishedBook), [books]);
  const [picking, setPicking] = useState(false);
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Signature book</h3>
      {signature && chosen ? <p className="text-sm">{chosen.title} <span className="text-(--color-text-dim)">— {chosen.author}</span></p> : null}
      {signature && !chosen ? <p className={DIM}>No longer in your library.</p> : null}
      {!signature && finished.length === 0 ? <p className={DIM}>Finish a book to choose your signature book.</p> : null}
      <div className="mt-2 flex gap-4">
        {finished.length > 0 ? <button type="button" className={LINK} onClick={() => setPicking((open) => !open)}>{picking ? "Cancel" : signature ? "Change" : "Choose"}</button> : null}
        {signature ? <button type="button" className={LINK} onClick={() => void onChange({ signature: null })}>Remove</button> : null}
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
  const withPassages = useMemo(() => books.filter((book) => bookPassages(book).length > 0), [books]);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState<Book | null>(null);
  const matches = useMemo(() => searchPassages(books, query), [books, query]);
  const close = () => { setPicking(false); setBrowsing(null); setQuery(""); };
  const choose = (passage: Passage) => { close(); void onChange({ highlight: { bookKey: passage.bookKey, highlightId: passage.highlightId } }); };
  const list = (passages: Passage[]) => (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-(--color-border)">
      {passages.map((passage) => (
        <button key={`${passage.bookKey}:${passage.highlightId}`} type="button" onClick={() => choose(passage)} className="block w-full px-3 py-2 text-left text-sm hover:bg-(--color-surface-hover)">
          “{passage.text}” <span className="text-(--color-text-dim)">— {passage.title}</span>
        </button>
      ))}
    </div>
  );
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Highlight</h3>
      {highlight && chosen ? <p className="text-sm italic">{`“${chosen.text}”`} <span className="not-italic text-(--color-text-dim)">— {chosen.title}</span></p> : null}
      {highlight && !chosen ? <p className={DIM}>No longer in your library.</p> : null}
      {withPassages.length === 0 ? <p className={DIM}>No Kobo highlights yet.</p> : null}
      <div className="mt-2 flex gap-4">
        {withPassages.length > 0 ? <button type="button" className={LINK} onClick={() => (picking ? close() : setPicking(true))}>{picking ? "Cancel" : highlight ? "Change" : "Choose"}</button> : null}
        {highlight ? <button type="button" className={LINK} onClick={() => void onChange({ highlight: null })}>Remove</button> : null}
      </div>
      {picking ? (
        <div className="mt-2 space-y-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your highlights…" aria-label="Search your highlights" className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm" />
          {query.trim() ? (matches.length ? list(matches) : <p className={DIM}>No highlights match.</p>) : browsing ? (
            <>
              <button type="button" className={LINK} onClick={() => setBrowsing(null)}>Back to books</button>
              {list(bookPassages(browsing))}
            </>
          ) : (
            <BookSearchList books={withPassages} onSelect={setBrowsing} />
          )}
        </div>
      ) : null}
    </section>
  );
}
