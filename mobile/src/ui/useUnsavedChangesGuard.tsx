import { useState, type ReactElement } from "react";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useT } from "../i18n";
import { ConfirmDialog } from "./components";

type Copy = { title: string; body: string; confirmLabel: string; cancelLabel: string };

export function useUnsavedChangesGuard(unsaved: boolean, copy?: Copy): ReactElement {
  const t = useT();
  const shown = copy ?? { title: t("shell.discardChangesTitle"), body: t("shell.discardChangesBody"), confirmLabel: t("shell.discard"), cancelLabel: t("shell.keepEditing") };
  const navigation = useNavigation();
  const [blocked, setBlocked] = useState<Parameters<typeof navigation.dispatch>[0] | null>(null);
  usePreventRemove(unsaved, ({ data }) => setBlocked(data.action));
  return <ConfirmDialog
    visible={blocked !== null}
    title={shown.title}
    body={shown.body}
    confirmLabel={shown.confirmLabel}
    cancelLabel={shown.cancelLabel}
    destructive
    onConfirm={() => { const action = blocked; setBlocked(null); if (action) navigation.dispatch(action); }}
    onCancel={() => setBlocked(null)}
  />;
}
