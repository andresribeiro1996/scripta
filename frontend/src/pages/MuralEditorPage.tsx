import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AddBlockMenu } from "../components/murals/AddBlockMenu";
import { BlockConfigPanel } from "../components/murals/BlockConfigPanel";
import { BlockStylePanel } from "../components/murals/BlockStylePanel";
import { MuralCanvas } from "../components/murals/MuralCanvas";
import { PageContainer } from "../components/PageContainer";
import { useGalleryImages } from "../hooks/useGalleryImages";
import { useLibrary } from "../hooks/useLibrary";
import { useMuralBlockLayout } from "../hooks/useMuralBlockLayout";
import { resolveLibraryStyle, type BlockStyle } from "../lib/libraryStyle";
import { addBlock, duplicateBlock, removeBlock, renameMural, updateBlock, type BlockLayout, type BlockType, type MuralBlock } from "../lib/murals";

/** /dashboard/murals/:muralId — one mural's canvas (see
 *  components/murals/MuralCanvas.tsx for the actual freeform grid).
 *  View/Edit toggle, same pattern as the Library/Series/Collections
 *  pages' "Select…" mode toggle: View is the clean read-only render
 *  (what you'd actually show someone), Edit reveals drag handles, resize
 *  corners, and each block's configure/delete controls. */
export function MuralEditorPage() {
  const { muralId } = useParams<{ muralId: string }>();
  const { data: library, isLoading, updateLibrary } = useLibrary();
  const { images } = useGalleryImages();
  // Moving a block goes through its own endpoint, not a whole-library
  // save — see hooks/useMuralBlockLayout.ts.
  const saveBlockLayout = useMuralBlockLayout(muralId);
  const style = resolveLibraryStyle(library?.data.style);
  const books = library?.data.books ?? [];
  const murals = library?.data.murals ?? [];
  const mural = murals.find((m) => m.id === muralId);

  const [editMode, setEditMode] = useState(false);
  const [configuringBlockId, setConfiguringBlockId] = useState<string | null>(null);
  const [stylingBlockId, setStylingBlockId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  async function handleRename() {
    if (!mural) return;
    const name = nameDraft.trim();
    setEditingName(false);
    if (!name) return;
    await updateLibrary((data) => ({ ...data, murals: renameMural(data.murals ?? [], mural.id, name) }));
  }

  async function handleAddBlock(type: BlockType) {
    if (!mural) return;
    const { murals: updated, blockId } = addBlock(murals, mural.id, type);
    await updateLibrary((data) => ({ ...data, murals: updated }));
    // "currentlyReading" and "empty" have nothing to configure at all —
    // skip straight to them just sitting on the canvas. Every other type
    // opens its config panel right away, same "add then configure" flow
    // as the rest of the app.
    if (type !== "currentlyReading" && type !== "empty") setConfiguringBlockId(blockId);
  }

  async function handleSaveBlockConfig(block: MuralBlock) {
    if (!mural) return;
    await updateLibrary((data) => ({ ...data, murals: updateBlock(data.murals ?? [], mural.id, block) }));
  }

  async function handleSaveBlockStyle(blockId: string, blockStyle: BlockStyle) {
    if (!mural) return;
    const current = mural.blocks.find((b) => b.id === blockId);
    if (!current) return;
    await updateLibrary((data) => ({ ...data, murals: updateBlock(data.murals ?? [], mural.id, { ...current, style: blockStyle }) }));
  }

  async function handleDuplicateBlock(blockId: string) {
    if (!mural) return;
    await updateLibrary((data) => ({ ...data, murals: duplicateBlock(data.murals ?? [], mural.id, blockId) }));
  }

  // Deliberately no confirm() here, unlike deleting a book/image/mural —
  // removing one block while actively composing a mural is low-stakes
  // and high-frequency (you'll add and remove blocks constantly while
  // arranging one), and re-adding + reconfiguring one is cheap. A
  // confirmation on every removal would just be editing friction.
  async function handleDeleteBlock(blockId: string) {
    if (!mural) return;
    await updateLibrary((data) => ({ ...data, murals: removeBlock(data.murals ?? [], mural.id, blockId) }));
  }

  function handleLayoutChange(blockId: string, layout: BlockLayout) {
    if (!mural) return;
    if (!mural.blocks.some((b) => b.id === blockId)) return;
    saveBlockLayout(blockId, layout);
  }

  const configuringBlock = configuringBlockId ? mural?.blocks.find((b) => b.id === configuringBlockId) : null;
  const stylingBlock = stylingBlockId ? mural?.blocks.find((b) => b.id === stylingBlockId) : null;

  if (isLoading) {
    return (
      <PageContainer style={style}>
        <p className="text-sm text-(--color-text-dim)">Loading…</p>
      </PageContainer>
    );
  }

  if (!mural) {
    return (
      <PageContainer style={style}>
        <p className="text-sm text-(--color-text-dim)">
          No mural with that id. <Link to="/dashboard/murals" className="text-(--color-accent) transition-opacity hover:opacity-80">Back to Murals</Link>.
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer style={style}>
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
                setNameDraft(mural.name);
                setEditingName(true);
              }}
              title="Rename this mural"
              className="block text-left text-lg font-bold transition-colors hover:text-(--color-accent)"
            >
              {mural.name}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editMode && <AddBlockMenu onAdd={(type) => void handleAddBlock(type)} />}
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

      {mural.blocks.length === 0 && (
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

      {mural.blocks.length > 0 && (
        <MuralCanvas
          mural={mural}
          editMode={editMode}
          books={books}
          images={images}
          onLayoutChange={handleLayoutChange}
          onConfigureBlock={(block) => setConfiguringBlockId(block.id)}
          onStyleBlock={(block) => setStylingBlockId(block.id)}
          onDuplicateBlock={(blockId) => void handleDuplicateBlock(blockId)}
          onDeleteBlock={(blockId) => void handleDeleteBlock(blockId)}
          // The tier list's own live drag-and-drop ranking board (see
          // MuralCanvas.tsx's own comment) persists straight through this
          // — literally the same save path handleSaveBlockConfig already
          // uses for the Configure modal's Save button, since "a block's
          // content changed, write the whole updated block back" is
          // exactly the same operation regardless of which UI triggered
          // it.
          onUpdateBlock={(block) => void handleSaveBlockConfig(block)}
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
    </PageContainer>
  );
}
