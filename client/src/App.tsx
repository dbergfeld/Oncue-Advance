import { Routes, Route } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { TourStops } from "./pages/TourStops";
import { VenueInfo } from "./pages/VenueInfo";
import { Schedule } from "./pages/Schedule";
import { VideoPackage } from "./pages/VideoPackage";
import { Labor } from "./pages/Labor";
import { Power } from "./pages/Power";
import { Rigging } from "./pages/Rigging";
import { Signal } from "./pages/Signal";
import { Documents } from "./pages/Documents";
import { Notes } from "./pages/Notes";
import { Settings } from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tour-stops" element={<TourStops />} />
        <Route path="/venue" element={<VenueInfo />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/video-package" element={<VideoPackage />} />
        <Route path="/labor" element={<Labor />} />
        <Route path="/power" element={<Power />} />
        <Route path="/rigging" element={<Rigging />} />
        <Route path="/signal" element={<Signal />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
