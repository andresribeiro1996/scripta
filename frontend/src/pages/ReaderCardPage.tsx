import { useMemo, useState } from "react";
import { hasChosen, readerCardInputOf, saveFailureMessage, visitorView, type ReaderCardStylePatch } from "@scripta/shared";
import { themes } from "@scripta/shared/themes";
import { Page } from "../components/page/Page";
import { useAuth } from "../auth/AuthContext";
import { HighlightChoice, SignatureChoice } from "../components/readerCard/ReaderCardChoices";
import { ReaderCardOptions, Segmented } from "../components/readerCard/ReaderCardOptions";
import { ReaderCardTurner } from "../components/readerCard/ReaderCardTurner";
import { ReaderGlyphSetting } from "../components/readerCard/ReaderGlyphSetting";
import { SaveStatus, useSaveState } from "../components/SaveStatus";
import { useToast } from "../components/Toaster";
import { useLibrary } from "../hooks/useLibrary";
import { NO_GROUPS, useOwnCardStyle } from "../hooks/useReaderCard";
import { useReaderCardStyle, useSaveReaderCardStyle } from "../hooks/useReaderCardStyle";
import { useResolvedTheme } from "../lib/theme";

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
  const [saveState, track] = useSaveState();
  const scheme = themes[useResolvedTheme()].scheme;
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]>("you");
  const input = useMemo(() => readerCardInputOf(books, groups, readerName, undefined, own), [books, groups, readerName, own]);
  const preview = useMemo(() => (audience === "you" ? input : visitorView(input)), [audience, input]);

  const change = async (patch: ReaderCardStylePatch) => {
    try {
      await track(save(patch));
      return true;
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save your reader card."), kind: "error" });
      return false;
    }
  };

  if (!style) {
    if (isPending) return <Page title="Reader card"><p className="text-sm text-(--color-text-dim)">Loading your reader card…</p></Page>;
    return (
      <Page title="Reader card">
        <button type="button" onClick={() => void refetch()} className="text-sm font-semibold text-(--color-accent)">Couldn't load your reader card. Try again</button>
      </Page>
    );
  }

  return (
    <Page title="Reader card" subtitle={<SaveStatus state={saveState} />}>
      <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
        <div className="mb-6 flex flex-col items-center gap-3 lg:sticky lg:top-[calc(var(--app-top)+1.5rem)] lg:mb-0 lg:self-start">
          <div className="w-full max-w-[18rem]">
            <Segmented label="Preview as" options={AUDIENCES} labels={AUDIENCE_LABELS} value={audience} onChange={setAudience} />
          </div>
          <div className="w-full">
            <ReaderCardTurner key={`${preview.view}-${preview.style.layout}-${hasChosen(preview.card.chosen)}`} input={preview} cardWidth="w-[min(100%,18rem)]" />
          </div>
          {input.card.state === "unwritten" && input.missing ? <p className="text-sm text-(--color-text-dim)">{input.missing}</p> : null}
        </div>
        <div className="space-y-6">
          <ReaderCardOptions input={input} scheme={scheme} onChange={change} />
          <SignatureChoice books={books} signature={style.signature} chosen={input.card.chosen?.signature} onChange={change} />
          <HighlightChoice books={books} highlight={style.highlight} chosen={input.card.chosen?.highlight} onChange={change} />
          <ReaderGlyphSetting username={readerName} books={books} groups={groups} />
        </div>
      </div>
    </Page>
  );
}
