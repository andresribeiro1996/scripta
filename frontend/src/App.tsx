import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireUsername } from "./auth/RequireUsername";
import { EdgeSwipeBack } from "./components/EdgeSwipeBack";
import { DashboardLayout } from "./layouts/DashboardLayout";
import { ArenaListPage } from "./pages/ArenaListPage";
import { ArenaPublicListPage } from "./pages/ArenaPublicListPage";
import { ArenaSeedPage } from "./pages/ArenaSeedPage";
import { ArenaViewPage } from "./pages/ArenaViewPage";
import { ChooseUsernamePage } from "./pages/ChooseUsernamePage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { GalleryPage } from "./pages/GalleryPage";
import { LibraryPage } from "./pages/LibraryPage";
import { LibraryStylePage } from "./pages/LibraryStylePage";
import { LoginPage } from "./pages/LoginPage";
import { MuralEditorPage } from "./pages/MuralEditorPage";
import { MuralsListPage } from "./pages/MuralsListPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OAuthSuccessPage } from "./pages/OAuthSuccessPage";
import { SeriesPage } from "./pages/SeriesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SharedLibraryPage } from "./pages/SharedLibraryPage";
import { SharedMuralPage } from "./pages/SharedMuralPage";
import { TierListEditorPage } from "./pages/TierListEditorPage";
import { WelcomeAvatarPage } from "./pages/WelcomeAvatarPage";
import { VoteTierlistPage } from "./pages/VoteTierlistPage";

export function App() {
  return (
    <>
      <EdgeSwipeBack />
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/oauth-success" element={<OAuthSuccessPage />} />
        <Route path="/arena" element={<ArenaPublicListPage />} />
        <Route path="/arena/:id" element={<ArenaViewPage />} />
        {/* Public share-viewer pages — no session at all, so these must sit
            outside every RequireAuth/RequireUsername wrapper below, same as
            /login. The token itself is the access control (see each public
            backend route's own comment); a stranger with the link never
            needs — and never gets asked for — an account. */}
        <Route path="/shared/murals/:token" element={<SharedMuralPage />} />
        <Route path="/shared/library/:token" element={<SharedLibraryPage />} />
        <Route path="/vote/:code" element={<VoteTierlistPage />} />

        {/* RequireAuth: must be signed in at all. RequireUsername, nested
            inside it: must also have finished setup (a username) — a
            Google sign-in without one yet is routed to /choose-username,
            which itself only needs RequireAuth (not RequireUsername, or
            it'd redirect to itself). /welcome-avatar is the skippable
            avatar step of the signup journey — same placement: it needs a
            session, but NOT a username yet (a password signup goes
            straight here after registering; a Google signup passes
            through choose-username first). */}
        <Route element={<RequireAuth />}>
          <Route path="/choose-username" element={<ChooseUsernamePage />} />
          <Route path="/welcome-avatar" element={<WelcomeAvatarPage />} />

          <Route element={<RequireUsername />}>
            <Route element={<DashboardLayout />}>
              <Route path="/dashboard" element={<LibraryPage />} />
              <Route path="/dashboard/series" element={<SeriesPage />} />
              <Route path="/dashboard/collections" element={<CollectionsPage />} />
              <Route path="/dashboard/gallery" element={<GalleryPage />} />
              <Route path="/dashboard/murals" element={<MuralsListPage />} />
              <Route path="/dashboard/murals/:muralId" element={<MuralEditorPage />} />
              <Route path="/dashboard/arena" element={<ArenaListPage />} />
              <Route path="/dashboard/arena/tierlist/:id" element={<TierListEditorPage />} />
              <Route path="/dashboard/arena/:id/seed" element={<ArenaSeedPage />} />
              <Route path="/dashboard/style" element={<LibraryStylePage />} />
              <Route path="/dashboard/settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
