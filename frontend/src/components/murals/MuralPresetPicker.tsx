import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLibrary } from "../../hooks/useLibrary";
import { useMurals } from "../../hooks/useMurals";
import { buildMuralPreset, MURAL_PRESETS, type MuralPresetId } from "../../lib/muralPresets";
import { bookKey } from "../../lib/merge";
import { Sheet } from "../Sheet";

export function MuralPresetPicker({ folderId, onClose }: { folderId: string | null; onClose: () => void }) {
  const { data: library, isLoading, isError } = useLibrary();
  const { create, saveBlocks } = useMurals();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ id: string; preset: MuralPresetId } | null>(null);
  const working = useRef(false);
  const books = library?.data.books ?? [];

  async function choose(id: MuralPresetId) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const preset = buildMuralPreset(id, books);
      const target = pending ?? { id: (await create(preset.name, folderId)).id, preset: id };
      setPending(target);
      await saveBlocks(target.id, preset.blocks);
      navigate(`/dashboard/murals/${target.id}`);
    } catch {
      setError("Não foi possível guardar o preset. Tenta novamente na mesma opção para completar o mural.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <Sheet title="Começar com um preset" onClose={() => { if (!working.current) onClose(); }}>
      <p className="px-3 pb-4 text-sm text-(--color-text-dim)">Preenchidos com a tua biblioteca. Todos os blocos podem ser movidos e personalizados.</p>
      {error && <p role="alert" className="px-3 pb-3 text-sm text-(--color-danger)">{error}</p>}
      {isError && <p role="alert" className="px-3 pb-3 text-sm text-(--color-danger)">Não foi possível carregar a biblioteca. Volta a abrir os presets para tentar novamente.</p>}
      <div className="space-y-4 px-3 pb-4">
        {MURAL_PRESETS.map((preset) => {
          const built = buildMuralPreset(preset.id, books);
          const bottom = Math.max(...built.blocks.map((block) => block.layout.y + block.layout.h));
          return (
            <button key={preset.id} disabled={busy || isLoading || isError || Boolean(pending && pending.preset !== preset.id)} onClick={() => void choose(preset.id)} className="block w-full overflow-hidden rounded-2xl border border-(--color-border) text-left transition-colors hover:border-(--color-accent) disabled:opacity-50">
              <div aria-hidden="true" className="relative h-44 overflow-hidden bg-[#151719]">
                {built.blocks.map((block) => (
                  <div key={block.id} className="absolute overflow-hidden rounded p-1.5" style={{ left: `${block.layout.x / 12 * 100}%`, top: `${block.layout.y / bottom * 100}%`, width: `calc(${block.layout.w / 12 * 100}% - 4px)`, height: `calc(${block.layout.h / bottom * 100}% - 4px)`, backgroundColor: block.style?.backgroundColor ?? preset.color, color: block.style?.textColor ?? preset.accent }}>
                    {block.type === "text" ? <span className="line-clamp-2 text-[11px] leading-tight font-semibold">{block.heading}</span> : (
                      <div className="flex h-full gap-1.5">
                        {(block.type === "spotlight" ? [block.bookKey] : block.type === "shelf" ? block.bookKeys.slice(0, 3) : []).map((key) => {
                          const book = books.find((item) => bookKey(item) === key);
                          return <div key={key} className="h-full min-w-0 flex-1 overflow-hidden rounded-sm" style={{ backgroundColor: preset.accent }}>
                            {typeof book?._coverUrl === "string" ? <img src={book._coverUrl} alt="" className="h-full w-full object-contain" /> : <span className="block p-1 text-[10px] leading-tight" style={{ color: preset.color }}>{String(book?.Title ?? "")}</span>}
                          </div>;
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold">{preset.name}</p>
                <p className="mt-1 text-xs text-(--color-text-dim)">{preset.description}</p>
                <p className="mt-3 text-xs font-medium text-(--color-accent)">{busy ? "A guardar…" : isLoading ? "A carregar biblioteca…" : `${built.bookCount} livros · Usar preset →`}</p>
              </div>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
