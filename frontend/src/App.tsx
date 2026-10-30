import { AccountActionPage } from "./pages/AccountActionPage";
import { DailyChapterPage } from "./pages/DailyChapterPage";
import { AdminDailyChapterPage } from "./pages/AdminDailyChapterPage";
import { HomePage } from "./pages/HomePage";
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireUsername } from "./auth/RequireUsername";
import { EdgeSwipeBack } from "./components/EdgeSwipeBack";
import { PublicLayout } from "./layouts/PublicLayout";
import { SessionLayout } from "./layouts/SessionLayout";
import { useAuth } from "./auth/AuthContext";
import { ArenaListPage } from "./pages/ArenaListPage";
import { TierListCreatePage } from "./pages/TierListCreatePage";
import { ArenaSeedPage } from "./pages/ArenaSeedPage";
import { ArenaViewPage } from "./pages/ArenaViewPage";
import { WorkPage } from "./pages/WorkPage";
import { WorkStatsPage } from "./pages/WorkStatsPage";
import { CharacterGamePage } from "./pages/CharacterGamePage";
import { QuizCreatePage } from "./pages/QuizCreatePage";
import { QuizEditorPage } from "./pages/QuizEditorPage";
import { ChooseUsernamePage } from "./pages/ChooseUsernamePage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { CommunityProfilePage } from "./pages/CommunityProfilePage";
import { DiscoverPage, PublicDiscoverPage } from "./pages/DiscoverPage";
import { GalleryPage } from "./pages/GalleryPage";
import { LandingPage } from "./pages/LandingPage";
import { BookKeyPage } from "./pages/BookKeyPage";
import { LibraryPage } from "./pages/LibraryPage";
import { SettingsAppearancePage } from "./pages/SettingsAppearancePage";
import { LibraryStylePage } from "./pages/LibraryStylePage";
import { LoginPage } from "./pages/LoginPage";
import { MuralEditorPage } from "./pages/MuralEditorPage";
import { MuralsListPage } from "./pages/MuralsListPage";
import { AdminGenresPage } from "./pages/AdminGenresPage";
import { AdminSynopsesPage } from "./pages/AdminSynopsesPage";
import { AdminTranslationsPage } from "./pages/AdminTranslationsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlayQuizPage } from "./pages/PlayQuizPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { OAuthSuccessPage } from "./pages/OAuthSuccessPage";
import { PeoplePage } from "./pages/PeoplePage";
import { ReaderCardPage } from "./pages/ReaderCardPage";
import { SeriesPage } from "./pages/SeriesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SharedLibraryPage } from "./pages/SharedLibraryPage";
import { SharedMuralPage } from "./pages/SharedMuralPage";
import { TierListEditorPage } from "./pages/TierListEditorPage";
import { WelcomeAvatarPage } from "./pages/WelcomeAvatarPage";
import { VoteTierlistPage } from "./pages/VoteTierlistPage";

function PublicRoutesLayout() {
  const { session } = useAuth();
  return <PublicLayout signedIn={Boolean(session)} />;
}

export function App() {
  return (
    <>
      <EdgeSwipeBack />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/forgot-password" element={<AccountActionPage key="forgot" action="forgot" />} />
        <Route path="/reset-password" element={<AccountActionPage key="reset" action="reset" />} />
        <Route path="/verify-email" element={<AccountActionPage key="verify" action="verify" />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/oauth-success" element={<OAuthSuccessPage />} />
        <Route element={<SessionLayout />}>
          <Route path="/arena/:id" element={<ArenaViewPage />} />
          <Route path="/work/:id" element={<WorkPage />} />
          <Route path="/work/:id/stats" element={<WorkStatsPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<RequireUsername />}>
              <Route path="/book/:key" element={<BookKeyPage />} />
              <Route path="/work/:id/characters" element={<CharacterGamePage />} />
              <Route path="/dashboard" element={<HomePage />} />
              <Route path="/dashboard/library" element={<LibraryPage />} />
              <Route path="/dashboard/series" element={<SeriesPage />} />
              <Route path="/dashboard/collections" element={<CollectionsPage />} />
              <Route path="/dashboard/gallery" element={<GalleryPage />} />
              <Route path="/dashboard/murals" element={<MuralsListPage />} />
              <Route path="/dashboard/murals/:muralId" element={<MuralEditorPage />} />
              <Route path="/dashboard/arena" element={<ArenaListPage />} />
              <Route path="/dashboard/arena/tierlist/new" element={<TierListCreatePage />} />
              <Route path="/dashboard/arena/tierlist/:id" element={<TierListEditorPage />} />
              <Route path="/dashboard/arena/quiz/new" element={<QuizCreatePage />} />
              <Route path="/dashboard/arena/quiz/:id" element={<QuizEditorPage />} />
              <Route path="/dashboard/arena/:id/seed" element={<ArenaSeedPage />} />
              <Route path="/dashboard/style" element={<LibraryStylePage />} />
              <Route path="/dashboard/settings" element={<SettingsPage />} />
              <Route path="/dashboard/settings/appearance" element={<SettingsAppearancePage />} />
              <Route path="/dashboard/reader-card" element={<ReaderCardPage />} />
              <Route path="/admin/daily-chapter" element={<AdminDailyChapterPage />} />
              <Route path="/admin/genres" element={<AdminGenresPage />} />
              <Route path="/admin/synopses" element={<AdminSynopsesPage />} />
              <Route path="/admin/translations" element={<AdminTranslationsPage />} />
              <Route path="/community" element={<Navigate to="/dashboard" replace />} />
              <Route path="/community/discover" element={<DiscoverPage />} />
              <Route path="/community/people" element={<PeoplePage />} />
              <Route path="/community/u/:username" element={<CommunityProfilePage />} />
            </Route>
          </Route>
        </Route>

        {/* Pages a stranger with the link can open. The token or code is the
            access control (see each public backend route's own comment);
            nobody is asked for an account, and a signed-in visitor just
            sees "Open my library" instead of "Log in". */}
        <Route element={<PublicRoutesLayout />}>
          <Route path="/arena" element={<PublicDiscoverPage />} />
          <Route path="/shared/murals/:token" element={<SharedMuralPage />} />
          <Route path="/shared/library/:token" element={<SharedLibraryPage />} />
          <Route path="/vote/:code" element={<VoteTierlistPage />} />
          <Route path="/daily" element={<DailyChapterPage />} />
          <Route path="/play/:code" element={<PlayQuizPage />} />
        </Route>

        {/* /choose-username and /welcome-avatar need a session but NOT a
            username yet (a password signup goes straight to the avatar
            step; a Google signup passes through choose-username first),
            so they sit under RequireAuth alone. */}
        <Route element={<RequireAuth />}>
          <Route path="/choose-username" element={<ChooseUsernamePage />} />
          <Route path="/welcome-avatar" element={<WelcomeAvatarPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
