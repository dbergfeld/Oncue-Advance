import { Icon } from "../ui/icons";

export interface AttachmentLike {
  id: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
}

/**
 * Placeholder attachment UI — metadata only, matching Phase 1's Documents
 * page pattern. No real object storage is wired up yet (see README), so
 * "adding" an attachment just records a filename/type, and there is no
 * download/preview action.
 */
export function AttachmentList({ attachments }: { attachments: AttachmentLike[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="oc-label mb-0">Attachments {attachments.length > 0 && `(${attachments.length})`}</p>
        <button
          disabled
          title="File upload arrives in a later phase"
          className="flex items-center gap-1.5 rounded-md border border-dashed border-surface-border px-2.5 py-1 text-xs text-neutral-600"
        >
          <Icon name="documents" className="h-3.5 w-3.5" />
          Attach
        </button>
      </div>
      {attachments.length === 0 ? (
        <p className="text-xs text-neutral-600">No attachments yet.</p>
      ) : (
        <ul className="space-y-1">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-md border border-surface-border bg-surface-raised/40 px-2.5 py-1.5 text-xs text-neutral-300">
              <Icon name="documents" className="h-3.5 w-3.5 text-neutral-500" />
              {a.fileName}
              <span className="text-neutral-600">{a.mimeType}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
