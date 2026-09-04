import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { AddBlockMenu } from "../components/murals/AddBlockMenu";
import { BlockConfigPanel } from "../components/murals/BlockConfigPanel";
import { BlockStylePanel } from "../components/murals/BlockStylePanel";
import { MuralCanvas } from "../components/murals/MuralCanvas";
import { PageContainer } from "../components/PageContainer";
import { ShareModal } from "../components/ShareModal";
import { PencilIcon, ShareIcon, toolbarIconClass } from "../components/Toolbar";
import { useGalleryImages } from "../hooks/useGalleryImages";
import { useLibrary } from "../hooks/useLibrary";
import { useMurals } from "../hooks/useMurals";
import { useTierlists } from "../hooks/useTierlists";
import { type BlockStyle } from "../lib/libraryStyle";
import { addBlock, duplicateBlock, removeBlock, updateBlock, type BlockLayout, type BlockType, type Mural, type MuralBlock } from "../lib/murals";

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
  const { data: muralsData, isLoading, create, rename, saveBlocks, share, unshare } = useMurals();
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

  // Every pure function below (addBlock/updateBlock/duplicateBlock/
  // removeBlock, all from lib/murals.ts, unchanged) still operates on a
  // `Mural[]` — called with a one-element array holding just THIS mural
  // (the only one it ever touches, matched by mural.id) rather than the
  // full account-wide list, since that's all that's in scope on this
  // page. The resulting single mural's `blocks` is what actually gets
  // persisted, via useMurals()'s saveBlocks for just this one mural.
  async function handleAddBlock(type: BlockType) {
    const mural = await materialize();
    if (!mural) return;
    const { murals: updated, blockId } = addBlock([mural], mural.id, type);
    await saveBlocks(mural.id, updated[0].blocks);
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
  }

  async function handleSaveBlockStyle(blockId: string, blockStyle: BlockStyle) {
    const mural = await materialize();
    if (!mural) return;
    const current = mural.blocks.find((b) => b.id === blockId);
    if (!current) return;
    const [updated] = updateBlock([mural], mural.id, { ...current, style: blockStyle });
    await saveBlocks(mural.id, updated.blocks);
  }

  async function handleDuplicateBlock(blockId: string) {
    const mural = await materialize();
    if (!mural) return;
    const [updated] = duplicateBlock([mural], mural.id, blockId);
    await saveBlocks(mural.id, updated.blocks);
  }

  // Deliberately no confirm() here, unlike deleting a book/image/mural —
  // removing one block while actively composing a mural is low-stakes
  // and high-frequency (you'll add and remove blocks constantly while
  // arranging one), and re-adding + reconfiguring one is cheap. A
  // confirmation on every removal would just be editing friction.
  async function handleDeleteBlock(blockId: string) {
    const mural = await materialize();
    if (!mural) return;
    const [updated] = removeBlock([mural], mural.id, blockId);
    await saveBlocks(mural.id, updated.blocks);
  }

  async function handleLayoutChange(blockId: string, layout: BlockLayout) {
    const mural = await materialize();
    if (!mural) return;
    const current = mural.blocks.find((b) => b.id === blockId);
    if (!current) return;
    const [updated] = updateBlock([mural], mural.id, { ...current, layout });
    await saveBlocks(mural.id, updated.blocks);
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

  // A draft renders as an empty mural: same editor, nothing saved yet.
  const view = mural ?? { id: "", name: draftName, blocks: [] as MuralBlock[] };

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
              onBlur={() => void handleRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRename();
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
          {editMode && <AddBlockMenu onAdd={(type) => void handleAddBlock(type)} />}
          <button onClick={() => setSharing(true)} aria-label="Share this mural" title="Share this mural" className={toolbarIconClass()}>
            <ShareIcon />
          </button>
          <button
            onClick={() => setEditMode((e) => !e)}
            aria-label={editMode ? "Done editing" : "Edit this mural"}
            title={editMode ? "Done editing" : "Edit this mural"}
            className={toolbarIconClass(editMode)}
          >
            <PencilIcon />
          </button>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          {editMode && <AddBlockMenu onAdd={(type) => void handleAddBlock(type)} />}
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
            onClick={() => setEditMode((e) => !e)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              editMode ? "bg-(--color-accent) text-white" : "border border-(--color-border) bg-(--color-surface) hover:bg-(--color-surface-hover)"
            }`}
          >
            {editMode ? "Done editing" : "Edit"}
          </button>
        </div>
      </header>

      {view.blocks.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-(--color-border) py-16 text-center">
          <p className="mb-1 text-(--color-text)">This mural is empty.</p>
          <p className="mb-4 text-sm text-(--color-text-dim)">Turn on editing and add your first block.</p>
          {!editMode && (
            <button onClick={() => setEditMode(true)} className="rounded-lg bg-(--color-accent) px-4 py-2 font-semibold text-white">
              Start building
            </button>
          )}
        </div>
      )}

      {mural && mural.blocks.length > 0 && (
        <MuralCanvas
          mural={mural}
          editMode={editMode}
          books={books}
          images={images}
          onLayoutChange={(blockId, layout) => void handleLayoutChange(blockId, layout)}
          onConfigureBlock={(block) => setConfiguringBlockId(block.id)}
          onStyleBlock={(block) => setStylingBlockId(block.id)}
          onDuplicateBlock={(blockId) => void handleDuplicateBlock(blockId)}
          onDeleteBlock={(blockId) => void handleDeleteBlock(blockId)}
          tierlistData={tierlistData}
        />
      )}

      {configuringBlock && (
        <BlockConfigPanel
          block={configuringBlock}
          books={books}
          images={images}
          onSave={(block) => void handleSaveBlockConfig(block)}
          onClose={() => setConfiguringBlockId(null)}
        />
      )}

      {stylingBlock && (
        <BlockStylePanel
          block={stylingBlock}
          onSave={(blockStyle) => void handleSaveBlockStyle(stylingBlock.id, blockStyle)}
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
