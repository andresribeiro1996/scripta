import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { AddBlockMenu } from "../components/murals/AddBlockMenu";
import { BlockConfigPanel } from "../components/murals/BlockConfigPanel";
import { BlockStylePanel } from "../components/murals/BlockStylePanel";
import { MuralCanvas } from "../components/murals/MuralCanvas";
import type { MobileMuralDraft } from "../components/murals/MobileMuralCanvas";
import { PageContainer } from "../components/PageContainer";
import { ShareModal } from "../components/ShareModal";
import { useToast } from "../components/Toaster";
import { FullscreenIcon, PencilIcon, ShareIcon, toolbarIconClass } from "../components/Toolbar";
import { useGalleryImages } from "../hooks/useGalleryImages";
import { useLibrary } from "../hooks/useLibrary";
import { useMuralFullscreen } from "../hooks/useMuralFullscreen";
import { useMurals } from "../hooks/useMurals";
import { useTierlists } from "../hooks/useTierlists";
import { type BlockStyle } from "../lib/libraryStyle";
import {
  addBlock,
  createBlockCandidate,
  createDuplicateCandidate,
  duplicateBlock,
  isValidBlockLayout,
  removeBlock,
  updateBlock,
  type BlockLayout,
  type BlockType,
  type Mural,
  type MuralBlock
} from "../lib/murals";

/** /dashboard/murals/:muralId — one mural's canvas (see
 *  components/murals/MuralCanvas.tsx for the actual freeform grid).
 *  View/Edit toggle, same pattern as the Library/Series/Collections
 *  pages' "Select…" mode toggle: View is the clean read-only render
 *  (what you'd actually show someone), Edit reveals drag handles, resize
 *  corners, and each block's configure/delete controls. */
export function MuralEditorPage() {
  const { muralId } = useParams<{ muralId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: library } = useLibrary();
  const { data: muralsData, isLoading, refetch, create, rename, saveBlocks, currentMural, share, unshare } = useMurals();
  const toast = useToast();
  const { images } = useGalleryImages();
  // Tier-list blocks reference Arena tier lists by id; the canvas resolves
  // them through this lookup (a plain find over the cached list — one
  // mural holds at most a handful of tier-list blocks, so a Map would be
  // ceremony).
  const { data: tierlists } = useTierlists();
  const tierlistData = (tierlistId: string) => {
    const tierlist = tierlists?.find((t) => t.id === tierlistId);
    return tierlist ? { name: tierlist.name, tiers: tierlist.data.tiers, pool: tierlist.data.pool } : undefined;
  };
  const books = library?.data.books ?? [];
  const murals = muralsData ?? [];
  // `/dashboard/murals/new` opens an UNSAVED mural. Clicking "New mural"
  // used to POST one immediately, so every idle tap left an "Untitled
  // mural" behind. Nothing is persisted now until the first real change
  // — a block added, or a name typed — at which point materialize()
  // creates it and swaps the URL for the real id.
  // "new" is a safe sentinel rather than a separate route: real ids are
  // UUIDs (the murals service uses randomUUID), so no mural can ever be
  // called "new" and shadow this. The existing `:muralId` route matches
  // it unchanged.
  const isDraft = muralId === "new";
  const mural = isDraft ? undefined : murals.find((m) => m.id === muralId);
  // Which folder the draft belongs to, carried from the list page so a
  // mural created from inside a folder lands in it.
  const draftFolderId = searchParams.get("folder");
  const [draftName, setDraftName] = useState("Untitled mural");
  // Guards against a double-create: two quick actions on a draft (add a
  // block, then another before the first resolves) would otherwise each
  // see `mural` still undefined and POST their own mural. A ref, not
  // state, because it must be true for the SECOND call synchronously,
  // before any re-render.
  const creatingRef = useRef(false);

  /** The mural to act on, creating it first if this is still a draft.
   *  Every mutation below goes through this rather than touching
   *  `mural` directly, so there is exactly one place that turns a draft
   *  into a real mural and no handler can forget to. */
  async function materialize(): Promise<Mural | null> {
    if (mural) return mural;
    if (!isDraft || creatingRef.current) return null;
    creatingRef.current = true;
    try {
      const created = await create(draftName.trim() || "Untitled mural", draftFolderId);
      // `replace` so Back skips the draft URL — returning to it would
      // open a second empty draft, not the mural just created.
      navigate(`/dashboard/murals/${created.id}`, { replace: true });
      return created;
    } finally {
      creatingRef.current = false;
    }
  }

  const [editMode, setEditMode] = useState(false);
  // While editing, the canvas IS the page — tell the layout to drop the
  // phone bottom nav (DashboardLayout's navHidden). Restored on leaving
  // edit mode and on unmount, so a mid-edit navigation can't strand the
  // app without a nav.
  const { setNavHidden } = useOutletContext<{ setNavHidden: (hidden: boolean) => void }>();
  useEffect(() => {
    setNavHidden(editMode);
    return () => setNavHidden(false);
  }, [editMode, setNavHidden]);
  const [configuringBlockId, setConfiguringBlockId] = useState<string | null>(null);
  const [stylingBlockId, setStylingBlockId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [sharing, setSharing] = useState(false);
  const { ref: fullscreenRef, fullscreen, enterFullscreen, exitFullscreen } = useMuralFullscreen();
  // Bumped only when a save fails; see guard() below for why a
  // remount is what puts a block back where it was.
  const [revertNonce, setRevertNonce] = useState(0);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [mobileDraft, setMobileDraft] = useState<MobileMuralDraft | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const savingDraftRef = useRef(false);
  const editVersionRef = useRef(0);
  const [compactMode, setCompactMode] = useState(
    () => typeof window !== "undefined" && (window.innerWidth < 768 || Boolean(window.matchMedia?.("(pointer: coarse)").matches))
  );

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const measure = () => setCompactMode(window.innerWidth < 768 || coarse.matches);
    window.addEventListener("resize", measure);
    coarse.addEventListener("change", measure);
    return () => {
      window.removeEventListener("resize", measure);
      coarse.removeEventListener("change", measure);
    };
  }, []);

  function toggleEditMode() {
    if (editMode) {
      setSelectedBlockId(null);
      setMobileDraft(null);
    }
    setEditMode(!editMode);
  }

  async function handleRename() {
    const name = nameDraft.trim();
    setEditingName(false);
    if (!name) return;
    if (isDraft) {
      // Naming a draft is itself the first real change, so it creates
      // the mural WITH that name rather than creating an "Untitled" one
      // and immediately renaming it.
      setDraftName(name);
      const created = await create(name, draftFolderId);
      navigate(`/dashboard/murals/${created.id}`, { replace: true });
      return;
    }
    if (!mural) return;
    await rename(mural.id, name);
  }

  // Every mutation on this page PUTs the whole block list, and every
  // call site fired one with `void handleX()` — so a failed save (LAN
  // drop, offline, a 500) rejected into nothing: no message, and a
  // canvas still showing the change that didn't happen.
  //
  // It really does keep showing it. MuralCanvas gives react-grid-layout
  // a controlled `layout` prop, but RGL's getDerivedStateFromProps only
  // rebases its internal layout when that prop DIFFERS from the last one
  // it saw. After a failed save the prop is rebuilt from an unchanged
  // mural, so it's deep-equal and RGL keeps the position you dropped the
  // block at. Refetching can't dislodge it either, for the same reason —
  // remounting the grid is what actually reverts it, hence revertNonce.
  //
  // Unconditional on failure rather than only for layout saves: after
  // ANY failed mutation the canvas should be showing the cache, and a
  // remount is cheap on a path that already went wrong.
  async function guard<T>(work: Promise<T>, message: string): Promise<T | undefined> {
    try {
      return await work;
    } catch {
      toast({ kind: "error", message });
      // The PUT may have landed with only its response lost, so take the
      // server's word before forcing the canvas to match the cache.
      await refetch();
      setRevertNonce((n) => n + 1);
      return undefined;
    }
  }

  // Every pure function below (addBlock/updateBlock/duplicateBlock/
  // removeBlock, all from lib/murals.ts, unchanged) still operates on a
  // `Mural[]` — called with a one-element array holding just THIS mural
  // (the only one it ever touches, matched by mural.id) rather than the
  // full account-wide list, since that's all that's in scope on this
  // page. The resulting single mural's `blocks` is what actually gets
  // persisted, via useMurals()'s saveBlocks for just this one mural.
  async function handleAddBlock(type: BlockType) {
    if (compactMode) {
      const block = createBlockCandidate(type, mural?.blocks ?? []);
      setSelectedBlockId(block.id);
      setMobileDraft({ kind: "add", block, valid: isValidBlockLayout(block.layout, mural?.blocks ?? []) });
      return;
    }
    const target = await materialize();
    if (!target) return;
    const { murals: updated, blockId } = addBlock([target], target.id, type);
    await saveBlocks(target.id, updated[0].blocks);
    editVersionRef.current++;
    // "currentlyReading" and "empty" have nothing to configure at all —
    // skip straight to them just sitting on the canvas. Every other type
    // opens its config panel right away, same "add then configure" flow
    // as the rest of the app.
    if (type !== "currentlyReading" && type !== "empty") setConfiguringBlockId(blockId);
  }

  async function handleSaveBlockConfig(block: MuralBlock) {
    const mural = await materialize();
    if (!mural) return;
    const [updated] = updateBlock([mural], mural.id, block);
    await saveBlocks(mural.id, updated.blocks);
    editVersionRef.current++;
  }

  async function handleSaveBlockStyle(blockId: string, blockStyle: BlockStyle) {
    const mural = await materialize();
    if (!mural) return;
    const current = mural.blocks.find((b) => b.id === blockId);
    if (!current) return;
    const [updated] = updateBlock([mural], mural.id, { ...current, style: blockStyle });
    await saveBlocks(mural.id, updated.blocks);
    editVersionRef.current++;
  }

  async function handleDuplicateBlock(blockId: string) {
    if (compactMode) {
      const original = mural?.blocks.find((block) => block.id === blockId);
      if (!original) return;
      const block = createDuplicateCandidate(original, mural?.blocks ?? []);
      setSelectedBlockId(block.id);
      setMobileDraft({ kind: "duplicate", block, valid: isValidBlockLayout(block.layout, mural?.blocks ?? []) });
      return;
    }
    const target = await materialize();
    if (!target) return;
    const [updated] = duplicateBlock([target], target.id, blockId);
    await saveBlocks(target.id, updated.blocks);
    editVersionRef.current++;
  }

  // Still deliberately no confirm(), unlike deleting a book/image/mural:
  // adding and removing blocks is what composing a mural IS, and a
  // dialog on every removal would be friction on the most frequent
  // action here.
  async function handleDeleteBlock(blockId: string) {
    const mural = await materialize();
    if (!mural) return;
    const before = mural.blocks;
    const removedIndex = before.findIndex((block) => block.id === blockId);
    const removed = before[removedIndex];
    if (!removed) return;
    const [updated] = removeBlock([mural], mural.id, blockId);
    await saveBlocks(mural.id, updated.blocks);
    setSelectedBlockId(null);
    setMobileDraft(null);
    const version = ++editVersionRef.current;
    toast({
      message: "Block deleted.",
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          if (version !== editVersionRef.current) return;
          const latest = currentMural(mural.id);
          if (!latest || latest.blocks.some((block) => block.id === removed.id) || !isValidBlockLayout(removed.layout, latest.blocks)) return;
          const restoredBlocks = [...latest.blocks];
          restoredBlocks.splice(Math.min(removedIndex, restoredBlocks.length), 0, removed);
          void guard(saveBlocks(mural.id, restoredBlocks), "Couldn't undo that.").then((restored) => {
            if (restored) editVersionRef.current++;
          });
        }
      }
    });
  }

  async function handleLayoutChange(blockId: string, layout: BlockLayout) {
    const mural = await materialize();
    if (!mural) return;
    const current = mural.blocks.find((b) => b.id === blockId);
    if (!current) return;
    const [updated] = updateBlock([mural], mural.id, { ...current, layout });
    await saveBlocks(mural.id, updated.blocks);
    editVersionRef.current++;
  }

  function startMobileDraft(kind: "move" | "resize", block: MuralBlock) {
    setMobileDraft({ kind, block: { ...block, layout: { ...block.layout } }, valid: true });
  }

  function changeMobileDraft(layout: BlockLayout) {
    setMobileDraft((draft) => {
      if (!draft) return null;
      const blocks = mural?.blocks ?? [];
      const ignoreBlockId = draft.kind === "move" || draft.kind === "resize" ? draft.block.id : undefined;
      return {
        ...draft,
        block: { ...draft.block, layout },
        valid: isValidBlockLayout(layout, blocks, ignoreBlockId)
      };
    });
  }

  async function applyMobileDraft() {
    if (!mobileDraft || savingDraftRef.current) return;
    savingDraftRef.current = true;
    setSavingDraft(true);
    try {
      const target = await materialize();
      if (!target) return;
      const persistedBlock = target.blocks.find((block) => block.id === mobileDraft.block.id);
      const alreadyInserted = (mobileDraft.kind === "add" || mobileDraft.kind === "duplicate") && persistedBlock;
      const alreadyPositioned =
        (mobileDraft.kind === "move" || mobileDraft.kind === "resize") &&
        persistedBlock &&
        JSON.stringify(persistedBlock.layout) === JSON.stringify(mobileDraft.block.layout);
      if (alreadyInserted || alreadyPositioned) {
        const finishedDraft = mobileDraft;
        editVersionRef.current++;
        setMobileDraft(null);
        setSelectedBlockId(finishedDraft.block.id);
        if (alreadyInserted && finishedDraft.kind === "add" && finishedDraft.block.type !== "currentlyReading" && finishedDraft.block.type !== "empty") {
          setConfiguringBlockId(finishedDraft.block.id);
        }
        return;
      }
      const ignoreBlockId = mobileDraft.kind === "move" || mobileDraft.kind === "resize" ? mobileDraft.block.id : undefined;
      if (!isValidBlockLayout(mobileDraft.block.layout, target.blocks, ignoreBlockId)) {
        setMobileDraft((draft) => draft ? { ...draft, valid: false } : null);
        return;
      }
      const before = target.blocks;
      let blocks: MuralBlock[];
      if (mobileDraft.kind === "add" || mobileDraft.kind === "duplicate") {
        blocks = [...target.blocks, mobileDraft.block];
      } else {
        blocks = target.blocks.map((block) => block.id === mobileDraft.block.id ? { ...block, layout: mobileDraft.block.layout } : block);
      }
      const saved = await saveBlocks(target.id, blocks);
      const finishedDraft = mobileDraft;
      setMobileDraft(null);
      setSelectedBlockId(finishedDraft.block.id);
      const version = ++editVersionRef.current;
      if (finishedDraft.kind === "move" || finishedDraft.kind === "resize") {
        toast({
          message: finishedDraft.kind === "move" ? "Block moved." : "Block resized.",
          duration: 8000,
          action: {
            label: "Undo",
            onClick: () => {
              if (version !== editVersionRef.current) return;
              const latest = currentMural(target.id);
              const original = before.find((block) => block.id === finishedDraft.block.id);
              const current = latest?.blocks.find((block) => block.id === finishedDraft.block.id);
              if (
                !latest ||
                !original ||
                !current ||
                JSON.stringify(current.layout) !== JSON.stringify(finishedDraft.block.layout) ||
                !isValidBlockLayout(original.layout, latest.blocks, current.id)
              ) return;
              const restoredBlocks = latest.blocks.map((block) => block.id === current.id ? { ...block, layout: original.layout } : block);
              void guard(saveBlocks(target.id, restoredBlocks), "Couldn't undo that.").then((restored) => {
                if (restored) editVersionRef.current++;
              });
            }
          }
        });
      }
      if (finishedDraft.kind === "add" && finishedDraft.block.type !== "currentlyReading" && finishedDraft.block.type !== "empty") {
        const inserted = saved.blocks.find((block) => block.id === finishedDraft.block.id);
        if (inserted) setConfiguringBlockId(inserted.id);
      }
    } finally {
      savingDraftRef.current = false;
      setSavingDraft(false);
    }
  }

  const configuringBlock = configuringBlockId ? mural?.blocks.find((b) => b.id === configuringBlockId) : null;
  const stylingBlock = stylingBlockId ? mural?.blocks.find((b) => b.id === stylingBlockId) : null;

  if (isLoading) {
    return (
      <PageContainer>
        <p className="text-sm text-(--color-text-dim)">Loading…</p>
      </PageContainer>
    );
  }

  if (!mural && !isDraft) {
    return (
      <PageContainer>
        <p className="text-sm text-(--color-text-dim)">
          No mural with that id. <Link to="/dashboard/murals" className="text-(--color-accent) transition-opacity hover:opacity-80">Back to Murals</Link>.
        </p>
      </PageContainer>
    );
  }

  const view: Mural = mural ?? {
    id: "",
    name: draftName,
    blocks: [],
    createdAt: "",
    updatedAt: "",
    shareToken: null,
    shareUrl: null,
    folderId: draftFolderId
  };

  return (
    <PageContainer>
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Link to="/dashboard/murals" className="text-xs text-(--color-text-dim) hover:text-(--color-text)">
            ← Murals
          </Link>
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void guard(handleRename(), "Couldn't save that name.")}
              onKeyDown={(e) => {
                if (e.key === "Enter") void guard(handleRename(), "Couldn't save that name.");
                if (e.key === "Escape") setEditingName(false);
              }}
              className="block rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-lg font-bold"
            />
          ) : (
            <button
              onClick={() => {
                setNameDraft(view.name);
                setEditingName(true);
              }}
              title="Rename this mural"
              className="block text-left text-lg font-bold transition-colors hover:text-(--color-accent)"
            >
              {view.name}
            </button>
          )}
        </div>
        {/* Phone: the header's actions as the same 44px icon row every
            list page's toolbar uses — Share opens the same ShareModal,
            Edit/Done is a pencil that goes accent while editing, and
            AddBlockMenu renders its own icon-plus-bottom-sheet form.
            Desktop below keeps the labelled buttons: there's room, and a
            word beats an icon whose meaning you'd have to long-press to
            discover. */}
        <div className="flex items-center gap-2 sm:hidden">
          {editMode && !mobileDraft && <AddBlockMenu onAdd={(type) => void guard(handleAddBlock(type), "Couldn't add that block.")} />}
          {view.blocks.length > 0 && (
            <button onClick={() => void enterFullscreen()} aria-label="View mural fullscreen" title="View mural fullscreen" className={toolbarIconClass()}>
              <FullscreenIcon />
            </button>
          )}
          <button onClick={() => setSharing(true)} aria-label="Share this mural" title="Share this mural" className={toolbarIconClass()}>
            <ShareIcon />
          </button>
          <button
            onClick={toggleEditMode}
            aria-label={editMode ? "Done editing" : "Edit this mural"}
            title={editMode ? "Done editing" : "Edit this mural"}
            className={toolbarIconClass(editMode)}
          >
            <PencilIcon />
          </button>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          {editMode && !mobileDraft && <AddBlockMenu onAdd={(type) => void guard(handleAddBlock(type), "Couldn't add that block.")} />}
          {view.blocks.length > 0 && (
            <button
              onClick={() => void enterFullscreen()}
              className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm font-semibold hover:bg-(--color-surface-hover)"
            >
              Fullscreen
            </button>
          )}
          {/* Nothing to share until the mural exists. Hidden rather
              than disabled on a draft: a greyed button invites a tap
              that can't do anything, and the button reappears the
              instant the first change saves. */}
          {mural && (
            <button
              onClick={() => setSharing(true)}
              className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm font-semibold hover:bg-(--color-surface-hover)"
            >
              Share
            </button>
          )}
          <button
            onClick={toggleEditMode}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              editMode ? "bg-(--color-accent) text-white" : "border border-(--color-border) bg-(--color-surface) hover:bg-(--color-surface-hover)"
            }`}
          >
            {editMode ? "Done editing" : "Edit"}
          </button>
        </div>
      </header>

      {view.blocks.length === 0 && !mobileDraft && (
        <div className="rounded-xl border-2 border-dashed border-(--color-border) py-16 text-center">
          <p className="mb-1 text-(--color-text)">This mural is empty.</p>
          {/* Editing is already on in the second case, so telling you to
              turn it on — and offering a button that turns it on — is
              advice you've taken. Point at the control you actually
              need instead. */}
          <p className="mb-4 text-sm text-(--color-text-dim)">
            {editMode ? "Add your first block with the + button above." : "Turn on editing and add your first block."}
          </p>
          {!editMode && (
            <button onClick={() => setEditMode(true)} className="rounded-lg bg-(--color-accent) px-4 py-2 font-semibold text-white">
              Start building
            </button>
          )}
        </div>
      )}

      {(view.blocks.length > 0 || mobileDraft) && (
        <div
          ref={fullscreenRef}
          className={fullscreen ? "fixed inset-0 z-50 overflow-y-auto bg-(--color-bg) px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]" : ""}
        >
          {fullscreen && (
            <div className="sticky top-0 z-40 -mx-4 -mt-4 mb-3 flex items-center justify-between bg-(--color-bg)/95 px-4 py-3 backdrop-blur">
              <p className="truncate font-semibold">{view.name}</p>
              <button onClick={() => void exitFullscreen()} aria-label="Exit fullscreen" className={toolbarIconClass()}>
                <FullscreenIcon exit />
              </button>
            </div>
          )}
          <MuralCanvas
            mural={view}
            editMode={editMode}
            books={books}
            images={images}
            revertNonce={revertNonce}
            onLayoutChange={(blockId, layout) => void guard(handleLayoutChange(blockId, layout), "Couldn't save that move.")}
            onConfigureBlock={(block) => setConfiguringBlockId(block.id)}
            onStyleBlock={(block) => setStylingBlockId(block.id)}
            onDuplicateBlock={(blockId) => void guard(handleDuplicateBlock(blockId), "Couldn't duplicate that block.")}
            onDeleteBlock={(blockId) => void guard(handleDeleteBlock(blockId), "Couldn't delete that block.")}
            selectedBlockId={selectedBlockId}
            mobileDraft={mobileDraft}
            busy={savingDraft}
            onSelectBlock={setSelectedBlockId}
            onStartResize={(block) => startMobileDraft("resize", block)}
            onMobileDraftChange={changeMobileDraft}
            onApplyMobileDraft={() => void guard(applyMobileDraft(), "Couldn't save that change.")}
            onCancelMobileDraft={() => {
              const keepSelected = mobileDraft?.kind === "move" || mobileDraft?.kind === "resize";
              const blockId = mobileDraft?.block.id ?? null;
              setMobileDraft(null);
              setSelectedBlockId(keepSelected ? blockId : null);
            }}
            tierlistData={tierlistData}
          />
        </div>
      )}

      {configuringBlock && (
        <BlockConfigPanel
          block={configuringBlock}
          books={books}
          images={images}
          onSave={(block) => void guard(handleSaveBlockConfig(block), "Couldn't save those settings.")}
          onClose={() => setConfiguringBlockId(null)}
        />
      )}

      {stylingBlock && (
        <BlockStylePanel
          block={stylingBlock}
          onSave={(blockStyle) => void guard(handleSaveBlockStyle(stylingBlock.id, blockStyle), "Couldn't save that style.")}
          onClose={() => setStylingBlockId(null)}
        />
      )}

      {sharing && mural && (
        <ShareModal
          title={mural.name}
          shareToken={mural.shareToken}
          shareUrl={mural.shareUrl}
          defaultCaption={mural.name}
          onShare={async () => {
            const updated = await share(mural.id);
            return { shareToken: updated.shareToken as string, shareUrl: updated.shareUrl as string };
          }}
          onUnshare={async () => {
            await unshare(mural.id);
          }}
          onClose={() => setSharing(false)}
        />
      )}
    </PageContainer>
  );
}
