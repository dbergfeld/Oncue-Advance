import { useShow } from "../../context/ShowContext";
import { useUsers } from "../../context/UserContext";
import { formatDate } from "../../utils/format";
import { isSupabaseConfigured } from "../../lib/supabaseClient";

export function Header() {
  const { shows, selectedShow, selectShow } = useShow();
  const { users, activeUser, setActiveUser, signOut } = useUsers();

  const sortedShows = [...shows].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-surface-border bg-surface-panel/60 px-6">
      <div className="flex items-center gap-4">
        <div>
          <p className="text-xs text-neutral-500">
            {selectedShow?.tour ? `${selectedShow.tour.artist} — ${selectedShow.tour.name}` : "Loading tour…"}
          </p>
          {selectedShow && (
            <p className="text-sm font-medium text-neutral-100">
              {selectedShow.venue?.name || "Venue TBD"}
              <span className="text-neutral-500"> · {selectedShow.city}, {selectedShow.state}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {selectedShow && (
          <>
            <span className="hidden text-xs text-neutral-500 sm:inline">{formatDate(selectedShow.date)}</span>
            <select
              className="oc-select w-64 py-1.5 text-sm"
              value={selectedShow.id}
              onChange={(e) => selectShow(e.target.value)}
            >
              {sortedShows.map((show) => (
                <option key={show.id} value={show.id}>
                  {formatDate(show.date)} — {show.city}, {show.state}
                </option>
              ))}
            </select>
          </>
        )}

        <div className="h-6 w-px bg-surface-border" />

        {isSupabaseConfigured ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-300" title={activeUser?.email}>
              {activeUser?.name ?? "…"}
            </span>
            <button
              onClick={() => signOut()}
              className="rounded-md border border-surface-border px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200"
            >
              Sign out
            </button>
          </div>
        ) : (
          <select
            className="oc-select w-40 py-1.5 text-xs"
            value={activeUser?.id ?? ""}
            onChange={(e) => {
              const user = users.find((u) => u.id === e.target.value);
              if (user) setActiveUser(user);
            }}
            title="Acting as (demo mode — no Supabase project configured, see Settings)"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </header>
  );
}
