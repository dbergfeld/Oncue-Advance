import { useTour } from "../context/TourContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card, CardHeader } from "../components/ui/Card";
import { StatCard } from "../components/ui/StatCard";
import { StatusSelect } from "../components/ui/StatusSelect";
import { CheckboxField, TextAreaField, TextField } from "../components/ui/Field";
import { Icon } from "../components/ui/icons";
import { laborCompletion } from "../utils/completion";
import { makeLocalId } from "../utils/format";
import type { LaborRole } from "../types";

export function Labor() {
  const { selectedStop, updateStop, savingStopIds } = useTour();

  if (!selectedStop) return <p className="text-sm text-neutral-500">No tour stop selected.</p>;

  const stop = selectedStop;
  const completion = laborCompletion(stop);
  const roles = stop.labor.roles;

  const totalTouring = roles.reduce((sum, r) => sum + r.touringCount, 0);
  const totalLocal = roles.reduce((sum, r) => sum + r.localCount, 0);
  const missingRoles = roles.filter((r) => !r.confirmed).length;

  function setRole<K extends keyof LaborRole>(id: string, key: K, value: LaborRole[K]) {
    updateStop(stop.id, (s) => ({
      ...s,
      labor: { ...s.labor, roles: s.labor.roles.map((r) => (r.id === id ? { ...r, [key]: value } : r)) },
    }));
  }

  function addRole() {
    const newRole: LaborRole = {
      id: makeLocalId("lab"),
      role: "New Role",
      touringCount: 0,
      localCount: 0,
      callTime: "",
      notes: "",
      confirmed: false,
    };
    updateStop(stop.id, (s) => ({ ...s, labor: { ...s.labor, roles: [...s.labor.roles, newRole] } }));
  }

  function removeRole(id: string) {
    updateStop(stop.id, (s) => ({ ...s, labor: { ...s.labor, roles: s.labor.roles.filter((r) => r.id !== id) } }));
  }

  return (
    <div>
      <PageHeader
        title="Labor"
        description="Touring and local crew plan for load-in through load-out."
        status={completion.status}
        percent={completion.percent}
        saving={savingStopIds.has(stop.id)}
      />

      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard label="Total Touring Crew" value={totalTouring} />
        <StatCard label="Total Local Labor" value={totalLocal} />
        <StatCard label="Missing / Unconfirmed Roles" value={missingRoles} status={missingRoles > 0 ? "missing" : "confirmed"} />
        <StatCard label="Labor Confirmed Status" value={<StatusSelect value={stop.labor.status} onChange={(v) => updateStop(stop.id, (s) => ({ ...s, labor: { ...s.labor, status: v } }))} />} />
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-surface-border p-4">
          <CardHeader title="Crew Roles" subtitle="Touring and local counts by role" />
          <button
            onClick={addRole}
            className="flex items-center gap-1.5 rounded-md border border-surface-border px-3 py-1.5 text-xs text-neutral-300 hover:border-accent/40 hover:text-accent"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add Role
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-raised/40 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2.5 font-medium">Role</th>
              <th className="px-3 py-2.5 font-medium w-24">Touring</th>
              <th className="px-3 py-2.5 font-medium w-24">Local</th>
              <th className="px-3 py-2.5 font-medium w-28">Call Time</th>
              <th className="px-3 py-2.5 font-medium">Notes</th>
              <th className="px-3 py-2.5 font-medium w-28">Confirmed</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-neutral-500">
                  No labor roles added yet.
                </td>
              </tr>
            )}
            {roles.map((role) => (
              <tr key={role.id} className="border-b border-surface-border last:border-0">
                <td className="px-3 py-2">
                  <input className="oc-input py-1" value={role.role} onChange={(e) => setRole(role.id, "role", e.target.value)} />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    className="oc-input py-1"
                    value={role.touringCount}
                    onChange={(e) => setRole(role.id, "touringCount", Number(e.target.value))}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    className="oc-input py-1"
                    value={role.localCount}
                    onChange={(e) => setRole(role.id, "localCount", Number(e.target.value))}
                  />
                </td>
                <td className="px-3 py-2">
                  <input className="oc-input py-1" value={role.callTime} placeholder="--:--" onChange={(e) => setRole(role.id, "callTime", e.target.value)} />
                </td>
                <td className="px-3 py-2">
                  <input className="oc-input py-1" value={role.notes} onChange={(e) => setRole(role.id, "notes", e.target.value)} />
                </td>
                <td className="px-3 py-2">
                  <CheckboxField label="" checked={role.confirmed} onChange={(v) => setRole(role.id, "confirmed", v)} />
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => removeRole(role.id)} className="text-xs text-neutral-600 hover:text-status-missing">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Card>
          <TextField
            label="Department Leads"
            value={stop.labor.departmentLeads}
            onChange={(v) => updateStop(stop.id, (s) => ({ ...s, labor: { ...s.labor, departmentLeads: v } }))}
          />
        </Card>
        <Card>
          <TextAreaField
            label="Labor Notes"
            value={stop.labor.notes}
            onChange={(v) => updateStop(stop.id, (s) => ({ ...s, labor: { ...s.labor, notes: v } }))}
            rows={2}
          />
        </Card>
      </div>
    </div>
  );
}
