/**
 * AI Service Layer contracts.
 *
 * UI components and route handlers never call the Anthropic API directly —
 * they call a named service in this directory, which owns its own prompt,
 * its own structured JSON response shape, and its own confidence score.
 *
 * Only RiskEngine is implemented this pass (see RiskEngine.ts). The rest are
 * defined here as real TypeScript contracts so the layer's shape is settled
 * and each is a well-scoped, independently addable unit of work — not
 * implemented with mocked bodies, since a fake "AI" response that never
 * calls a model is more misleading than an interface with no implementation.
 */

/** Every AI service response carries these, regardless of what else it returns. */
export interface AIResponseMeta {
  generatedAt: string;
  model: string;
  /** 0-1. How confident the service is in its own output — surfaced to the user, never hidden. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Implemented
// ---------------------------------------------------------------------------

export type DepartmentHealthStatus = "on-track" | "at-risk" | "blocked" | "not-started";

export interface DepartmentHealth {
  department: string;
  percentComplete: number;
  status: DepartmentHealthStatus;
  missingCount: number;
  summary: string;
}

export interface RiskEngineResult extends AIResponseMeta {
  showId: string;
  riskScore: number; // 0-100, higher = riskier
  riskLevel: "low" | "medium" | "high" | "critical";
  departmentHealth: DepartmentHealth[];
  missingCriticalItems: string[];
  openBlockers: string[];
  recommendations: string[];
  suggestedQuestions: string[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Contracts only — not implemented this pass. Each documents its intended
// input/output shape so implementing it later is a scoped, mechanical task
// rather than a design exercise.
// ---------------------------------------------------------------------------

/** Reads an uploaded venue advance packet (PDF/text) and extracts structured requirements. */
export interface PacketAnalyzerResult extends AIResponseMeta {
  extractedRequirements: Array<{ department: string; name: string; description: string; sourcePage?: number }>;
  missingFromPacket: string[];
  ambiguousItems: Array<{ text: string; reason: string }>;
}

/** Diffs two packet revisions (or two Venue snapshots) and reports what changed. */
export interface PacketComparisonResult extends AIResponseMeta {
  added: string[];
  removed: string[];
  changed: Array<{ field: string; before: string; after: string; impact: "low" | "medium" | "high" }>;
}

/** Given a show's current state, proposes dependency edges between requirements/tasks. */
export interface DependencyEngineResult extends AIResponseMeta {
  edges: Array<{ fromRequirementId: string; toRequirementId: string; reason: string }>;
  cycleWarnings: string[];
}

/** Drafts an outbound email to a venue/vendor contact from structured context. */
export interface EmailGeneratorResult extends AIResponseMeta {
  subject: string;
  body: string;
  toneNotes: string;
}

/** Produces a prose summary of a show, venue, or department for a given audience. */
export interface SummaryGeneratorResult extends AIResponseMeta {
  audience: "crew" | "production-manager" | "promoter" | "venue";
  summary: string;
  keyPoints: string[];
}

/** Pulls structured requirements out of freeform text (emails, call notes). */
export interface RequirementsExtractorResult extends AIResponseMeta {
  requirements: Array<{ department: string; name: string; description: string; confidence: number }>;
}

/** Reads a drawing/CAD export and extracts dimensions, annotations, and revision deltas. */
export interface DrawingAnalyzerResult extends AIResponseMeta {
  dimensions: Array<{ label: string; value: string }>;
  annotations: string[];
  revisionNotes: string[];
}

/** Generic structured extraction from an arbitrary uploaded document. */
export interface DocumentParserResult extends AIResponseMeta {
  documentType: string;
  extractedFields: Record<string, string>;
}
