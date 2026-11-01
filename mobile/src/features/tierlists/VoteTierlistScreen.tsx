import { RankingMethodSelector } from "./RankingMethodSelector";
import { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ballotBoard, blankBoard, characterBooks, toPlacements, type AggregationMode, type TierlistData } from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { useAuth } from "../../core/auth";
import { ApiError } from "../../core/api";
import { isPermanentError } from "../../core/apiClient";
import { Button, EmptyState, ErrorState, Fab, IconButton, Screen, Sheet, Skeleton, SwipeableTabs, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import { AddBookSheet } from "../community/AddBookSheet";
import { fetchBallot, fetchMyBallot, fetchVotingBoard, submitBallot, type BallotResponse } from "./api";
import type { PublicBookData } from "@scripta/shared";
import { TierBoard, TierHead } from "./TierBoard";
import { workOf, type TierBook } from "./tierBook";
import { TierlistResults } from "./TierlistResults";
import { TierSortDeck } from "./TierSortDeck";
import { moveBookTo, samePlacements, votingBooks } from "./tierBoardData";
import { TierlistShareImage } from "./TierlistShareImage";
import { shareableCommunityResults } from "./tierlistShareData";
import { CharacterHeader } from "../characters/CharacterHeader";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import { publicContentUrl } from "../sharing/links";
import { useT } from "../../i18n";

function storageKey(code: string) { return `tierlist-ballot:${code}`; }

export function VoteTierlistScreen({ code, startInRank = false }: { code: string; startInRank?: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  const { ready, user } = useAuth();
  const queryClient = useQueryClient();
  const [storedId, setStoredId] = useState<string | null | undefined>(undefined);
  const [ballot, setBallot] = useState<BallotResponse | null>(null);
  const [working, setWorking] = useState<TierlistData | null>(null);
  const [view, setView] = useState<"rank" | "board" | "community">(startInRank ? "rank" : "board");
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [editing, setEditing] = useState(startInRank);
  const [ballotLoading, setBallotLoading] = useState(true);
  const [ballotError, setBallotError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booksOpen, setBooksOpen] = useState(false);
  const [addBook, setAddBook] = useState<PublicBookData | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkAttempt, setLinkAttempt] = useState(0);
  const [imageReady, setImageReady] = useState(false);
  const [shareView, setShareView] = useState<"board" | "community">("board");
  const [resultMode, setResultMode] = useState<AggregationMode>("average");
  const boardQuery = useQuery({ queryKey: ["tierlists", "voting", code], queryFn: () => fetchVotingBoard(code), enabled: Boolean(code), retry: false });
  const votingBoard = boardQuery.data?.board;
  const subject = boardQuery.data?.board.subject ?? null;
  const books: TierBook[] = useMemo(() => subject ? characterBooks(subject) : votingBooks(boardQuery.data?.books ?? []), [subject, boardQuery.data?.books]);
  useEffect(() => {
    if (!sharing) return;
    let active = true;
    void publicContentUrl(`/vote/${code}`).then((url) => { if (active) { setShareUrl(url); setLinkError(null); } }).catch((reason) => { if (active) setLinkError(reason instanceof Error ? reason.message : t("sharing.publicLinkFailed")); });
    return () => { active = false; };
  }, [sharing, code, linkAttempt]);
  useEffect(() => {
    if (view === "rank" && votingBoard && (!votingBoard.votingOpen || votingBoard.promotedAt || votingBoard.access === "members" && !user)) setView("board");
  }, [view, votingBoard, user]);

  useEffect(() => { void AsyncStorage.getItem(storageKey(code)).then(setStoredId).catch(() => setStoredId(null)); }, [code]);
  // A signed-in voter's ballot is keyed to their account, so it comes back
  // on this device even on a fresh install where nothing was ever stored —
  // and it's the only way a poll's owner reaches theirs, since openVoting
  // seeded it server-side.
  useEffect(() => {
    if (!ready || storedId === undefined) return;
    if (!user && !storedId) { setBallotLoading(false); return; }
    setBallotLoading(true);
    const request = user ? fetchMyBallot(code) : fetchBallot(code, storedId!);
    void request.then((found) => { setBallot(found); setBallotError(null); }).catch((reason) => {
      if (reason instanceof ApiError && reason.status === 404) {
        setBallot(null);
        setBallotError(null);
        if (!user) { void AsyncStorage.removeItem(storageKey(code)); setStoredId(null); }
      }
      else setBallotError(reason instanceof Error ? reason.message : t("tierlists.loadVotesFailed"));
    }).finally(() => setBallotLoading(false));
  }, [code, ready, storedId, user]);

  if (!ready || storedId === undefined || boardQuery.isPending || ballotLoading) return <Screen bottom style={styles.screen}><Skeleton height={180} /></Screen>;
  if (boardQuery.isError || !boardQuery.data) return <Screen bottom style={styles.screen}><ErrorState title={t("tierlists.noTierlistAtLink")} body={t("tierlists.checkVotingCode")} actionLabel={isPermanentError(boardQuery.error) ? t("shell.notFoundAction") : t("shell.retry")} onAction={isPermanentError(boardQuery.error) ? () => router.replace("/") : () => void boardQuery.refetch()} /></Screen>;
  if (ballotError) return <Screen bottom style={styles.screen}><ErrorState title={t("tierlists.votesUnavailable")} body={ballotError} actionLabel={t("shell.retry")} onAction={() => { setBallotError(null); setBallotLoading(true); if (user) void fetchMyBallot(code).then(setBallot).catch((reason) => setBallotError(String(reason))).finally(() => setBallotLoading(false)); else if (storedId) void fetchBallot(code, storedId).then(setBallot).catch((reason) => setBallotError(String(reason))).finally(() => setBallotLoading(false)); }} /></Screen>;
  const { board } = boardQuery.data;
  const allWorks = new Set(books.flatMap((book) => { const id = workOf(book); return id ? [id] : []; }));
  const cleanBoard = { ...board, pool: board.pool.filter((id) => allWorks.has(id)) };
  const data = working ?? (ballot ? ballotBoard(cleanBoard, ballot.placements) : blankBoard(cleanBoard));
  const blocked = board.access === "members" && !user;
  const canEdit = board.votingOpen && !board.promotedAt && !blocked && (!ballot || editing);
  const showRank = view === "rank" && canEdit && (data.pool.length > 0 || selectedWorkId !== null);
  const placements = toPlacements(data);
  const dirty = !samePlacements(placements, ballot?.placements ?? []);
  const changeData = setWorking;
  const histogram = board.histogram ?? ballot?.results.histogram ?? (board.ballotCount === 0 ? [] : null);
  const hasCommunity = shareableCommunityResults(histogram, board.ballotCount);
  const hasMyBoard = placements.length > 0;
  const showShare = () => { setShareUrl(null); setLinkError(null); setImageReady(false); setShareView(view === "community" && hasCommunity ? "community" : hasMyBoard ? "board" : "community"); setSharing(true); };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await submitBallot(code, placements, ballot?.ballotId ?? null);
      setStoredId(response.ballotId);
      setBallot(response);
      setWorking(null);
      setEditing(false);
      setView("board");
      try { await AsyncStorage.setItem(storageKey(code), response.ballotId); }
      catch { setError(t("tierlists.editLinkSaveFailed")); }
      await queryClient.invalidateQueries({ queryKey: ["tierlists"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("tierlists.submitFailed"));
    } finally {
      setBusy(false);
    }
  }

  function openAddBook(book: PublicBookData) {
    setBooksOpen(false);
    setAddBook(book);
  }

  return <Screen bottom top={false} style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: board.name, headerRight: () => <IconButton accessibilityLabel={t("tierlists.shareTierlist")} name="share" onPress={showShare} /> }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <SwipeableTabs accessibilityLabel={t("tierlists.tierlistView")} options={[{ value: "board", label: t("tierlists.myBoard") }, { value: "community", label: t("tierlists.community") }]} value={view === "community" ? "community" : "board"} onChange={setView} renderPage={(page, active) => {
      if (page !== "community") return <View style={styles.page}>
        {subject ? <CharacterHeader subject={subject} /> : null}
        {board.ranksWorstFirst ? <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("tierlists.worstFirst")}</Text> : null}
        <TierHead>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("tierlists.statusLine", { status: t(board.promotedAt ? "tierlists.statusPermanent" : board.votingOpen ? "tierlists.votingOpen" : "tierlists.votingClosed"), state: t(ballot ? dirty ? "tierlists.stateUnsaved" : "tierlists.stateSubmitted" : "tierlists.stateNotSubmitted") })}</Text>
        {showRank ? <Pressable accessibilityRole="button" accessibilityLabel={t("tierlists.backToBoard")} onPress={() => { setSelectedWorkId(null); setView("board"); }}><Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{t("tierlists.boardLink")}</Text></Pressable> : <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("tierlists.rankedOf", { ranked: placements.length, total: cleanBoard.pool.length })}</Text>}
        </TierHead>
        {showRank ? <TierSortDeck data={data} books={books} selectedWorkId={selectedWorkId} onAssign={(workId, tierId) => { changeData(moveBookTo(data, workId, tierId)); if (selectedWorkId || (data.pool.length === 1 && data.pool.includes(workId))) { setSelectedWorkId(null); setView("board"); } }} /> : <TierBoard data={data} books={books} onChange={canEdit ? changeData : () => {}} structureEditable={false} poolLabel={t("tierlists.unranked")} bottomClearance={76} onReassign={canEdit ? (workId) => { setSelectedWorkId(workId); setView("rank"); } : undefined} />}
        {blocked && board.votingOpen ? <Button label={t("tierlists.signInToVote")} onPress={() => router.push({ pathname: "/(public)/login", params: { returnTo: `/vote/${code}` } } as never)} /> : null}
        {canEdit && (data.pool.length === 0 || placements.length > 0) ? <View style={[styles.complete, view === "board" && data.pool.length > 0 ? styles.fabClearance : null]}>{data.pool.length === 0 ? <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{t(subject ? "tierlists.allCharactersRanked" : "tierlists.allBooksRanked")}</Text> : null}<Button label={t(ballot ? "tierlists.updateVotes" : "tierlists.submitVotes")} loading={busy} disabled={!dirty || !placements.length} onPress={() => void submit()} /></View> : null}
      </View>;
      if (!histogram) return <EmptyState title={t("tierlists.noResultsYet")} body={t("tierlists.liveResultsHidden")} />;
      return <View style={styles.community}>
        {subject ? <CharacterHeader subject={subject} /> : null}
        {board.ranksWorstFirst ? <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("tierlists.worstFirst")}</Text> : null}
        <TierlistResults histogram={histogram} tiers={board.tiers} pool={cleanBoard.pool} books={books} ballotCount={board.ballotCount} eligibleVoteCount={board.eligibleVoteCount} votingOpen={board.votingOpen} promoted={Boolean(board.promotedAt)} ownPlacements={ballot?.placements ?? []} active={active} mode={resultMode} onModeChange={setResultMode} />
      </View>;
    }} />
    {board.votingOpen && !board.promotedAt && !blocked && view === "board" && (ballot && !editing || canEdit && data.pool.length > 0) ? <Fab icon="tierlist" label={ballot && !editing ? data.pool.length ? t("tierlists.continueRanking") : t("tierlists.editVotes") : t("tierlists.rankLeft", { count: data.pool.length })} onPress={() => { if (ballot) setEditing(true); setView(data.pool.length ? "rank" : "board"); }} /> : null}
    <Sheet visible={booksOpen} title={t("book.books")} onClose={() => setBooksOpen(false)}>
      <FlatList
        data={boardQuery.data.books}
        keyExtractor={(book) => book.key}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <Pressable accessibilityLabel={t("arena.titleByAuthor", { title: item.title, author: item.author ?? "" })} onPress={() => openAddBook(item)} style={styles.bookRow}>
          <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{item.title}</Text>
          <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.author ?? ""}</Text>
        </Pressable>}
      />
    </Sheet>
    {addBook ? <AddBookSheet book={{ title: addBook.title, author: addBook.author ?? "", isbn: addBook.isbn ?? null, coverUrl: addBook.coverUrl ?? null }} onClose={() => setAddBook(null)} /> : null}
    <ContentShareSheet visible={sharing} onClose={() => setSharing(false)} title={board.name} url={shareUrl} linkError={linkError} onRetryLink={() => setLinkAttempt((value) => value + 1)} imageReady={imageReady && (shareView === "community" ? hasCommunity : hasMyBoard)} previewControls={<>{hasCommunity && hasMyBoard ? <View style={styles.shareOptions}><Button label={t("tierlists.myRanking")} variant={shareView === "board" ? "primary" : "secondary"} onPress={() => { if (shareView !== "board") { setImageReady(false); setShareView("board"); } }} /><Button label={t("tierlists.community")} variant={shareView === "community" ? "primary" : "secondary"} onPress={() => { if (shareView !== "community") { setImageReady(false); setShareView("community"); } }} /></View> : undefined}{shareView === "community" ? <View style={{ flexDirection: "row" }}><RankingMethodSelector mode={resultMode} onChange={(next) => { if (next !== resultMode) { setImageReady(false); setResultMode(next); } }} /></View> : null}</>}>
      {hasCommunity || hasMyBoard ? <TierlistShareImage key={`${shareView}:${resultMode}`} title={board.name} subject={subject} data={shareView === "community" ? blankBoard(cleanBoard) : data} books={books} community={shareView === "community"} histogram={histogram ?? undefined} ballotCount={board.ballotCount} mode={resultMode} onReadyChange={setImageReady} /> : null}
    </ContentShareSheet>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  page: { flex: 1, gap: spacing.sm, paddingTop: spacing.lg },
  community: { flex: 1 },
  complete: { gap: spacing.sm },
  fabClearance: { paddingBottom: 72 },
  strong: { fontWeight: "700" },
  list: { flexGrow: 0 },
  listContent: { gap: spacing.md, paddingBottom: spacing.md },
  bookRow: { gap: spacing.xs },
  shareOptions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
});
