import { useState, type ReactElement } from "react";
import { usePreventRemove } from "expo-router/react-navigation";
import { useT } from "../i18n";
import { ConfirmDialog } from "./components";

type Copy = { title: string; body: string; confirmLabel: string; cancelLabel: string };

export function useUnsavedChangesGuard(unsaved: boolean, copy?: Copy): ReactElement {
  const t = useT();
  const shown = copy ?? { title: t("shell.discardChangesTitle"), body: t("shell.discardChangesBody"), confirmLabel: t("shell.discard"), cancelLabel: t("shell.keepEditing") };
  const [repeat, setRepeat] = useState<(() => void) | null>(null);
  usePreventRemove(unsaved, (event) => setRepeat(() => event.repeat));
  return <ConfirmDialog
    visible={repeat !== null}
    title={shown.title}
    body={shown.body}
    confirmLabel={shown.confirmLabel}
    cancelLabel={shown.cancelLabel}
    destructive
    onConfirm={() => { const leave = repeat; setRepeat(null); leave?.(); }}
    onCancel={() => setRepeat(null)}
  />;
}
