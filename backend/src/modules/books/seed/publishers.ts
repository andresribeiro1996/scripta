import type { PageAuthorRule } from "./publisherFeed.js";

export interface PublisherSite {
  name: string;
  origin: string;
  platform: "shopify" | "woocommerce";
  authorFromVendor: boolean;
  authorTag?: RegExp | RegExp[];
  pageAuthor?: PageAuthorRule;
}

export const PUBLISHERS: PublisherSite[] = [
  { name: "Antígona", origin: "https://antigona.pt", platform: "shopify", authorFromVendor: true },
  { name: "Orfeu Negro", origin: "https://orfeunegro.org", platform: "shopify", authorFromVendor: false, pageAuthor: "prodMainH4" },
  { name: "Imprensa Nacional", origin: "https://loja.incm.pt", platform: "shopify", authorFromVendor: false, authorTag: [/^AUTOR_(?<order>\d+)\s+(?<name>.+)$/, /^AUTOR\s+(?<name>.+)$/] },
  { name: "Relógio d'Água", origin: "https://www.relogiodagua.pt", platform: "woocommerce", authorFromVendor: false, pageAuthor: "autorLink" },
  { name: "Exclamação", origin: "https://exclamacao.pt", platform: "woocommerce", authorFromVendor: false, pageAuthor: "elementorAuthor" },
  { name: "Abysmo", origin: "https://abysmo.pt", platform: "woocommerce", authorFromVendor: false },
  { name: "Gradiva", origin: "https://gradiva.pt", platform: "woocommerce", authorFromVendor: false, pageAuthor: "autorLink" },
  { name: "Kathartika", origin: "https://www.kathartika.pt", platform: "woocommerce", authorFromVendor: false },
  { name: "Guerra & Paz", origin: "https://guerraepaz.pt", platform: "woocommerce", authorFromVendor: false, pageAuthor: "autorLink" },
  { name: "Pato Lógico", origin: "https://pato-logico.com", platform: "shopify", authorFromVendor: false },
  { name: "Presença", origin: "https://www.presenca.pt", platform: "shopify", authorFromVendor: false, authorTag: /^NOMEAUTOR_(.+)$/ },
  { name: "Edições Afrontamento", origin: "https://www.edicoesafrontamento.pt", platform: "shopify", authorFromVendor: false, pageAuthor: "productAutor" },
  { name: "Saída de Emergência", origin: "https://www.saidadeemergencia.com", platform: "woocommerce", authorFromVendor: false, pageAuthor: "summaryAuthor" },
  { name: "Divergência", origin: "https://divergencia.pt", platform: "woocommerce", authorFromVendor: false },
  { name: "Penguin Livros", origin: "https://penguinlivros.pt", platform: "woocommerce", authorFromVendor: false, pageAuthor: "autorLink" }
];
