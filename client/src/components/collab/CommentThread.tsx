import { useState } from "react";
import type { EntityComment } from "../../types";
import { useUsers } from "../../context/UserContext";
import { formatDateTime } from "../../utils/format";
import { Icon } from "../ui/icons";

/**
 * Generic threaded discussion for a Requirement or Issue. Backed by the same
 * polymorphic Comment model as show-level Notes (see server/prisma/schema.prisma),
 * just without the category/noteStatus fields.
 */
export function CommentThread({
  comments,
  onAdd,
  onDelete,
}: {
  comments: EntityComment[];
  onAdd: (body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { activeUser } = useUsers();
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  async function submit() {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await onAdd(draft.trim());
      setDraft("");
    } finally {
      setPosting(false);
    }
  }

  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div>
      <p className="oc-label">Comments {comments.length > 0 && `(${comments.length})`}</p>
      <div className="mb-3 space-y-2">
        {sorted.length === 0 && <p className="text-xs text-neutral-600">No comments yet.</p>}
        {sorted.map((c) => (
          <div key={c.id} className="rounded-md border border-surface-border bg-surface-raised/40 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-300">{c.author?.name ?? "Unknown"}</span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-neutral-600">{formatDateTime(c.createdAt)}</span>
                <button onClick={() => onDelete(c.id)} className="text-[11px] text-neutral-600 hover:text-status-missing">
                  Remove
                </button>
              </div>
            </div>
            <p className="mt-1 text-sm text-neutral-200">{c.body}</p>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2">
        <textarea
          className="oc-textarea flex-1"
          rows={2}
          placeholder={`Comment as ${activeUser?.name ?? "…"}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          onClick={submit}
          disabled={posting || !draft.trim()}
          className="mt-0.5 flex items-center gap-1.5 rounded-md border border-surface-border px-3 py-2 text-xs text-neutral-300 hover:border-accent/40 hover:text-accent disabled:opacity-40"
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
          Post
        </button>
      </div>
    </div>
  );
}
