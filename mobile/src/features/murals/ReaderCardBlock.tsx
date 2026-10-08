import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { readerCardInputOf, type Group, type PublicReaderCard } from "@scripta/shared";
import { coverOf, useReaderCardStyle } from "../readerCard/useReaderCardStyle";
import { PLATE_RATIO, ReaderCardImage } from "./ReaderCardImage";
import { ReaderCardViewer } from "./ReaderCardViewer";

export function ReaderCardBlock({ books, groups, readerName, publicCard, editable }: { books: Array<Record<string, unknown>>; groups: Group[]; readerName: string; publicCard?: PublicReaderCard; editable?: boolean }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const { data: style } = useReaderCardStyle(!publicCard);
  const input = useMemo(() => readerCardInputOf(books, groups, readerName, publicCard, publicCard || !style ? undefined : { style, coverOf }), [books, groups, readerName, publicCard, style]);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox((current) => current.width === width && current.height === height ? current : { width, height });
  };
  const width = Math.max(0, Math.min(box.width, box.height / PLATE_RATIO));
  const image = width > 0 ? <ReaderCardImage input={input} width={width} /> : null;
  return (
    <>
      <View pointerEvents={editable ? "none" : "auto"} onLayout={onLayout} style={styles.plateBox}>
        {editable ? image : <Pressable accessibilityRole="button" accessibilityLabel={input.label} accessibilityHint="Opens the reader card" onPress={() => setOpen(true)} style={{ width, height: width * PLATE_RATIO }}>{image}</Pressable>}
      </View>
      {open ? <ReaderCardViewer input={input} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({ plateBox: { flex: 1, alignItems: "center", justifyContent: "center" } });
