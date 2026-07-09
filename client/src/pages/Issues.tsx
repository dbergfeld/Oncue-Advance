import { useCallback, useEffect, useState } from "react";
import { useShow } from "../context/ShowContext";
import { useUsers } from "../context/UserContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { CommentThread } from "../components/collab/CommentThread";
import { AttachmentList } from "../components/collab/AttachmentList";
import { Icon } from "../components/ui/icons";
import { api } from "../api/client";
import { DEPARTMENT_LABEL, ISSUE_SEVERITY_CLASSES, ISSUE_SEVERITY_LABEL, ISSUE_STATUS_DOT, ISSUE_STATUS_LABEL } from "../utils/status";
import { formatDate, formatDateTime } from "../utils/format";
import type { Department, EntityAttachment, EntityComment, Issue, IssueSeverity, IssueStatus } from "../types";

const DEPARTMENT_OPTIONS: Department[] = ["VIDEO", "LIGHTING", "AUDIO", "RIGGING", "AUTOMATION", "BACKLINE", "PRODUCTION", "MERCH", "TRANSPORTATION"];
const SEVERITY_OPTIONS: IssueSeverity[] = ["MINOR", "MODERATE", "MAJOR", "CRITICAL"];
const STATUS_OPTIONS: IssueStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

export function Issues() {
  const { selectedShow, refreshSelectedShow } = useShow();
  const { users } = useUsers();
  const [scope, setScope] = useState<"show" | "all">("show");
  const [allIssues, setAllIssues] = useState<Issue[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDept, setDraftDept] = useState<Department>("VIDEO");
  const [draftSeverity, setDraftSeverity] = useState<IssueSeverity>("MODERATE");

  const loadAll = useCallback(() => {
    api.getIssues().then(setAllIssues);
  }, []);

  useEffect(() => {
    if (scope === "all") loadAll();
  }, [scope, loadAll]);

  if (!selectedShow) return <p className="text-sm text-neutral-500">No show selected.</p>;

  const issues = scope === "show" ? selectedShow.issues : allIssues ?? [];

  async function refresh() {
    await refreshSelectedShow();
    if (scope === "all") loadAll();
  }

  async function patch(id: string, data: Partial<Issue>) {
    await api.updateIssue(id, data);
    await refresh();
  }

  async function createIssue() {
    if (!draftTitle.trim() || !selectedShow) return;
    await api.createIssue({ showId: selectedShow.id, venueId: selectedShow.venueId, title: draftTitle.trim(), department: draftDept, severity: draftSeverity });
    setDraftTitle("");
    setCreating(false);
    await refresh();
  }

  const openIssue = issues.find((i) => i.id === openId) ?? null;

  return (
    <div>
      <PageHeader title="Issues" description="Production issues across venue, department, and vendor problems." />

      <div className="mb-4 flex items-center justify-between">
        <div className="flex rounded-md border border-surface-border p-0.5 text-xs">
          <button onClick={() => setScope("show")} className={`rounded px-3 py-1 ${scope === "show" ? "bg-accent text-surface" : "text-neutral-400"}`}>
            This Show
          </button>
          <button onClick={() => setScope("all")} className={`rounded px-3 py-1 ${scope === "all" ? "bg-accent text-surface" : "text-neutral-400"}`}>
            All Shows
          </button>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-surface-border px-3 py-1.5 text-xs text-neutral-300 hover:border-accent/40 hover:text-accent"
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
          New Issue
        </button>
      </div>

      {creating && (
        <Card className="mb-4">
          <div className="grid grid-cols-4 gap-3">
            <input className="oc-input col-span-2" placeholder="Issue title…" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
            <select className="oc-select" value={draftDept} onChange={(e) => setDraftDept(e.target.value as Department)}>
              {DEPARTMENT_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {DEPARTMENT_LABEL[d]}
                </option>
              ))}
            </select>
            <select className="oc-select" value={draftSeverity} onChange={(e) => setDraftSeverity(e.target.value as IssueSeverity)}>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {ISSUE_SEVERITY_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={createIssue} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface hover:bg-accent-dim">
              Create Issue
            </button>
          </div>
        </Card>
      )}

      <Card padded={false} className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-raised/40 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2.5 font-medium">Issue</th>
              {scope === "all" && <th className="px-4 py-2.5 font-medium">Show</th>}
              <th className="px-4 py-2.5 font-medium w-32">Department</th>
              <th className="px-4 py-2.5 font-medium w-28">Severity</th>
              <th className="px-4 py-2.5 font-medium w-36">Owner</th>
              <th className="px-4 py-2.5 font-medium w-36">Status</th>
              <th className="px-4 py-2.5 font-medium w-28">Opened</th>
            </tr>
          </thead>
          <tbody>
            {issues.length === 0 && (
              <tr>
                <td colSpan={scope === "all" ? 7 : 6} className="px-4 py-6 text-center text-sm text-neutral-500">
                  No issues logged.
                </td>
              </tr>
            )}
            {issues.map((issue) => (
              <tr key={issue.id} className="border-b border-surface-border last:border-0 hover:bg-surface-raised/30">
                <td className="px-4 py-2.5">
                  <button onClick={() => setOpenId(issue.id)} className="text-left font-medium text-neutral-200 hover:text-accent">
                    {issue.title}
                  </button>
                </td>
                {scope === "all" && (
                  <td className="px-4 py-2.5 text-xs text-neutral-500">{issue.show ? `${issue.show.city}, ${issue.show.state}` : "—"}</td>
                )}
                <td className="px-4 py-2.5 text-xs text-neutral-400">{issue.department ? DEPARTMENT_LABEL[issue.department] : "—"}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block rounded border px-2 py-0.5 text-[11px] uppercase tracking-wide ${ISSUE_SEVERITY_CLASSES[issue.severity]}`}>
                    {ISSUE_SEVERITY_LABEL[issue.severity]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-neutral-400">{issue.owner?.name ?? "Unassigned"}</td>
                <td className="px-4 py-2.5">
                  <div className="relative">
                    <select className="oc-select py-1 pl-6 text-xs" value={issue.status} onChange={(e) => patch(issue.id, { status: e.target.value as IssueStatus })}>
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {ISSUE_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <span className={`pointer-events-none absolute left-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full ${ISSUE_STATUS_DOT[issue.status]}`} />
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs text-neutral-500">{formatDate(issue.createdAt.slice(0, 10))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {openIssue && (
        <IssueDrawer
          issue={openIssue}
          users={users}
          onClose={() => setOpenId(null)}
          onPatch={(data) => patch(openIssue.id, data)}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

function IssueDrawer({
  issue,
  users,
  onClose,
  onPatch,
  onRefresh,
}: {
  issue: Issue;
  users: { id: string; name: string }[];
  onClose: () => void;
  onPatch: (data: Partial<Issue>) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<{ comments: EntityComment[]; attachments: EntityAttachment[] } | null>(null);

  const loadDetail = useCallback(async () => {
    const full = await api.getIssue(issue.id);
    setDetail({ comments: full.comments, attachments: full.attachments });
  }, [issue.id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div className="oc-scrollbar h-full w-[460px] overflow-y-auto border-l border-surface-border bg-surface-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              {issue.department ? DEPARTMENT_LABEL[issue.department] : "General"} · {formatDateTime(issue.createdAt)}
            </p>
            <h2 className="text-base font-semibold text-neutral-50">{issue.title}</h2>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="oc-label">Severity</span>
            <select className="oc-select" value={issue.severity} onChange={(e) => onPatch({ severity: e.target.value as IssueSeverity })}>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {ISSUE_SEVERITY_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="oc-label">Status</span>
            <select className="oc-select" value={issue.status} onChange={(e) => onPatch({ status: e.target.value as IssueStatus })}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {ISSUE_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 block">
            <span className="oc-label">Owner</span>
            <select className="oc-select" value={issue.ownerId ?? ""} onChange={(e) => onPatch({ ownerId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 block">
            <span className="oc-label">Description</span>
            <textarea className="oc-textarea" defaultValue={issue.description} rows={3} onBlur={(e) => e.target.value !== issue.description && onPatch({ description: e.target.value })} />
          </label>
          <label className="col-span-2 block">
            <span className="oc-label">Resolution</span>
            <textarea className="oc-textarea" defaultValue={issue.resolution} rows={2} onBlur={(e) => e.target.value !== issue.resolution && onPatch({ resolution: e.target.value })} />
          </label>
          <label className="col-span-2 block">
            <span className="oc-label">Lessons Learned</span>
            <textarea className="oc-textarea" defaultValue={issue.lessonsLearned} rows={2} onBlur={(e) => e.target.value !== issue.lessonsLearned && onPatch({ lessonsLearned: e.target.value })} />
          </label>
        </div>

        <div className="my-4 border-t border-surface-border" />
        <AttachmentList attachments={detail?.attachments ?? []} />

        <div className="my-4 border-t border-surface-border" />
        <CommentThread
          comments={detail?.comments ?? []}
          onAdd={async (body) => {
            await api.addIssueComment(issue.id, body);
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
