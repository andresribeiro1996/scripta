import { useState, type ReactElement } from "react";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { ConfirmDialog } from "./components";

type Copy = { title: string; body: string; confirmLabel: string; cancelLabel: string };

const DEFAULT_COPY: Copy = { title: "Discard changes?", body: "Your unsaved changes will be lost.", confirmLabel: "Discard", cancelLabel: "Keep editing" };

export function useUnsavedChangesGuard(unsaved: boolean, copy: Copy = DEFAULT_COPY): ReactElement {
  const navigation = useNavigation();
  const [blocked, setBlocked] = useState<Parameters<typeof navigation.dispatch>[0] | null>(null);
  usePreventRemove(unsaved, ({ data }) => setBlocked(data.action));
  return <ConfirmDialog
    visible={blocked !== null}
    title={copy.title}
    body={copy.body}
    confirmLabel={copy.confirmLabel}
    cancelLabel={copy.cancelLabel}
    destructive
    onConfirm={() => { const action = blocked; setBlocked(null); if (action) navigation.dispatch(action); }}
    onCancel={() => setBlocked(null)}
  />;
}
