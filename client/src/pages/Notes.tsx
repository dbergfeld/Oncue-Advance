import { useState } from "react";
import { useTour } from "../context/TourContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { SelectField, TextAreaField, TextField } from "../components/ui/Field";
import { Icon } from "../components/ui/icons";
import { makeLocalId } from "../utils/format";
import type { AdvanceNote, NoteCategory, NoteStatus } from "../types";

const CATEGORIES: NoteCategory[] = [
  "General",
  "Production Concern",
  "Venue Limitation",
  "Follow-Up Question",
  "Internal Crew Note",
];

const NOTE_STATUS_OPTIONS: Array<{ value: NoteStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "monitoring", label: "Monitoring" },
  { value: "resolved", label: "Resolved" },
];

const NOTE_STATUS_DOT: Record<NoteStatus, string> = {
  open: "bg-status-missing",
  monitoring: "bg-status-review",
  resolved: "bg-status-confirmed",
};

export function Notes() {
  const { selectedStop, updateStop } = useTour();
  const [draftCategory, setDraftCategory] = useState<NoteCategory>("General");
  const [draftText, setDraftText] = useState("");
  const [draftOwner, setDraftOwner] = useState("");

  if (!selectedStop) return <p className="text-sm text-neutral-500">No tour stop selected.</p>;

  const stop = selectedStop;

  function setNote<K extends keyof AdvanceNote>(id: string, key: K, value: AdvanceNote[K]) {
    updateStop(stop.id, (s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, [key]: value } : n)) }));
  }

  function removeNote(id: string) {
    updateStop(stop.id, (s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) }));
  }

  function addNote() {
    if (!draftText.trim()) return;
    const note: AdvanceNote = {
      id: makeLocalId("note"),
      category: draftCategory,
      text: draftText.trim(),
      owner: draftOwner.trim() || "Unassigned",
      status: "open",
      createdAt: new Date().toISOString(),
    };
    updateStop(stop.id, (s) => ({ ...s, notes: [note, ...s.notes] }));
    setDraftText("");
    setDraftOwner("");
  }

  const sorted = [...stop.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div>
      <PageHeader title="Notes" description="General, production, venue, and crew notes for this stop." />

      <Card className="mb-4">
        <div className="grid grid-cols-4 gap-3">
          <SelectField
            label="Category"
            value={draftCategory}
            onChange={(v) => setDraftCategory(v as NoteCategory)}
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
          <TextField label="Owner" value={draftOwner} onChange={setDraftOwner} placeholder="Who's tracking this?" />
          <TextAreaField label="Note" value={draftText} onChange={setDraftText} className="col-span-2" rows={1} placeholder="Add a note…" />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={addNote}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface hover:bg-accent-dim"
          >
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
                  {note.category}
                </span>
                <button onClick={() => removeNote(note.id)} className="text-xs text-neutral-600 hover:text-status-missing">
                  Remove
                </button>
              </div>
              <p className="text-sm text-neutral-200">{note.text}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-neutral-500">{note.owner}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${NOTE_STATUS_DOT[note.status]}`} />
                  <select
                    className="bg-transparent text-xs text-neutral-400 focus:outline-none"
                    value={note.status}
                    onChange={(e) => setNote(note.id, "status", e.target.value as NoteStatus)}
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
