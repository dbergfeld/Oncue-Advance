import { useState } from "react";
import { useShow } from "../context/ShowContext";
import { useUsers } from "../context/UserContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { SelectField, TextAreaField } from "../components/ui/Field";
import { Icon } from "../components/ui/icons";
import { api } from "../api/client";
import type { NoteCategory, NoteStatus } from "../types";

const CATEGORIES: Array<{ value: NoteCategory; label: string }> = [
  { value: "GENERAL", label: "General" },
  { value: "PRODUCTION_CONCERN", label: "Production Concern" },
  { value: "VENUE_LIMITATION", label: "Venue Limitation" },
  { value: "FOLLOW_UP_QUESTION", label: "Follow-Up Question" },
  { value: "INTERNAL_CREW_NOTE", label: "Internal Crew Note" },
];

const NOTE_STATUS_OPTIONS: Array<{ value: NoteStatus; label: string }> = [
  { value: "OPEN", label: "Open" },
  { value: "MONITORING", label: "Monitoring" },
  { value: "RESOLVED", label: "Resolved" },
];

const NOTE_STATUS_DOT: Record<NoteStatus, string> = {
  OPEN: "bg-status-missing",
  MONITORING: "bg-status-review",
  RESOLVED: "bg-status-confirmed",
};

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label])) as Record<NoteCategory, string>;

export function Notes() {
  const { selectedShow, refreshSelectedShow } = useShow();
  const { activeUser } = useUsers();
  const [draftCategory, setDraftCategory] = useState<NoteCategory>("GENERAL");
  const [draftText, setDraftText] = useState("");

  if (!selectedShow) return <p className="text-sm text-neutral-500">No show selected.</p>;

  async function addNote() {
    if (!draftText.trim() || !selectedShow) return;
    await api.createNote(selectedShow.id, { body: draftText.trim(), category: draftCategory, noteStatus: "OPEN" });
    setDraftText("");
    await refreshSelectedShow();
  }

  async function setNoteStatus(id: string, noteStatus: NoteStatus) {
    await api.updateNote(id, { noteStatus });
    await refreshSelectedShow();
  }

  async function removeNote(id: string) {
    await api.deleteNote(id);
    await refreshSelectedShow();
  }

  const sorted = [...selectedShow.comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div>
      <PageHeader title="Notes" description="General, production, venue, and crew notes for this show." />

      <Card className="mb-4">
        <div className="grid grid-cols-4 gap-3">
          <SelectField label="Category" value={draftCategory} onChange={(v) => setDraftCategory(v as NoteCategory)} options={CATEGORIES} />
          <div className="col-span-1 flex flex-col justify-end pb-2 text-xs text-neutral-500">
            Posting as <span className="text-neutral-300">{activeUser?.name ?? "—"}</span>
          </div>
          <TextAreaField label="Note" value={draftText} onChange={setDraftText} className="col-span-2" rows={1} placeholder="Add a note…" />
        </div>
        <div className="mt-3 flex justify-end">
          <button onClick={addNote} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface hover:bg-accent-dim">
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add Note
          </button>
        </div>
      </Card>

      {sorted.length === 0 ? (
        <p className="text-sm text-neutral-500">No notes yet — add the first one above.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {sorted.map((note) => (
            <Card key={note.id}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="rounded border border-surface-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-neutral-400">
                  {CATEGORY_LABEL[note.category]}
                </span>
                <button onClick={() => removeNote(note.id)} className="text-xs text-neutral-600 hover:text-status-missing">
                  Remove
                </button>
              </div>
              <p className="text-sm text-neutral-200">{note.body}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-neutral-500">{note.author?.name ?? "Unassigned"}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${NOTE_STATUS_DOT[note.noteStatus]}`} />
                  <select
                    className="bg-transparent text-xs text-neutral-400 focus:outline-none"
                    value={note.noteStatus}
                    onChange={(e) => setNoteStatus(note.id, e.target.value as NoteStatus)}
                  >
                    {NOTE_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-surface-panel">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
