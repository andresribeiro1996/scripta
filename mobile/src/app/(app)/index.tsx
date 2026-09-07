// The Library tab route — Task 5A owns everything it renders (see
// features/library/LibraryScreen.tsx's own top comment for why Series/
// Collections/Style are in-tab views here rather than separate routes).
import { LibraryScreen } from "../../features/library";

export default function LibraryTab() {
  return <LibraryScreen />;
}
