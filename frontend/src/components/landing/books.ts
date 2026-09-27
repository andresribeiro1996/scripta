export const BOOKS = {
  piranesi: { title: "Piranesi", author: "Susanna Clarke" },
  "hail-mary": { title: "Project Hail Mary", author: "Andy Weir" },
  circe: { title: "Circe", author: "Madeline Miller" },
  gilead: { title: "Gilead", author: "Marilynne Robinson" },
  stoner: { title: "Stoner", author: "John Williams" },
  remains: { title: "The Remains of the Day", author: "Kazuo Ishiguro" },
  klara: { title: "Klara and the Sun", author: "Kazuo Ishiguro" },
  "normal-people": { title: "Normal People", author: "Sally Rooney" },
  achilles: { title: "The Song of Achilles", author: "Madeline Miller" },
  sapiens: { title: "Sapiens", author: "Yuval Noah Harari" },
  "the-road": { title: "The Road", author: "Cormac McCarthy" },
  "left-hand": { title: "The Left Hand of Darkness", author: "Ursula K. Le Guin" },
  pachinko: { title: "Pachinko", author: "Min Jin Lee" },
  "secret-history": { title: "The Secret History", author: "Donna Tartt" },
  sweetgrass: { title: "Braiding Sweetgrass", author: "Robin Wall Kimmerer" },
  atonement: { title: "Atonement", author: "Ian McEwan" },
} as const;

export type BookSlug = keyof typeof BOOKS;

export const coverSrc = (slug: BookSlug) => `/covers/${slug}.jpg`;

export function readerCardSrc(plate: { key: string; numeral: string }) {
  const n = plate.numeral.toLowerCase();
  return {
    paper: `/reader-cards/${n}-${plate.key}-paper.svg`,
    reversed: `/reader-cards/${n}-${plate.key}-reversed.svg`,
  };
}
