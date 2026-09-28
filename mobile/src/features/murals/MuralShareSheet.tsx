import { useEffect, useState } from "react";
import type { Group, Mural, ReaderProfile } from "@scripta/shared";
import { View } from "react-native";
import { Text } from "../../ui/Text";
import { Button } from "../../ui";
import { spacing, typography, useTheme } from "../../ui/theme";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import type { GalleryImage } from "../gallery/api";
import type { Tierlist } from "../tierlists/api";
import { MuralCanvas } from "./MuralCanvas";

export function MuralShareSheet({ mural, books, groups, images, tierlists, profile, onClose, onEnableLink, onDisableLink, draft = false, contentReady = true, contentError, onRetryContent }: {
  mural: Mural | null;
  books: Array<Record<string, unknown>>;
  groups: Group[];
  images: GalleryImage[];
  tierlists: Tierlist[];
  profile?: ReaderProfile;
  onClose: () => void;
  onEnableLink: () => Promise<string | void>;
  onDisableLink: () => Promise<void>;
  draft?: boolean;
  contentReady?: boolean;
  contentError?: string;
  onRetryContent: () => void;
}) {
  const { colors } = useTheme();
  const [imageReady, setImageReady] = useState(false);
  useEffect(() => { setImageReady(false); }, [mural?.id]);
  return <ContentShareSheet
    visible={mural !== null}
    onClose={onClose}
    title={mural?.name ?? "Mural"}
    description={draft ? "Image includes your unsaved changes. A public link shows the saved mural; creating one saves these changes first." : undefined}
    url={mural?.shareUrl}
    onEnableLink={onEnableLink}
    enableLinkLabel="Create public link"
    onDisableLink={onDisableLink}
    imageReady={contentReady && !contentError && imageReady}
    previewControls={contentError ? <View style={{ gap: spacing.sm }}><Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{contentError}</Text><Button label="Retry preview" variant="secondary" onPress={onRetryContent} /></View> : undefined}
  >
    {mural ? <View style={{ backgroundColor: colors.background, padding: spacing.sm }}><MuralCanvas mural={mural} books={books} groups={groups} images={images} tierlists={tierlists} profile={profile} onImageReadyChange={setImageReady} /></View> : null}
  </ContentShareSheet>;
}
