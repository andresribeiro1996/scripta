import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { eligiblePassages, pinPassage, resolveHomeBlock, resolveQuote } from "@scripta/shared";
import { useHome } from "../hooks/useHome";
import { useLibrary } from "../hooks/useLibrary";
import { useMurals } from "../hooks/useMurals";
import { useGalleryImages } from "../hooks/useGalleryImages";
import { useTierlists } from "../hooks/useTierlists";
import { updateMuralApi } from "../api/murals";
import { PageContainer } from "../components/PageContainer";
import { Sheet } from "../components/Sheet";
import { MuralCanvas } from "../components/murals/MuralCanvas";
import { MuralBlockDetail } from "../components/murals/MuralBlockDetail";

const button = "inline-flex min-h-11 items-center justify-center rounded-lg border border-(--color-border) px-4 py-2 text-sm hover:bg-(--color-surface-hover) disabled:opacity-50";

export function HomePage() {
  const client = useQueryClient();
  const home = useHome();
  const library = useLibrary();
  const murals = useMurals();
  const gallery = useGalleryImages();
  const tierlists = useTierlists();
  const [choosing, setChoosing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [day] = useState(() => new Date().toISOString().slice(0, 10));
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mural = home.data ? murals.data?.find((item) => item.id === home.data?.id) ?? home.data : null;
  const books = library.data?.data.books ?? [];
  const groups = library.data?.data.groups ?? [];
  const blocks = mural?.blocks.map((block) => resolveHomeBlock(block, books, groups, day, offsets[block.id] ?? 0)) ?? [];
  const selected = blocks.find((block) => block.id === selectedId);
  const original = mural?.blocks.find((block) => block.id === selectedId);
  const tierlistData = (id: string) => { const item = tierlists.data?.find((item) => item.id === id); return item ? { name: item.name, ...item.data } : undefined; };

  async function choose(choice: string | boolean) {
    try { await home.choose(choice); setChoosing(false); } catch { }
  }
  async function keep() {
    if (!mural || !original || !selected) return;
    setSaving(true);
    setError(null);
    try {
      const pinned = pinPassage(original, selected, books);
      const updated = await updateMuralApi(mural.id, { blocks: mural.blocks.map((block) => block.id === pinned.id ? pinned : block), updatedAt: mural.updatedAt });
      client.setQueryData(["home"], updated);
      await client.invalidateQueries({ queryKey: ["murals"] });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't keep this passage."); }
    finally { setSaving(false); }
  }
  return <PageContainer>
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Home</h1><div className="flex flex-wrap gap-2">
        <Link className={button} to="/dashboard/library?action=add">Add book</Link>
        <Link className={button} to="/dashboard/library?action=import">Import</Link>
        {mural ? <Link className={button} to={`/dashboard/murals/${mural.id}?edit=1`}>Edit home</Link> : null}
        <button className={button} onClick={() => setChoosing(true)}>Choose mural</button>
      </div></header>
      <form action="/dashboard/library" className="flex gap-2"><input aria-label="Search your library" placeholder="Search your library" name="q" className="min-w-0 flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2" /><button className={button}>Search</button></form>
      {error || home.choiceError ? <p role="alert" className="text-(--color-danger)">{error ?? home.choiceError?.message}</p> : null}
      {home.isPending || library.isPending ? <p role="status">Loading home…</p> : home.isError || library.isError ? <div role="alert"><p>Couldn't load your home.</p><button className={button} onClick={() => { void home.refetch(); void library.refetch(); }}>Retry</button></div> : <>
        {!books.length ? <p>Bring your books into Scripta. Import your library or add a book to begin.</p> : null}
        {mural ? <MuralCanvas mural={{ ...mural, blocks }} editMode={false} books={books} images={gallery.images} tierlistData={tierlistData} onOpenBlock={(block) => setSelectedId(block.id)} /> : <div className="space-y-3 rounded-xl border border-(--color-border) p-6"><h2 className="text-xl">Make yourself at home</h2><p>Start with an editable reading space, or choose one of your murals.</p><button className={button} disabled={home.choosing} onClick={() => void choose(eligiblePassages(books).length > 0)}>{home.choosing ? "Creating…" : "Create my home"}</button></div>}
      </>}
      {gallery.error || tierlists.isError ? <div role="alert">Some mural content couldn't load. <button className={button} onClick={() => { void client.invalidateQueries({ queryKey: ["gallery"] }); void tierlists.refetch(); }}>Retry</button></div> : null}
    </div>
    {choosing ? <Sheet title="Choose your home mural" onClose={() => setChoosing(false)}><div className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto p-4">
      {home.choiceError ? <p role="alert">{home.choiceError.message}</p> : null}
      {murals.isPending ? <p>Loading murals…</p> : murals.isError ? <button className={button} onClick={() => void murals.refetch()}>Couldn't load murals. Retry</button> : murals.data?.length ? murals.data.map((item) => <button key={item.id} className={button} disabled={home.choosing} onClick={() => void choose(item.id)}>{item.name}</button>) : <p>No murals yet. Create your home to get started.</p>}
    </div></Sheet> : null}
    {selected ? <MuralBlockDetail block={selected} books={books} images={gallery.images} tierlistData={tierlistData} onClose={() => setSelectedId(null)} actions={<div className="flex flex-wrap gap-2 p-3">
      {original?.type === "shelf" && original.collectionId ? <Link className={button} to={`/dashboard/collections?group=${encodeURIComponent(original.collectionId)}`}>Open collection</Link> : null}
      {selected.type === "tierlist" ? <Link className={button} to={`/dashboard/arena/tierlist/${selected.tierlistId}`}>Open tier list</Link> : null}
      {original?.type === "quote" && original.mode === "rediscover" ? <><button className={button} disabled={saving || selected.type !== "quote" || !resolveQuote(selected, books)} onClick={() => setOffsets({ ...offsets, [original.id]: (offsets[original.id] ?? 0) + 1 })}>Show another</button><button className={button} disabled={saving || selected.type !== "quote" || !resolveQuote(selected, books)} onClick={() => void keep()}>Keep this passage</button></> : null}
      {mural ? <Link className={button} to={`/dashboard/murals/${mural.id}?edit=1`}>Edit mural</Link> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>} /> : null}
  </PageContainer>;
}
