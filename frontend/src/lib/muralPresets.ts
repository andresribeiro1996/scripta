import { bookKey } from "./merge";
import { DEFAULT_BLOCK_STYLE, type BlockStyle } from "./libraryStyle";
import type { MuralBlock } from "./murals";

export const MURAL_PRESETS = [
  { id: "best", name: "Melhores livros de sempre", description: "Uma galeria pessoal das histórias que ficaram.", color: "#44252e", accent: "#edcd96" },
  { id: "recent", name: "Livros lidos recentemente", description: "Um diário visual das últimas páginas viradas.", color: "#233d35", accent: "#c2dbc9" },
  { id: "next", name: "Livros que quero ler", description: "Um horizonte de histórias por descobrir.", color: "#25364f", accent: "#c5d7f1" }
] as const;

export type MuralPresetId = typeof MURAL_PRESETS[number]["id"];

function timestamp(value: unknown) {
  const date = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? date : 0;
}

export function buildMuralPreset(id: MuralPresetId, books: Array<Record<string, unknown>>) {
  const preset = MURAL_PRESETS.find((item) => item.id === id)!;
  const unique = [...new Map(books.filter((book) => String(book.Title ?? "").trim()).map((book) => [bookKey(book), book])).values()];
  const selected = unique.filter((book) => id === "best"
    ? typeof book.Rating === "number" && book.Rating > 0 && book.Rating <= 5
    : book.ReadStatus === (id === "recent" ? 2 : 0))
    .sort((a, b) => id === "best"
      ? Number(b.Rating) - Number(a.Rating)
      : timestamp(id === "recent" ? b.DateLastRead : b.DateCreated) - timestamp(id === "recent" ? a.DateLastRead : a.DateCreated))
    .slice(0, 8);
  const style: BlockStyle = { ...DEFAULT_BLOCK_STYLE, backgroundColor: preset.color, textColor: "#f5f1e9", cardBorderWidth: 0, cardShadow: false, cardRadius: 16, fontFamily: "sans" };
  const blocks: MuralBlock[] = [];
  const base = (x: number, y: number, w: number, h: number, accent = false) => ({
    id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `preset_${Date.now()}_${Math.random().toString(36).slice(2)}`, layout: { x, y, w, h },
    style: accent ? { ...style, backgroundColor: preset.accent, textColor: preset.color, fontFamily: "playfairDisplay" as const } : style
  });
  const note = selected.length === 0
    ? id === "best" ? "Adiciona avaliações pessoais para começar a tua galeria." : id === "recent" ? "Marca os teus livros como lidos para começar este diário." : "Adiciona livros por ler para começar a tua lista."
    : id === "best" ? "Escolhidos pelas tuas avaliações. Podes trocar qualquer livro." : id === "recent" ? "As datas conhecidas aparecem primeiro. Cada leitura tem o seu lugar." : "A tua lista por ler, com as adições mais recentes primeiro.";
  if (id === "best") {
    blocks.push({ ...base(0, 0, 8, 5, true), type: "text", heading: "A minha biblioteca essencial", body: "Histórias para guardar.\nLivros para voltar a abrir." });
    blocks.push({ ...base(8, 0, 4, 5), type: "text", heading: "A escolha é minha", body: note });
    blocks.push(selected[0] ? { ...base(0, 6, 4, 12), type: "spotlight", bookKey: bookKey(selected[0]) } : { ...base(0, 6, 4, 12), type: "text", heading: "O teu favorito", body: note });
    blocks.push({ ...base(4, 6, 8, 8), type: "shelf", title: "Lugar de honra", bookKeys: selected.slice(1).map(bookKey) });
    blocks.push({ ...base(4, 14, 8, 4, true), type: "text", heading: "O que fica depois da última página?", body: "Escreve aqui o que torna estes livros especiais para ti." });
  } else if (id === "recent") {
    blocks.push({ ...base(0, 0, 12, 4, true), type: "text", heading: "Últimas páginas", body: "O meu diário de leitura" });
    blocks.push({ ...base(0, 5, 8, 9), type: "shelf", title: "Acabei de ler", bookKeys: selected.map(bookKey) });
    blocks.push({ ...base(8, 5, 4, 6), type: "text", heading: "À margem", body: note });
    blocks.push({ ...base(8, 11, 4, 7, true), type: "text", heading: "Ainda a pensar em…", body: "Um lugar para as ideias que estas leituras deixaram." });
    blocks.push({ ...base(0, 14, 8, 4), type: "text", heading: "Uma página de cada vez", body: "Regista uma descoberta, uma surpresa ou uma vontade de reler." });
  } else {
    blocks.push({ ...base(0, 0, 5, 7, true), type: "text", heading: "O próximo capítulo", body: "Tantas histórias.\nUm livro de cada vez." });
    blocks.push(selected[0] ? { ...base(5, 0, 4, 10), type: "spotlight", bookKey: bookKey(selected[0]), caption: "Na minha lista" } : { ...base(5, 0, 7, 10), type: "text", heading: "Por descobrir", body: note });
    if (selected[0]) blocks.push({ ...base(9, 0, 3, 10), type: "text", heading: "Sem pressa", body: "A curiosidade escolhe o caminho." });
    blocks.push({ ...base(0, 7, 5, 3), type: "text", heading: "A minha lista", body: note });
    blocks.push({ ...base(0, 11, 12, 8), type: "shelf", title: "No horizonte", bookKeys: selected.slice(selected[0] ? 1 : 0).map(bookKey) });
  }
  return { name: preset.name, blocks, bookCount: selected.length };
}
