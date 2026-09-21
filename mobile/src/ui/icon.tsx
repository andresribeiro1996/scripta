// The app's icon vocabulary, named by what an icon means rather than by what
// either platform calls its glyph. Screens ask for `delete`; this file is the
// only place that knows iOS draws `trash` and Android draws `delete`.
//
// SymbolView renders real SF Symbols on iOS — which match San Francisco's
// weight and optical size the way a third-party icon set can't — and Google's
// Material Symbols on Android, so one component covers both without a
// platform branch at the call site.
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { ColorValue } from "react-native";

type Glyph = { ios: SFSymbol; android: string };

/** Each entry is the outline form; `filled` picks the solid variant where the
 *  pair exists, which is how both platforms mark a selected tab. */
const GLYPHS = {
  showPassword: { ios: "eye", android: "visibility" },
  hidePassword: { ios: "eye.slash", android: "visibility_off" },
  home: { ios: "house", android: "home" },
  library: { ios: "books.vertical", android: "library_books" },
  arena: { ios: "trophy", android: "trophy" },
  // Solid on purpose: it marks one book as having won the whole thing, not
  // a link to the Arena feature.
  champion: { ios: "trophy.fill", android: "trophy" },
  community: { ios: "person.3", android: "group" },
  murals: { ios: "paintpalette", android: "palette" },
  profile: { ios: "person.circle", android: "account_circle" },
  settings: { ios: "gearshape", android: "settings" },
  add: { ios: "plus", android: "add" },
  confirm: { ios: "checkmark", android: "check" },
  // Vertical on Android: a toolbar or row overflow is drawn that way there,
  // so it's where the thumb already goes. iOS spells the same thing sideways.
  more: { ios: "ellipsis", android: "more_vert" },
  search: { ios: "magnifyingglass", android: "search" },
  public: { ios: "globe", android: "public" },
  delete: { ios: "trash", android: "delete" },
  chevronRight: { ios: "chevron.right", android: "chevron_right" },
  tierlist: { ios: "list.number", android: "format_list_numbered" },
  // The branching draw itself, not a trophy: this marks the view that shows
  // the whole tree, next to an Arena that already owns the trophy.
  bracket: { ios: "arrow.triangle.branch", android: "account_tree" },
  vote: { ios: "checkmark.circle", android: "how_to_vote" },
  book: { ios: "book.closed", android: "book" },
  follow: { ios: "person.badge.plus", android: "person_add" },
} as const satisfies Record<string, Glyph>;

/** Only these five have a solid counterpart worth using; the rest read the
 *  same either way, and `plus.fill` etc. aren't the iOS convention anyway. */
const FILLED = {
  home: { ios: "house.fill", android: "home" },
  library: { ios: "books.vertical.fill", android: "library_books" },
  arena: { ios: "trophy.fill", android: "trophy" },
  community: { ios: "person.3.fill", android: "group" },
  murals: { ios: "paintpalette.fill", android: "palette" },
  settings: { ios: "gearshape.fill", android: "settings" },
} as const satisfies Partial<Record<IconName, Glyph>>;

export type IconName = keyof typeof GLYPHS;

export function Icon({
  name,
  filled = false,
  size = 24,
  color,
}: {
  name: IconName;
  filled?: boolean;
  size?: number;
  color?: ColorValue;
}) {
  const glyph: Glyph = (filled && name in FILLED ? FILLED[name as keyof typeof FILLED] : GLYPHS[name]);
  return <SymbolView name={{ ios: glyph.ios, android: glyph.android } as never} size={size} tintColor={color} />;
}
