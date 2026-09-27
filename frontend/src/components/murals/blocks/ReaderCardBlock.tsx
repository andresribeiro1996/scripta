import { useMemo } from "react";
import { READER_PLATES, readerCardLabel, readerCardPlateLine, renderPlate, type PublicReaderCard, type ReaderIdentity } from "@scripta/shared";

export function ReaderCardPlate({ card, own, readerName }: { card: PublicReaderCard; own: ReaderIdentity | null; readerName: string }) {
  const label = readerCardLabel(card);
  const unwrittenLine = readerCardPlateLine(own?.missing ?? null);
  const { paper, reversed } = useMemo(
    () => ({
      paper: renderPlate({ identity: card.identity, state: card.state, readerName, print: "paper", label, unwrittenLine }),
      reversed: renderPlate({ identity: card.identity, state: card.state, readerName, print: "reversed", label, unwrittenLine })
    }),
    [card, readerName, label, unwrittenLine]
  );
  return (
    <span className="mx-auto block aspect-[5/7] h-full max-w-full">
      <span className="block h-full w-full [&>svg]:h-full [&>svg]:w-full dark:hidden" dangerouslySetInnerHTML={{ __html: paper }} />
      <span className="hidden h-full w-full [&>svg]:h-full [&>svg]:w-full dark:block" dangerouslySetInnerHTML={{ __html: reversed }} />
    </span>
  );
}

export function ReaderCardDetail({ card, own }: { card: PublicReaderCard; own: ReaderIdentity | null }) {
  const plate = (key: string | null) => READER_PLATES.find((item) => item.key === key);
  return (
    <div className="space-y-2">
      {card.identity ? <p className="font-serif text-(--color-text-dim) italic">{plate(card.identity)?.epithet}</p> : null}
      {card.runnerUp ? <p>Leaning between the {plate(card.identity)?.name} and the {plate(card.runnerUp)?.name}</p> : null}
      {card.signal ? <p>{card.signal.label}</p> : null}
      {card.coverage.map((line) => <p key={line} className="text-sm text-(--color-text-dim)">{line}</p>)}
      {own?.leaders.length ? <ul className="text-sm">{own.leaders.map((leader) => <li key={leader.label}>{leader.label} ({leader.count})</li>)}</ul> : null}
      {own?.missing ? <p className="text-sm text-(--color-text-dim)">{own.missing}</p> : null}
    </div>
  );
}
