import "dotenv/config";
import express from "express";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import { actorMiddleware, requireAuth } from "./middleware/auth.js";
import { coreRouter } from "./routes/core.js";
import { requirementsRouter } from "./routes/requirements.js";
import { issuesRouter } from "./routes/issues.js";
import { timelineRouter } from "./routes/timeline.js";
import { scheduleRouter } from "./routes/schedule.js";
import { documentsRouter } from "./routes/documents.js";
import { notesRouter } from "./routes/notes.js";
import { collabRouter } from "./routes/collab.js";
import { aiRouter } from "./routes/ai.js";
import { isAIServiceConfigured } from "./services/ai/AIService.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(actorMiddleware);
app.use("/api", (req, res, next) => (req.method === "GET" ? next() : requireAuth(req, res, next)));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", aiConfigured: isAIServiceConfigured() });
});

app.use("/api", coreRouter);
app.use("/api", requirementsRouter);
app.use("/api", issuesRouter);
app.use("/api", timelineRouter);
app.use("/api", scheduleRouter);
app.use("/api", documentsRouter);
app.use("/api", notesRouter);
app.use("/api", collabRouter);
app.use("/api", aiRouter);

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`OnCue: Advance API listening on http://localhost:${PORT}`);
  if (!isAIServiceConfigured()) {
    console.log("  AI Risk Analysis disabled — set ANTHROPIC_API_KEY in server/.env to enable it.");
  }
});
