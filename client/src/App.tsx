import { Routes, Route } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { Shows } from "./pages/Shows";
import { VenueInfo } from "./pages/VenueInfo";
import { Schedule } from "./pages/Schedule";
import { RequirementMatrix } from "./pages/RequirementMatrix";
import { Issues } from "./pages/Issues";
import { Timeline } from "./pages/Timeline";
import { Documents } from "./pages/Documents";
import { Notes } from "./pages/Notes";
import { Settings } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";
import { useUsers } from "./context/UserContext";
import { isSupabaseConfigured } from "./lib/supabaseClient";

export default function App() {
  const { loading, session } = useUsers();

  if (isSupabaseConfigured) {
    if (loading) return null;
    if (!session) return <SignIn />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/shows" element={<Shows />} />
        <Route path="/venue" element={<VenueInfo />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/requirements" element={<RequirementMatrix />} />
        <Route path="/issues" element={<Issues />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
