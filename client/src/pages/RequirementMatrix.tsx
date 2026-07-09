import { useCallback, useEffect, useMemo, useState } from "react";
import { useShow } from "../context/ShowContext";
import { useUsers } from "../context/UserContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { ProgressBar } from "../components/ui/ProgressBar";
import { StatusSelect } from "../components/ui/StatusSelect";
import { CommentThread } from "../components/collab/CommentThread";
import { AttachmentList } from "../components/collab/AttachmentList";
import { Icon } from "../components/ui/icons";
import { requirementsByDepartment, requirementsCompletion } from "../utils/completion";
import { DEPARTMENT_LABEL, PRIORITY_CLASSES, PRIORITY_LABEL } from "../utils/status";
import { api } from "../api/client";
import type { Department, EntityAttachment, EntityComment, Priority, Requirement } from "../types";

const DEPARTMENT_ORDER: Department[] = ["VIDEO", "LIGHTING", "AUDIO", "RIGGING", "AUTOMATION", "BACKLINE", "PRODUCTION", "MERCH", "TRANSPORTATION"];
const PRIORITY_OPTIONS: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function RequirementMatrix() {
  const { selectedShow, refreshSelectedShow } = useShow();
  const { users } = useUsers();
  const [openId, setOpenId] = useState<string | null>(null);
  const [newReqDept, setNewReqDept] = useState<Department>("VIDEO");
  const [newReqName, setNewReqName] = useState("");

  const health = useMemo(() => (selectedShow ? requirementsByDepartment(selectedShow.requirements) : []), [selectedShow]);
  const overall = useMemo(() => (selectedShow ? requirementsCompletion(selectedShow.requirements) : { percent: 0, status: "NOT_STARTED" as const }), [selectedShow]);

  if (!selectedShow) return <p className="text-sm text-neutral-500">No show selected.</p>;

  const grouped = new Map<Department, Requirement[]>();
  for (const dept of DEPARTMENT_ORDER) grouped.set(dept, []);
  for (const req of selectedShow.requirements) grouped.get(req.department)?.push(req);

  async function patch(id: string, data: Partial<Requirement>) {
    await api.updateRequirement(id, data);
    await refreshSelectedShow();
  }

  async function addRequirement() {
    if (!newReqName.trim() || !selectedShow) return;
    await api.createRequirement(selectedShow.id, { department: newReqDept, name: newReqName.trim() });
    setNewReqName("");
    await refreshSelectedShow();
  }

  async function removeRequirement(id: string) {
    await api.deleteRequirement(id);
    if (openId === id) setOpenId(null);
    await refreshSelectedShow();
  }

  const openRequirement = selectedShow.requirements.find((r) => r.id === openId) ?? null;

  return (
    <div>
      <PageHeader
        title="Requirement Matrix"
        description="Every department's requirements for this show — confirmation status, ownership, and risk."
        status={overall.status}
        percent={overall.percent}
      />

      <div className="mb-4 grid grid-cols-4 gap-3">
        {health.slice(0, 4).map((d) => (
          <Card key={d.department} padded={true}>
            <p className="oc-label">{DEPARTMENT_LABEL[d.department as Department]}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold text-neutral-50">{d.percent}%</span>
              {d.missing > 0 && <span className="text-xs text-status-missing">{d.missing} missing</span>}
            </div>
            <ProgressBar percent={d.percent} className="mt-2" />
          </Card>
        ))}
      </div>

      <Card padded={false} className="mb-4 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-surface-border p-3">
          <select className="oc-select w-40 py-1.5 text-xs" value={newReqDept} onChange={(e) => setNewReqDept(e.target.value as Department)}>
            {DEPARTMENT_ORDER.map((d) => (
              <option key={d} value={d}>
                {DEPARTMENT_LABEL[d]}
              </option>
            ))}
          </select>
          <input
            className="oc-input flex-1 py-1.5 text-sm"
            placeholder="New requirement name…"
            value={newReqName}
            onChange={(e) => setNewReqName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRequirement()}
          />
          <button onClick={addRequirement} className="flex items-center gap-1.5 rounded-md border border-surface-border px-3 py-1.5 text-xs text-neutral-300 hover:border-accent/40 hover:text-accent">
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      </Card>

      <div className="space-y-4">
        {DEPARTMENT_ORDER.filter((d) => (grouped.get(d)?.length ?? 0) > 0).map((dept) => (
          <Card key={dept} padded={false} className="overflow-hidden">
            <div className="border-b border-surface-border bg-surface-raised/40 px-4 py-2 text-sm font-semibold text-neutral-100">
              {DEPARTMENT_LABEL[dept]}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2 font-medium">Requirement</th>
                  <th className="px-3 py-2 font-medium w-36">Owner</th>
                  <th className="px-3 py-2 font-medium w-28">Priority</th>
                  <th className="px-3 py-2 font-medium w-40">Status</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {grouped.get(dept)!.map((req) => (
                  <tr key={req.id} className="border-b border-surface-border last:border-0 hover:bg-surface-raised/30">
                    <td className="px-3 py-2">
                      <button onClick={() => setOpenId(req.id)} className="text-left font-medium text-neutral-200 hover:text-accent">
                        {req.name}
                      </button>
                      {req.description && <p className="mt-0.5 text-xs text-neutral-500">{req.description}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="oc-select py-1 text-xs"
                        value={req.ownerId ?? ""}
                        onChange={(e) => patch(req.id, { ownerId: e.target.value || null })}
                      >
                        <option value="">Unassigned</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={`oc-select py-1 text-xs ${PRIORITY_CLASSES[req.priority]}`}
                        value={req.priority}
                        onChange={(e) => patch(req.id, { priority: e.target.value as Priority })}
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {PRIORITY_LABEL[p]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <StatusSelect value={req.status} onChange={(v) => patch(req.id, { status: v, confirmed: v === "CONFIRMED" })} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => removeRequirement(req.id)} className="text-xs text-neutral-600 hover:text-status-missing">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>

      {openRequirement && (
        <RequirementDrawer
          requirement={openRequirement}
          onClose={() => setOpenId(null)}
          onPatch={(data) => patch(openRequirement.id, data)}
          onRefresh={refreshSelectedShow}
        />
      )}
    </div>
  );
}

function RequirementDrawer({
  requirement,
  onClose,
  onPatch,
  onRefresh,
}: {
  requirement: Requirement;
  onClose: () => void;
  onPatch: (data: Partial<Requirement>) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<{ comments: EntityComment[]; attachments: EntityAttachment[] } | null>(null);

  const loadDetail = useCallback(async () => {
    const full = await api.getRequirement(requirement.id);
    setDetail({ comments: full.comments, attachments: full.attachments });
  }, [requirement.id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div className="oc-scrollbar h-full w-[440px] overflow-y-auto border-l border-surface-border bg-surface-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">{DEPARTMENT_LABEL[requirement.department]}</p>
            <h2 className="text-base font-semibold text-neutral-50">{requirement.name}</h2>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="oc-label">Description</span>
            <textarea className="oc-textarea" defaultValue={requirement.description} rows={2} onBlur={(e) => e.target.value !== requirement.description && onPatch({ description: e.target.value })} />
          </label>
          <label className="block">
            <span className="oc-label">Provided By</span>
            <input className="oc-input" defaultValue={requirement.providedBy} onBlur={(e) => e.target.value !== requirement.providedBy && onPatch({ providedBy: e.target.value })} />
          </label>
          <label className="block">
            <span className="oc-label">Notes</span>
            <textarea className="oc-textarea" defaultValue={requirement.notes} rows={3} onBlur={(e) => e.target.value !== requirement.notes && onPatch({ notes: e.target.value })} />
          </label>
          <label className="block">
            <span className="oc-label">Risk Level</span>
            <select className="oc-select" defaultValue={requirement.riskLevel} onChange={(e) => onPatch({ riskLevel: e.target.value as never })}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </label>
        </div>

        <div className="my-4 border-t border-surface-border" />
        <AttachmentList attachments={detail?.attachments ?? []} />

        <div className="my-4 border-t border-surface-border" />
        <CommentThread
          comments={detail?.comments ?? []}
          onAdd={async (body) => {
            await api.addRequirementComment(requirement.id, body);
            await loadDetail();
            await onRefresh();
          }}
          onDelete={async (id) => {
            await api.deleteComment(id);
            await loadDetail();
            await onRefresh();
          }}
        />
      </div>
    </div>
  );
}
