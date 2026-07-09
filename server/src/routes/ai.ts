import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { analyzeShow } from "../services/ai/RiskEngine.js";
import { AIServiceNotConfiguredError, AIServiceParseError, isAIServiceConfigured } from "../services/ai/AIService.js";

export const aiRouter = Router();

aiRouter.get(
  "/ai/status",
  asyncHandler(async (_req, res) => {
    res.json({ configured: isAIServiceConfigured() });
  })
);

aiRouter.post(
  "/shows/:id/risk-analysis",
  asyncHandler(async (req, res) => {
    try {
      const result = await analyzeShow(req.params.id);
      res.json(result);
    } catch (err) {
      if (err instanceof AIServiceNotConfiguredError) {
        res.status(503).json({ error: err.message, code: "AI_NOT_CONFIGURED" });
        return;
      }
      if (err instanceof AIServiceParseError) {
        res.status(502).json({ error: err.message, code: "AI_PARSE_ERROR" });
        return;
      }
      throw err;
    }
  })
);
