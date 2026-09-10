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
  home: { ios: "house", android: "home" },
  library: { ios: "books.vertical", android: "library_books" },
  arena: { ios: "trophy", android: "trophy" },
  murals: { ios: "paintpalette", android: "palette" },
  settings: { ios: "gearshape", android: "settings" },
  add: { ios: "plus", android: "add" },
  confirm: { ios: "checkmark", android: "check" },
  more: { ios: "ellipsis", android: "more_horiz" },
  public: { ios: "globe", android: "public" },
  delete: { ios: "trash", android: "delete" },
} as const satisfies Record<string, Glyph>;

/** Only these four have a solid counterpart worth using; the rest read the
 *  same either way, and `plus.fill` etc. aren't the iOS convention anyway. */
const FILLED = {
  home: { ios: "house.fill", android: "home" },
  library: { ios: "books.vertical.fill", android: "library_books" },
  arena: { ios: "trophy.fill", android: "trophy" },
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
