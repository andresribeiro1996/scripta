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
  shelf: { ios: "books.vertical", android: "shelves" },
  readerCard: { ios: "person.text.rectangle", android: "id_card" },
  arena: { ios: "trophy", android: "trophy" },
  // Solid on purpose: it marks one book as having won the whole thing, not
  // a link to the Arena feature.
  champion: { ios: "trophy.fill", android: "trophy" },
  community: { ios: "person.3", android: "group" },
  murals: { ios: "paintpalette", android: "palette" },
  profile: { ios: "person.circle", android: "account_circle" },
  settings: { ios: "gearshape", android: "settings" },
  bell: { ios: "bell", android: "notifications" },
  add: { ios: "plus", android: "add" },
  confirm: { ios: "checkmark", android: "check" },
  save: { ios: "square.and.arrow.down", android: "save" },
  edit: { ios: "pencil", android: "edit" },
  // Vertical on Android: a toolbar or row overflow is drawn that way there,
  // so it's where the thumb already goes. iOS spells the same thing sideways.
  more: { ios: "ellipsis", android: "more_vert" },
  search: { ios: "magnifyingglass", android: "search" },
  recent: { ios: "clock.arrow.circlepath", android: "history" },
  scan: { ios: "barcode.viewfinder", android: "barcode_scanner" },
  filter: { ios: "line.3.horizontal.decrease", android: "filter_list" },
  folder: { ios: "folder", android: "folder" },
  public: { ios: "globe", android: "public" },
  lock: { ios: "lock", android: "lock" },
  image: { ios: "photo", android: "image" },
  camera: { ios: "camera", android: "photo_camera" },
  link: { ios: "link", android: "link" },
  qr: { ios: "qrcode", android: "qr_code_2" },
  close: { ios: "xmark", android: "close" },
  back: { ios: "chevron.left", android: "chevron_left" },
  share: { ios: "square.and.arrow.up", android: "share" },
  delete: { ios: "trash", android: "delete" },
  chevronRight: { ios: "chevron.right", android: "chevron_right" },
  tierlist: { ios: "list.number", android: "format_list_numbered" },
  // The branching draw itself, not a trophy: this marks the view that shows
  // the whole tree, next to an Arena that already owns the trophy.
  bracket: { ios: "arrow.triangle.branch", android: "account_tree" },
  vote: { ios: "checkmark.circle", android: "how_to_vote" },
  book: { ios: "book.closed", android: "book" },
  follow: { ios: "person.badge.plus", android: "person_add" },
  style: { ios: "paintbrush", android: "brush" },
  theme: { ios: "circle.lefthalf.filled", android: "contrast" },
  resize: { ios: "arrow.up.left.and.arrow.down.right", android: "open_in_full" },
  expandHorizontal: { ios: "arrow.left.and.right", android: "swap_horiz" },
  expandVertical: { ios: "arrow.up.and.down", android: "swap_vert" },
  moveToTop: { ios: "arrow.up.to.line", android: "vertical_align_top" },
  duplicate: { ios: "plus.square.on.square", android: "content_copy" },
  info: { ios: "info.circle", android: "info" },
  quote: { ios: "quote.opening", android: "format_quote" },
  like: { ios: "heart", android: "favorite_border" },
  comment: { ios: "bubble.right", android: "chat_bubble_outline" },
  bookmark: { ios: "bookmark", android: "bookmark_border" },
  sync: { ios: "arrow.triangle.2.circlepath", android: "sync" },
  reorder: { ios: "arrow.up.arrow.down", android: "reorder" },
  select: { ios: "checkmark.circle", android: "check_circle" },
} as const satisfies Record<string, Glyph>;

/** Only the tab icons have a solid counterpart worth using; the rest read the
 *  same either way, and `plus.fill` etc. aren't the iOS convention anyway. */
const FILLED = {
  like: { ios: "heart.fill", android: "favorite" },
  bookmark: { ios: "bookmark.fill", android: "bookmark" },
  home: { ios: "house.fill", android: "home" },
  library: { ios: "books.vertical.fill", android: "library_books" },
  arena: { ios: "trophy.fill", android: "trophy" },
  profile: { ios: "person.circle.fill", android: "account_circle" },
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
