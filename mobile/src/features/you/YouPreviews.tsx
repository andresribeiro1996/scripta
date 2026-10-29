import { useMemo, type ComponentType } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { readerCardInputOf } from "@scripta/shared";
import { Icon, radii, spacing, useTheme, type IconName } from "../../ui";
import { useAuth } from "../../core/auth";
import { API_URL } from "../../core/config";
import { CoverImage } from "../library/components/CoverImage";
import { useLibrary } from "../library/hooks/useLibrary";
import { fetchGalleryImages } from "../gallery/api";
import { MuralThumbnail } from "../murals/MuralCanvas";
import { ReaderCardImage } from "../murals/ReaderCardImage";
import { useMurals } from "../murals/useMurals";
import { useOwnCardStyle } from "../readerCard/useReaderCardStyle";
import { fetchTierlists } from "../tierlists/api";
import { latestBooks, latestMural } from "./youLatest";

const NO_BOOKS: Array<Record<string, unknown>> = [];
const NO_GROUPS: never[] = [];
const READER_CARD_WIDTH = 88;

function Placeholder({ name }: { name: IconName }) {
  const { colors } = useTheme();
  return <Icon name={name} size={40} color={colors.textDim} />;
}

function ShelfPreview() {
  const { data } = useLibrary();
  const books = useMemo(() => latestBooks(data?.data.books ?? NO_BOOKS, 3), [data]);
  if (!books.length) return <Placeholder name="library" />;
  return (
    <View style={styles.shelf}>
      {books.map((book, index) => (
        <View key={String(book.ContentID ?? index)} style={styles.cover}>
          <CoverImage book={book} />
        </View>
      ))}
    </View>
  );
}

function MuralPreview() {
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const murals = useMurals();
  const library = useLibrary();
  const gallery = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });
  const tierlists = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists });
  const mural = latestMural(murals.data ?? []);
  if (!mural) return <Placeholder name="murals" />;
  if (mural.coverImageUrl) return <Image source={{ uri: mural.coverImageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />;
  if (!mural.blocks.length) return <Placeholder name="murals" />;
  return (
    <MuralThumbnail
      mural={mural}
      canvasWidth={width - spacing.sm * 2}
      books={library.data?.data.books ?? []}
      groups={library.data?.data.groups ?? []}
      images={gallery.data ?? []}
      tierlists={tierlists.data ?? []}
      profile={user?.username ? { username: user.username, avatarUrl: user.avatarId ? `${API_URL}/auth/avatar/${user.avatarId}/file` : null } : undefined}
    />
  );
}

function ReaderCardPreview() {
  const { user } = useAuth();
  const { data: library } = useLibrary();
  const own = useOwnCardStyle();
  const books = library?.data.books ?? NO_BOOKS;
  const groups = library?.data.groups ?? NO_GROUPS;
  const input = useMemo(() => (own ? readerCardInputOf(books, groups, user?.username ?? "reader", undefined, own) : null), [books, groups, user?.username, own]);
  if (!input) return <Placeholder name="profile" />;
  return <ReaderCardImage input={input} width={READER_CARD_WIDTH} />;
}

function GalleryPreview() {
  const gallery = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });
  const images = gallery.data?.slice(0, 4) ?? [];
  if (!images.length) return <Placeholder name="image" />;
  return (
    <View style={styles.gallery}>
      {images.map((image) => (
        <Image key={image.id} source={{ uri: image.url }} style={styles.tile} contentFit="cover" />
      ))}
    </View>
  );
}

export const CARDS: ReadonlyArray<{ label: string; href: string; Preview: ComponentType }> = [
  { label: "Your shelf", href: "/me", Preview: ShelfPreview },
  { label: "Murals", href: "/murals", Preview: MuralPreview },
  { label: "Reader card", href: "/reader-card", Preview: ReaderCardPreview },
  { label: "Gallery", href: "/gallery", Preview: GalleryPreview },
];

const styles = StyleSheet.create({
  shelf: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row", alignItems: "flex-end", gap: spacing.xs, padding: spacing.md },
  cover: { flex: 1, aspectRatio: 2 / 3, borderRadius: radii.sm, overflow: "hidden" },
  gallery: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, padding: spacing.md },
  tile: { width: "48%", flexGrow: 1, height: "48%", borderRadius: radii.sm },
});
