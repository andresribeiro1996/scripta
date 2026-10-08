import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SIGNATURE_NOTE_MAX, bookKey, bookPassages, isFinishedBook, noteSaver, searchPassages, type ChosenHighlight, type ChosenSignature, type Passage, type ReaderCardChosen, type ReaderCardStylePatch } from "@scripta/shared";
import { Button, Input, Sheet, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { BookPickerList } from "../library/components/BookPickerList";
import { Section } from "../library/components/StyleControls";
import { useDebouncedCallback } from "../library/lib/debounce";

export type SaveStyle = (patch: ReaderCardStylePatch) => Promise<boolean>;
type Book = Record<string, unknown>;

const NOTE_DELAY_MS = 600;

function NoteField({ signature, onChange, flushRef }: { signature: ChosenSignature; onChange: SaveStyle; flushRef: RefObject<() => void> }) {
  const [draft, setDraft] = useState(signature.note ?? "");
  const [save] = useState(() => noteSaver(signature, (failed, previous) => setDraft((current) => (current === failed ? (previous ?? "") : current))));
  const { schedule, flush } = useDebouncedCallback((value: string) => save(value, onChange), NOTE_DELAY_MS);
  useEffect(() => {
    flushRef.current = flush;
    return () => { flushRef.current = () => {}; };
  });
  return <Input label="Note" value={draft} maxLength={SIGNATURE_NOTE_MAX} hint={`${draft.length}/${SIGNATURE_NOTE_MAX}`} onChangeText={(value) => { setDraft(value); schedule(value); }} />;
}

export function SignatureChoice({ books, signature, chosen, onChange }: { books: Book[]; signature: ChosenSignature | null; chosen?: ReaderCardChosen["signature"]; onChange: SaveStyle }) {
  const { colors } = useTheme();
  const finished = useMemo(() => books.filter(isFinishedBook), [books]);
  const [picking, setPicking] = useState(false);
  const flushNote = useRef<() => void>(() => {});
  return (
    <Section title="Signature book">
      {signature && chosen ? <Text style={[typography.body, { color: colors.text }]}>{chosen.title} <Text style={{ color: colors.textDim }}>— {chosen.author}</Text></Text> : null}
      {signature && !chosen ? <Text style={[typography.body, { color: colors.textDim }]}>No longer in your library.</Text> : null}
      {!signature && finished.length === 0 ? <Text style={[typography.body, { color: colors.textDim }]}>Finish a book to choose your signature book.</Text> : null}
      <View style={styles.actions}>
        {finished.length > 0 ? <Button label={signature ? "Change" : "Choose"} variant="secondary" onPress={() => setPicking(true)} /> : null}
        {signature ? <Button label="Remove" variant="secondary" onPress={() => { flushNote.current(); void onChange({ signature: null }); }} /> : null}
      </View>
      {signature && chosen ? <NoteField key={signature.bookKey} signature={signature} onChange={onChange} flushRef={flushNote} /> : null}
      <Sheet visible={picking} title="Choose your signature book" onClose={() => setPicking(false)}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
          <BookPickerList
            books={finished}
            isSelected={(book) => bookKey(book) === signature?.bookKey}
            onSelect={(book) => {
              const key = bookKey(book);
              flushNote.current();
              setPicking(false);
              void onChange({ signature: { bookKey: key, note: key === signature?.bookKey ? signature.note : null } });
            }}
          />
        </ScrollView>
      </Sheet>
    </Section>
  );
}

export function HighlightChoice({ books, highlight, chosen, onChange }: { books: Book[]; highlight: ChosenHighlight | null; chosen?: ReaderCardChosen["highlight"]; onChange: SaveStyle }) {
  const { colors } = useTheme();
  const withPassages = useMemo(() => books.filter((book) => bookPassages(book).length > 0), [books]);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState<Book | null>(null);
  const matches = useMemo(() => searchPassages(books, query), [books, query]);
  const close = () => { setPicking(false); setBrowsing(null); setQuery(""); };
  const choose = (passage: Passage) => { close(); void onChange({ highlight: { bookKey: passage.bookKey, highlightId: passage.highlightId } }); };
  const list = (passages: Passage[]) => passages.map((passage) => (
    <Pressable key={`${passage.bookKey}:${passage.highlightId}`} accessibilityRole="button" onPress={() => choose(passage)} style={styles.passage}>
      <Text style={[typography.body, { color: colors.text }]}>“{passage.text}” <Text style={{ color: colors.textDim }}>— {passage.title}</Text></Text>
    </Pressable>
  ));
  return (
    <Section title="Highlight">
      {highlight && chosen ? <Text style={[typography.body, styles.quote, { color: colors.text }]}>“{chosen.text}” <Text style={{ color: colors.textDim }}>— {chosen.title}</Text></Text> : null}
      {highlight && !chosen ? <Text style={[typography.body, { color: colors.textDim }]}>No longer in your library.</Text> : null}
      {withPassages.length === 0 ? <Text style={[typography.body, { color: colors.textDim }]}>No Kobo highlights yet.</Text> : null}
      <View style={styles.actions}>
        {withPassages.length > 0 ? <Button label={highlight ? "Change" : "Choose"} variant="secondary" onPress={() => setPicking(true)} /> : null}
        {highlight ? <Button label="Remove" variant="secondary" onPress={() => void onChange({ highlight: null })} /> : null}
      </View>
      <Sheet visible={picking} title="Choose a highlight" onClose={close}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
          <Input label="Search your highlights" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
          {query.trim() ? (matches.length ? list(matches) : <Text style={[typography.body, { color: colors.textDim }]}>No highlights match.</Text>) : browsing ? (
            <>
              <Button label="Back to books" variant="secondary" onPress={() => setBrowsing(null)} />
              {list(bookPassages(browsing))}
            </>
          ) : (
            <BookPickerList books={withPassages} onSelect={setBrowsing} />
          )}
        </ScrollView>
      </Sheet>
    </Section>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm },
  sheet: { gap: spacing.sm, paddingBottom: spacing.xl },
  passage: { minHeight: minimumTouchTarget, justifyContent: "center", paddingVertical: spacing.xs },
  quote: { fontStyle: "italic" },
});
