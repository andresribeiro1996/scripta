import { useMemo, useState } from "react";
import { hasChosen, readerCardInputOf, saveFailureMessage, visitorView, type ReaderCardStylePatch } from "@scripta/shared";
import { useAuth } from "../auth/AuthContext";
import { HighlightChoice, SignatureChoice } from "../components/readerCard/ReaderCardChoices";
import { ReaderCardOptions, Segmented } from "../components/readerCard/ReaderCardOptions";
import { ReaderCardTurner } from "../components/readerCard/ReaderCardTurner";
import { ReaderGlyphSetting } from "../components/readerCard/ReaderGlyphSetting";
import { useToast } from "../components/Toaster";
import { useLibrary } from "../hooks/useLibrary";
import { NO_GROUPS, useOwnCardStyle } from "../hooks/useReaderCard";
import { useReaderCardStyle, useSaveReaderCardStyle } from "../hooks/useReaderCardStyle";

const NO_BOOKS: Array<Record<string, unknown>> = [];
const AUDIENCES = ["you", "visitors"] as const;
const AUDIENCE_LABELS = { you: "You", visitors: "Visitors" };

export function ReaderCardPage() {
  const { session } = useAuth();
  const readerName = session?.user.username ?? "reader";
  const { data: library } = useLibrary();
  const books = library?.data.books ?? NO_BOOKS;
  const groups = library?.data.groups ?? NO_GROUPS;
  const { data: style, isPending, refetch } = useReaderCardStyle();
  const own = useOwnCardStyle();
  const save = useSaveReaderCardStyle();
  const toast = useToast();
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]>("you");
  const input = useMemo(() => readerCardInputOf(books, groups, readerName, undefined, own), [books, groups, readerName, own]);
  const preview = useMemo(() => (audience === "you" ? input : visitorView(input)), [audience, input]);

  const change = async (patch: ReaderCardStylePatch) => {
    try {
      await save(patch);
      return true;
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save your reader card."), kind: "error" });
      return false;
    }
  };

  if (!style) {
    if (isPending) return <p className="px-5 py-8 text-sm text-(--color-text-dim)">Loading your reader card…</p>;
    return (
      <div className="px-5 py-8">
        <button type="button" onClick={() => void refetch()} className="text-sm font-semibold text-(--color-accent)">Couldn't load your reader card. Try again</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-5 sm:py-8">
      <h2 className="mb-6 text-lg font-bold">Reader card</h2>
      <div className="lg:grid lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-8">
        <div className="mb-6 flex flex-col items-center gap-3 lg:sticky lg:top-6 lg:mb-0 lg:self-start">
          <div className="w-full max-w-[18rem]">
            <Segmented label="Preview as" options={AUDIENCES} labels={AUDIENCE_LABELS} value={audience} onChange={setAudience} />
          </div>
          <div className="w-full">
            <ReaderCardTurner key={`${preview.view}-${preview.style.layout}-${hasChosen(preview.card.chosen)}`} input={preview} cardWidth="w-[min(100%,18rem)]" spreadWidth="w-full" />
          </div>
          {input.card.state === "unwritten" && input.missing ? <p className="text-sm text-(--color-text-dim)">{input.missing}</p> : null}
        </div>
        <div className="space-y-6">
          <ReaderCardOptions input={input} onChange={(patch) => void change(patch)} />
          <SignatureChoice books={books} signature={style.signature} chosen={input.card.chosen?.signature} onChange={change} />
          <HighlightChoice books={books} highlight={style.highlight} chosen={input.card.chosen?.highlight} onChange={change} />
          <ReaderGlyphSetting username={readerName} books={books} groups={groups} />
        </div>
      </div>
    </div>
  );
}
