import type {
  AdvanceNote,
  DocumentItem,
  EntityAttachment,
  EntityComment,
  Issue,
  Requirement,
  RiskEngineResult,
  ScheduleItem,
  Show,
  ShowSummary,
  Tag,
  TimelineEntry,
  Tour,
  User,
  Venue,
} from "../types";

const BASE = "/api";

// Demo mode ("acting as" picker — see UserContext): trusted x-user-id header.
let activeUserId: string | null = null;
export function setActiveUserId(id: string | null) {
  activeUserId = id;
}

// Supabase mode: verified session, sent as a bearer token instead.
let accessToken: string | null = null;
export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  else if (activeUserId) headers["x-user-id"] = activeUserId;

  const res = await fetch(`${BASE}${path}`, { headers, ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${init?.method ?? "GET"} ${path} (${res.status})`) as Error & { code?: string; status?: number };
    err.code = body.code;
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const put = <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) });
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const del = (path: string) => request<void>(path, { method: "DELETE" });

export const api = {
  health: () => request<{ status: string; aiConfigured: boolean }>("/health"),
  getUsers: () => request<User[]>("/users"),
  getMe: () => request<User>("/me"),
  getTours: () => request<(Tour & { shows: ShowSummary[] })[]>("/tours"),

  getShows: () => request<ShowSummary[]>("/shows"),
  getShow: (id: string) => request<Show>(`/shows/${id}`),
  updateShow: (id: string, data: Partial<Show>) => put<Show>(`/shows/${id}`, data),

  getVenue: (id: string) => request<Venue>(`/venues/${id}`),
  updateVenue: (id: string, data: Partial<Venue>) => put<Venue>(`/venues/${id}`, data),
  addVenueContact: (venueId: string, data: Partial<{ name: string; role: string; email: string; phone: string }>) =>
    post(`/venues/${venueId}/contacts`, data),
  updateContact: (id: string, data: Record<string, unknown>) => put(`/contacts/${id}`, data),
  deleteContact: (id: string) => del(`/contacts/${id}`),

  getRequirements: (showId: string) => request<Requirement[]>(`/shows/${showId}/requirements`),
  getRequirement: (id: string) => request<Requirement & { comments: EntityComment[]; attachments: EntityAttachment[] }>(`/requirements/${id}`),
  createRequirement: (showId: string, data: Partial<Requirement>) => post<Requirement>(`/shows/${showId}/requirements`, data),
  updateRequirement: (id: string, data: Partial<Requirement>) => put<Requirement>(`/requirements/${id}`, data),
  deleteRequirement: (id: string) => del(`/requirements/${id}`),
  addRequirementComment: (id: string, body: string) => post<EntityComment>(`/requirements/${id}/comments`, { body }),
  tagRequirement: (id: string, tagId: string) => post(`/requirements/${id}/tags`, { tagId }),

  getIssues: (params?: { showId?: string; status?: string; department?: string; severity?: string }) => {
    const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][]).toString();
    return request<Issue[]>(`/issues${qs ? `?${qs}` : ""}`);
  },
  getIssue: (id: string) => request<Issue & { comments: EntityComment[]; attachments: EntityAttachment[] }>(`/issues/${id}`),
  createIssue: (data: Partial<Issue> & { showId?: string | null }) => post<Issue>("/issues", data),
  updateIssue: (id: string, data: Partial<Issue>) => put<Issue>(`/issues/${id}`, data),
  deleteIssue: (id: string) => del(`/issues/${id}`),
  addIssueComment: (id: string, body: string) => post<EntityComment>(`/issues/${id}/comments`, { body }),
  tagIssue: (id: string, tagId: string) => post(`/issues/${id}/tags`, { tagId }),

  deleteComment: (id: string) => del(`/comments/${id}`),
  deleteEntityTag: (id: string) => del(`/entity-tags/${id}`),
  getTags: () => request<Tag[]>("/tags"),
  createTag: (label: string, color?: string) => post<Tag>("/tags", { label, color }),

  getTimeline: (showId: string) => request<TimelineEntry[]>(`/shows/${showId}/timeline`),
  updateTimelineEntry: (id: string, data: Partial<TimelineEntry>) => put<TimelineEntry>(`/timeline-entries/${id}`, data),

  getSchedule: (showId: string) => request<ScheduleItem[]>(`/shows/${showId}/schedule`),
  updateScheduleItem: (id: string, data: Partial<ScheduleItem>) => put<ScheduleItem>(`/schedule-items/${id}`, data),

  getDocuments: (showId: string) => request<DocumentItem[]>(`/shows/${showId}/documents`),
  updateDocument: (id: string, data: Partial<DocumentItem>) => put<DocumentItem>(`/documents/${id}`, data),

  getNotes: (showId: string) => request<AdvanceNote[]>(`/shows/${showId}/notes`),
  createNote: (showId: string, data: Partial<AdvanceNote>) => post<AdvanceNote>(`/shows/${showId}/notes`, data),
  updateNote: (id: string, data: Partial<AdvanceNote>) => put<AdvanceNote>(`/notes/${id}`, data),
  deleteNote: (id: string) => del(`/notes/${id}`),

  getAuditLog: (entityType: string, entityId: string) => request<unknown[]>(`/audit-log?entityType=${entityType}&entityId=${entityId}`),

  runRiskAnalysis: (showId: string) => post<RiskEngineResult>(`/shows/${showId}/risk-analysis`),
};
