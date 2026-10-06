import { BottomSheet } from "@expo/ui";
import type { ReactNode } from "react";
import { useTheme } from "../../ui";

export type FolderSheetProps = { visible: boolean; onClose: () => void; children: ReactNode };

export function FolderSheet({ visible, onClose, children }: FolderSheetProps) {
  const { colors } = useTheme();
  return <BottomSheet isPresented={visible} onDismiss={onClose} snapPoints={[{ fraction: 0.7 }]} containerColor={colors.surface} contentPadding={0}>{children}</BottomSheet>;
}
