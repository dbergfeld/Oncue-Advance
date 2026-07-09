import { useState } from "react";
import { Link } from "react-router-dom";
import { useShow } from "../context/ShowContext";
import { StatCard } from "../components/ui/StatCard";
import { StatusBadge, StatusDot } from "../components/ui/StatusBadge";
import { Card, CardHeader } from "../components/ui/Card";
import { Icon } from "../components/ui/icons";
import { formatDate } from "../utils/format";
import { missingCriticalItems, overallCompletion, requirementsByDepartment } from "../utils/completion";
import { DEPARTMENT_LABEL } from "../utils/status";
import { api } from "../api/client";
import type { RecordStatus, RiskEngineResult } from "../types";

function fieldStatus(value: string): RecordStatus {
  return value.trim().length > 0 ? "CONFIRMED" : "MISSING";
}

const RISK_LEVEL_COLOR: Record<RiskEngineResult["riskLevel"], string> = {
  low: "text-status-confirmed",
  medium: "text-status-review",
  high: "text-orange-400",
  critical: "text-status-missing",
};

export function Dashboard() {
  const { selectedShow, refreshSelectedShow } = useShow();
  const [risk, setRisk] = useState<RiskEngineResult | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState<{ message: string; code?: string } | null>(null);

  if (!selectedShow) {
    return <p className="text-sm text-neutral-500">No show selected.</p>;
  }

  const show = selectedShow;
  const completion = overallCompletion(show);
  const missing = missingCriticalItems(show);
  const departments = requirementsByDepartment(show.requirements);
  const videoDept = departments.find((d) => d.department === "VIDEO");
  const riggingDept = departments.find((d) => d.department === "RIGGING");
  const productionDept = departments.find((d) => d.department === "PRODUCTION");
  const openIssues = show.issues.filter((i) => i.status === "OPEN" || i.status === "IN_PROGRESS");
  const lastRisk = risk ?? (show.riskSummary as RiskEngineResult | null);

  async function runRiskAnalysis() {
    setRiskLoading(true);
    setRiskError(null);
    try {
      const result = await api.runRiskAnalysis(show.id);
      setRisk(result);
      await refreshSelectedShow();
    } catch (err) {
      const e = err as Error & { code?: string };
      setRiskError({ message: e.message, code: e.code });
    } finally {
      setRiskLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-accent">Show Dashboard</p>
          <h1 className="mt-1 text-xl font-semibold text-neutral-50">
            {show.venue?.name || "Venue TBD"} — {show.city}, {show.state}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">{formatDate(show.date)}</p>
        </div>
        <Link to="/shows" className="rounded-md border border-surface-border px-3 py-1.5 text-xs text-neutral-300 hover:border-accent/40 hover:text-accent">
          Switch Show
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Venue" value={show.venue?.name || "—"} sublabel="Venue name" />
        <StatCard label="City / State" value={`${show.city}, ${show.state}`} />
        <StatCard label="Show Date" value={formatDate(show.date)} />
        <StatCard label="Advance Complete" value={`${completion}%`} status={completion >= 100 ? "CONFIRMED" : completion > 0 ? "NEEDS_REVIEW" : "NOT_STARTED"} />

        <StatCard label="Load-In" value={show.loadIn || "TBD"} />
        <StatCard label="Doors" value={show.doors || "TBD"} />
        <StatCard label="Show Time" value={show.showTime || "TBD"} />
        <StatCard label="Curfew" value={show.curfew || "TBD"} />

        <StatCard label="Crew Count" value={show.crewCount} sublabel="Touring roster" />
        <StatCard label="Open Issues" value={openIssues.length} status={openIssues.length > 0 ? "MISSING" : "CONFIRMED"} />
        <StatCard label="Dock / Truck Access" value={<StatusBadge status={fieldStatus(show.venue?.dockAccess ?? "")} />} />
        <StatCard label="FOH Cable Path" value={<StatusBadge status={fieldStatus(show.venue?.fohCablePath ?? "")} />} />

        <StatCard label="Video Dept." value={<StatusBadge status={videoDept?.status ?? "NOT_STARTED"} />} sublabel={videoDept ? `${videoDept.percent}% confirmed` : undefined} />
        <StatCard label="Rigging Dept." value={<StatusBadge status={riggingDept?.status ?? "NOT_STARTED"} />} sublabel={riggingDept ? `${riggingDept.percent}% confirmed` : undefined} />
        <StatCard label="Production Dept." value={<StatusBadge status={productionDept?.status ?? "NOT_STARTED"} />} sublabel={productionDept ? `${productionDept.percent}% confirmed` : undefined} />
        <StatCard label="Advance Owner" value={show.advanceOwner?.name || "Unassigned"} />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader title="Missing Critical Items" subtitle={missing.length === 0 ? "Advance is fully clean for this show" : `${missing.length} item(s) blocking a clean advance`} />
          {missing.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-status-confirmed">
              <Icon name="check" className="h-4 w-4" />
              Nothing outstanding — this show is ready to travel.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {missing.slice(0, 8).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-neutral-300">
                  <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-missing" />
                  {item}
                </li>
              ))}
              {missing.length > 8 && <li className="pl-5 text-xs text-neutral-500">+{missing.length - 8} more — see right panel</li>}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent Notes" subtitle="Most recent advance notes" />
          {show.comments.length === 0 ? (
            <p className="text-sm text-neutral-500">No notes logged for this show.</p>
          ) : (
            <ul className="space-y-3">
              {[...show.comments]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 3)
                .map((note) => (
                  <li key={note.id} className="border-l-2 border-accent/40 pl-3">
                    <p className="text-[11px] uppercase tracking-wide text-neutral-500">{note.category.replace(/_/g, " ")}</p>
                    <p className="text-sm text-neutral-300">{note.body}</p>
                    <p className="mt-0.5 text-xs text-neutral-600">{note.author?.name ?? "Unassigned"}</p>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <div className="flex items-start justify-between">
          <CardHeader title="AI Risk Analysis" subtitle="Senior Touring Production Coordinator persona — reasons over the data above, never invents facts" />
          <button
            onClick={runRiskAnalysis}
            disabled={riskLoading}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface hover:bg-accent-dim disabled:opacity-50"
          >
            <Icon name="signal" className="h-3.5 w-3.5" />
            {riskLoading ? "Analyzing…" : lastRisk ? "Re-run Analysis" : "Run Risk Analysis"}
          </button>
        </div>

        {riskError && (
          <div className="rounded-md border border-status-missing/30 bg-status-missing/5 p-3 text-sm text-status-missing">
            {riskError.code === "AI_NOT_CONFIGURED" ? (
              <>
                AI Risk Analysis isn't configured. Set <code className="text-neutral-300">ANTHROPIC_API_KEY</code> in{" "}
                <code className="text-neutral-300">server/.env</code> and restart the API server — see Settings.
              </>
            ) : (
              riskError.message
            )}
          </div>
        )}

        {!riskError && lastRisk && (
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1">
              <p className="oc-label">Risk Score</p>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold ${RISK_LEVEL_COLOR[lastRisk.riskLevel]}`}>{lastRisk.riskScore}</span>
                <span className="text-xs text-neutral-500">/100 · {lastRisk.riskLevel}</span>
              </div>
              <p className="mt-1 text-xs text-neutral-600">Confidence {Math.round(lastRisk.confidence * 100)}%</p>
              <p className="mt-3 text-sm text-neutral-300">{lastRisk.summary}</p>
            </div>

            <div className="col-span-1">
              <p className="oc-label">Recommendations</p>
              <ul className="space-y-1.5">
                {lastRisk.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-neutral-300">
                    <StatusDot status="MISSING" className="mt-1 shrink-0" />
                    {r}
                  </li>
                ))}
                {lastRisk.recommendations.length === 0 && <li className="text-xs text-neutral-600">None</li>}
              </ul>
            </div>

            <div className="col-span-1">
              <p className="oc-label">Suggested Questions for Venue/Vendor</p>
              <ul className="space-y-1.5">
                {lastRisk.suggestedQuestions.map((q, i) => (
                  <li key={i} className="text-xs text-neutral-300">
                    <span className="mr-1 text-accent">Q.</span>
                    {q}
                  </li>
                ))}
                {lastRisk.suggestedQuestions.length === 0 && <li className="text-xs text-neutral-600">None</li>}
              </ul>
            </div>

            <div className="col-span-3 border-t border-surface-border pt-3">
              <p className="oc-label">Department Health (computed, not AI-judged)</p>
              <div className="grid grid-cols-3 gap-2">
                {lastRisk.departmentHealth.map((d) => (
                  <div key={d.department} className="rounded-md border border-surface-border p-2 text-xs">
                    <p className="font-medium text-neutral-200">{DEPARTMENT_LABEL[d.department as keyof typeof DEPARTMENT_LABEL] ?? d.department}</p>
                    <p className="text-neutral-500">{d.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {!riskError && !lastRisk && !riskLoading && (
          <p className="text-sm text-neutral-500">No risk analysis run yet for this show.</p>
        )}
      </Card>
    </div>
  );
}
