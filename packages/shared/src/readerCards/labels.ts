import type { Counter } from "./counters.js";
import type { CardPrint, CornerStyle, Finish, FooterLeft, FooterRight, Layout, MottoLook, Trait } from "./style.js";

export const COUNTER_LABELS: Record<Counter, string> = { dial: "Dial", beads: "Beads", shelf: "Shelf", frame: "Frame", ring: "Ring" };
export const TRAIT_LABELS: Record<Trait, string> = { both: "Both", seal: "Seal", line: "Line", none: "None" };
export const LAYOUT_LABELS: Record<Layout, string> = { faces: "Three faces", book: "Book", merged: "One back" };
export const MOTTO_LOOK_LABELS: Record<MottoLook, string> = { ribbon: "Ribbon", scroll: "Scroll", arc: "Arc", cartouche: "Cartouche", rule: "Rule", bannerBelow: "Banner below", wavyRibbon: "Wavy ribbon", titleRules: "Title rules", dropCap: "Drop cap", sash: "Sash", script: "Script", plaque: "Plaque" };
export const FOOTER_LEFT_LABELS: Record<FooterLeft, string> = { plate: "Plate", plateName: "Plate and name", since: "Reader since", est: "Established", volumes: "Volumes", highlights: "Highlights", series: "Series", genre: "Genre", edition: "Edition", readerNumber: "Reader number", glyph: "Glyph", none: "None" };
export const FOOTER_RIGHT_LABELS: Record<FooterRight, string> = { name: "Name", firstName: "First name", lastName: "Last name", firstInitial: "First name, initial", initials: "Initials", catalog: "Catalogue", handle: "Handle", nameItalic: "Name in italics", signature: "Signature", monogram: "Monogram", monogramDiamond: "Diamond monogram", none: "None" };
export const CORNER_LABELS: Record<CornerStyle, string> = { diamonds: "Diamonds", deco: "Art deco", fleuron: "Fleuron", photo: "Photo corners", stars: "Stars", laurel: "Laurel", knot: "Knot", volute: "Volute", meander: "Meander", rosette: "Rosette", register: "Register mark", none: "None" };
export const PRINT_LABELS: Record<CardPrint, string> = { auto: "Theme", paper: "Paper", reversed: "Reversed" };
export const FINISH_LABELS: Record<Finish, string> = { paper: "Plain", aged: "Aged", linen: "Linen", letterpress: "Letterpress", foil: "Foil", holo: "Holographic", vellum: "Vellum", watercolor: "Watercolour", gilt: "Gilt edge", stamp: "Stamp", kraft: "Kraft", riso: "Riso" };
