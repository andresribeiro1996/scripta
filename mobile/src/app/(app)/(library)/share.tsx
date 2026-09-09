import { Stack } from "expo-router";
import { ShareSheetBody } from "@/features/library/components/ShareSheet";
import { useLibrary } from "@/features/library/hooks/useLibrary";
import { Screen } from "@/ui";

export default function ShareRoute() {
  const { data: library, share, unshare } = useLibrary();
  const name = library?.data.name || "Library";
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: `Share "${name}"` }} />
      <ShareSheetBody
        title={name}
        shareToken={library?.shareToken ?? null}
        shareUrl={library?.shareUrl ?? null}
        onShare={async () => {
          const updated = await share();
          return { shareToken: updated.shareToken as string, shareUrl: updated.shareUrl as string };
        }}
        onUnshare={async () => {
          await unshare();
        }}
      />
    </Screen>
  );
}
