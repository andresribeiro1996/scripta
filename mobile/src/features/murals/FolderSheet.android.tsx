import { Host, ModalBottomSheet, type ModalBottomSheetRef } from "@expo/ui/jetpack-compose";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../ui";
import type { FolderSheetProps } from "./FolderSheet";

export function FolderSheet({ visible, onClose, children }: FolderSheetProps) {
  const { colors } = useTheme();
  const sheet = useRef<ModalBottomSheetRef>(null);
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    let cancelled = false;
    void sheet.current?.hide().then(() => { if (!cancelled) setMounted(false); });
    return () => { cancelled = true; };
  }, [visible]);
  if (!mounted) return null;
  return <Host style={{ position: "absolute" }} pointerEvents="none"><ModalBottomSheet ref={sheet} onDismissRequest={onClose} skipPartiallyExpanded containerColor={colors.surface} scrimColor={colors.scrim}>{children}</ModalBottomSheet></Host>;
}
