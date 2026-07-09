import { z } from "zod";
import { prisma } from "../../prisma.js";
import { callStructured, isAIServiceConfigured, AIServiceNotConfiguredError } from "./AIService.js";
import type { DepartmentHealth, DepartmentHealthStatus, RiskEngineResult } from "./types.js";

/**
 * RiskEngine reasons about a Show's readiness the way a Senior Touring
 * Production Coordinator would: it does NOT ask the model to compute
 * completion percentages (that's exact, deterministic arithmetic — we do it
 * in code, see computeDepartmentHealth below) — it asks the model to do the
 * part only judgment is good at: prioritizing what matters, writing venue
 * questions, and producing a risk score that weighs severity, dependencies,
 * and time-until-show together. The model is explicitly instructed not to
 * fabricate facts beyond what's provided.
 */

const MODEL_RESPONSE_SCHEMA = z.object({
  riskScore: z.number().min(0).max(100),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  recommendations: z.array(z.string()).max(8),
  suggestedQuestions: z.array(z.string()).max(8),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});

function statusForHealth(percentComplete: number, missingCount: number): DepartmentHealthStatus {
  if (missingCount > 0 && percentComplete < 50) return "blocked";
  if (percentComplete >= 100) return "on-track";
  if (percentComplete === 0) return "not-started";
  return "at-risk";
}

function computeDepartmentHealth(
  requirements: Array<{ department: string; status: string; required: boolean }>
): DepartmentHealth[] {
  const byDept = new Map<string, typeof requirements>();
  for (const req of requirements) {
    const list = byDept.get(req.department) ?? [];
    list.push(req);
    byDept.set(req.department, list);
  }

  return Array.from(byDept.entries()).map(([department, reqs]) => {
    const confirmed = reqs.filter((r) => r.status === "CONFIRMED").length;
    const missingCount = reqs.filter((r) => r.required && r.status === "MISSING").length;
    const percentComplete = reqs.length === 0 ? 0 : Math.round((confirmed / reqs.length) * 100);
    return {
      department,
      percentComplete,
      status: statusForHealth(percentComplete, missingCount),
      missingCount,
      summary: `${confirmed}/${reqs.length} requirements confirmed${missingCount > 0 ? `, ${missingCount} missing` : ""}.`,
    };
  });
}

export async function analyzeShow(showId: string): Promise<RiskEngineResult> {
  if (!isAIServiceConfigured()) throw new AIServiceNotConfiguredError();

  const show = await prisma.show.findUnique({
    where: { id: showId },
    include: {
      venue: true,
      tour: true,
      requirements: true,
      issues: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } } },
      timelineEntries: { include: { stage: true } },
    },
  });
  if (!show) throw new Error(`Show ${showId} not found`);

  const departmentHealth = computeDepartmentHealth(show.requirements);
  const missingCriticalItems = show.requirements
    .filter((r) => r.required && (r.status === "MISSING" || r.status === "NEEDS_REVIEW"))
    .map((r) => `${r.department}: ${r.name}${r.status === "MISSING" ? " (missing)" : " (needs review)"}`);
  const openBlockers = show.issues
    .filter((i) => i.severity === "CRITICAL" || i.severity === "MAJOR")
    .map((i) => `${i.department ?? "General"}: ${i.title} (${i.severity.toLowerCase()})`);
  const blockedStages = show.timelineEntries.filter((e) => e.status === "BLOCKED").map((e) => e.stage.label);

  const daysUntilShow = Math.round((show.date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  const prompt = `
Show: ${show.city}, ${show.state} — ${show.date.toISOString().slice(0, 10)} (${daysUntilShow} days from now)
Venue: ${show.venue?.name ?? "Not yet assigned"}
Tour: ${show.tour.artist} — ${show.tour.name}

Department health (computed, exact):
${departmentHealth.map((d) => `- ${d.department}: ${d.percentComplete}% complete, status=${d.status}, ${d.summary}`).join("\n") || "(no requirements recorded yet)"}

Missing / needs-review critical requirements (computed, exact):
${missingCriticalItems.map((m) => `- ${m}`).join("\n") || "(none)"}

Open blocker-severity issues (computed, exact):
${openBlockers.map((b) => `- ${b}`).join("\n") || "(none)"}

Timeline stages currently BLOCKED (computed, exact):
${blockedStages.map((s) => `- ${s}`).join("\n") || "(none)"}

Using ONLY the data above, produce a risk assessment. Do not invent venue details, contacts, or requirements that are not listed. If the data is too sparse to assess confidently, say so directly in the summary and lower your confidence score accordingly.
`.trim();

  const system = `You are a Senior Touring Production Coordinator reviewing a show's advance readiness for a touring video department. You are precise, terse, and operational — you write like someone who has advanced hundreds of shows, not like a chatbot. You weigh how many days remain before the show, the severity of open blockers, and how many required items are missing or unconfirmed when assigning a risk score (0 = fully ready, 100 = show is at serious risk). Respond with ONLY a single JSON object, no prose before or after, matching exactly this shape:
{
  "riskScore": number (0-100),
  "riskLevel": "low" | "medium" | "high" | "critical",
  "recommendations": string[] (up to 8, specific and actionable, e.g. "Escalate rigging plot request to house head rigger — 5 days out with no plot is a blocker"),
  "suggestedQuestions": string[] (up to 8, questions to send the venue or vendor to close the gaps found above),
  "summary": string (2-4 sentences, the kind of note you'd leave for the Video Director),
  "confidence": number (0-1, your own confidence in this assessment given how complete the input data is)
}`;

  const raw = await callStructured({ system, prompt, maxTokens: 1600 });
  const parsed = MODEL_RESPONSE_SCHEMA.parse(raw);

  const result: RiskEngineResult = {
    showId,
    riskScore: parsed.riskScore,
    riskLevel: parsed.riskLevel,
    departmentHealth,
    missingCriticalItems,
    openBlockers: [...openBlockers, ...blockedStages.map((s) => `Timeline: ${s} is blocked`)],
    recommendations: parsed.recommendations,
    suggestedQuestions: parsed.suggestedQuestions,
    summary: parsed.summary,
    confidence: parsed.confidence,
    generatedAt: new Date().toISOString(),
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  };

  await prisma.show.update({
    where: { id: showId },
    data: { riskScore: result.riskScore, riskSummary: result as never, riskAnalyzedAt: new Date() },
  });

  return result;
}
