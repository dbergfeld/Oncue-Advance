import express from "express";
import cors from "cors";
import { readDb, writeDb, resetDb } from "./db.js";
import type { TourStop } from "./types/index.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// GET the full tour + all tour stops
app.get("/api/data", (_req, res) => {
  res.json(readDb());
});

// GET a single tour stop
app.get("/api/tourstops/:id", (req, res) => {
  const db = readDb();
  const stop = db.tourStops.find((s) => s.id === req.params.id);
  if (!stop) {
    res.status(404).json({ error: "Tour stop not found" });
    return;
  }
  res.json(stop);
});

// PUT (replace) a tour stop — client sends the full updated TourStop object.
app.put("/api/tourstops/:id", (req, res) => {
  const db = readDb();
  const idx = db.tourStops.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: "Tour stop not found" });
    return;
  }

  const updated: TourStop = {
    ...req.body,
    id: db.tourStops[idx].id,
    tourId: db.tourStops[idx].tourId,
    lastUpdated: new Date().toISOString(),
  };

  db.tourStops[idx] = updated;
  writeDb(db);
  res.json(updated);
});

// Reset the JSON store back to seed data — convenience for demoing Phase 1.
app.post("/api/reset", (_req, res) => {
  res.json(resetDb());
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`OnCue: Advance API listening on http://localhost:${PORT}`);
});
