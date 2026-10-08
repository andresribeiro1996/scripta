import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ownGlyphPreview, readerIdentity, saveFailureMessage, type Group } from "@scripta/shared";
import { DEFAULT_FEED_SETTINGS, type OwnProfile } from "@scripta/shared/community";
import { fetchOwnProfile, updateFeedSettings } from "../../api/community";
import { ReaderGlyph } from "../ReaderGlyph";
import { useToast } from "../Toaster";
import { ToggleSwitch } from "../ToggleSwitch";

const OWN_PROFILE_KEY = ["community", "own-profile"] as const;
const LABEL = "Show my reader glyph next to my name";

export function ReaderGlyphSetting({ username, books, groups }: { username: string; books: Array<Record<string, unknown>>; groups: Group[] }) {
  const client = useQueryClient();
  const toast = useToast();
  const { data: profile } = useQuery({ queryKey: OWN_PROFILE_KEY, queryFn: fetchOwnProfile });
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => ownGlyphPreview(readerIdentity(books, groups)), [books, groups]);
  const settings = profile?.feedSettings ?? DEFAULT_FEED_SETTINGS;

  const toggle = async (readerGlyph: boolean) => {
    if (!profile) return;
    setBusy(true);
    client.setQueryData<OwnProfile>(OWN_PROFILE_KEY, { ...profile, feedSettings: { ...settings, readerGlyph } });
    try {
      await updateFeedSettings({ ...settings, readerGlyph });
      void client.invalidateQueries({ queryKey: ["community", "profile", username] });
    } catch (error) {
      client.setQueryData<OwnProfile>(OWN_PROFILE_KEY, profile);
      toast({ message: saveFailureMessage(error, "Couldn't save the glyph setting."), kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{LABEL}</h3>
        <ToggleSwitch checked={settings.readerGlyph ?? false} disabled={!profile || busy} label={LABEL} onChange={(next) => void toggle(next)} />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-(--color-text-dim)">
        <span aria-hidden="true"><ReaderGlyph identity={preview.glyph ?? undefined} /></span>
        {preview.line}
      </p>
      {profile && !profile.published ? <p className="mt-1 text-xs text-(--color-text-dim)">It shows once your shelf is published.</p> : null}
    </section>
  );
}
