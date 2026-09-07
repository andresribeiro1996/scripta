// The Library tab route — Task 5A owns everything it renders (see
// features/library/LibraryScreen.tsx's own top comment for why Series/
// Collections/Style are in-tab views here rather than separate routes).
import { LibraryScreen } from "../../features/library";
import { useLocalSearchParams } from "expo-router";

export default function LibraryTab() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  return <LibraryScreen initialView={view === "series" || view === "collections" || view === "style" ? view : "browse"} />;
}
