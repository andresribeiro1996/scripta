export interface PublisherSite {
  name: string;
  origin: string;
  platform: "shopify" | "woocommerce";
  authorFromVendor: boolean;
}

export const PUBLISHERS: PublisherSite[] = [
  { name: "Antígona", origin: "https://antigona.pt", platform: "shopify", authorFromVendor: true },
  { name: "Orfeu Negro", origin: "https://orfeunegro.org", platform: "shopify", authorFromVendor: false },
  { name: "Imprensa Nacional", origin: "https://loja.incm.pt", platform: "shopify", authorFromVendor: false },
  { name: "Relógio d'Água", origin: "https://www.relogiodagua.pt", platform: "woocommerce", authorFromVendor: false },
  { name: "Exclamação", origin: "https://exclamacao.pt", platform: "woocommerce", authorFromVendor: false },
  { name: "Abysmo", origin: "https://abysmo.pt", platform: "woocommerce", authorFromVendor: false },
  { name: "Gradiva", origin: "https://gradiva.pt", platform: "woocommerce", authorFromVendor: false },
  { name: "Kathartika", origin: "https://www.kathartika.pt", platform: "woocommerce", authorFromVendor: false },
  { name: "Guerra & Paz", origin: "https://guerraepaz.pt", platform: "woocommerce", authorFromVendor: false },
  { name: "Pato Lógico", origin: "https://pato-logico.com", platform: "shopify", authorFromVendor: false },
  { name: "Presença", origin: "https://www.presenca.pt", platform: "shopify", authorFromVendor: false },
  { name: "Edições Afrontamento", origin: "https://www.edicoesafrontamento.pt", platform: "shopify", authorFromVendor: false },
  { name: "Saída de Emergência", origin: "https://www.saidadeemergencia.com", platform: "woocommerce", authorFromVendor: false },
  { name: "Divergência", origin: "https://divergencia.pt", platform: "woocommerce", authorFromVendor: false }
];
