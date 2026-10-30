// Media Servers module (`servers`). Owns /servers and devices of class server/kvm/capture/tcGen.
// Pure: writes are returned as Patch[] applied as 'servers'. Never writes a wall dimension.
import type { CheckDraft, Device, ModuleContract, Patch, SeedContext, ServerHost, ShowRecord, ValidateContext, Wall } from "../store/types";
import { instantiate, library, normFormat, parseFormat, specOf, type NewId } from "../library/library";
import { wallPx } from "../library/wall";
import { fmt, toCsv } from "../util/csv";

export const DEFAULT_CODEC = "HAP";
export const DEFAULT_SERVER_TEMPLATE = "tpl_disguise_vx2";

const devOf = (r: ShowRecord, id: string | null | undefined) => (id ? r.devices.find((d) => d.id === id) : undefined);
const portName = (r: ShowRecord, h: ServerHost, portId: string) => {
  const d = devOf(r, h.deviceId);
  return `${d?.label ?? "server"} ${d?.ports.find((p) => p.id === portId)?.name ?? "output"}`;
};

/** House frame rate (59.94 from "1080p59.94"); 59.94 when unset. */
export function houseFps(r: ShowRecord): number {
  return parseFormat(r.signal.formats.house)?.rate ?? 59.94;
}

/** Default output raster: signal.formats.ledInput, else 3840x2160 at the house rate. */
export function defaultOutput(r: ShowRecord): { resolution: string; refresh: number } {
  const f = parseFormat(r.signal.formats.ledInput);
  return f ? { resolution: f.resolution, refresh: f.rate } : { resolution: "3840x2160", refresh: houseFps(r) };
}

export function outputFormat(o: { resolution: string; refresh: number }): string {
  return normFormat(`${o.resolution}p${o.refresh}`);
}

function serverOutPorts(d: Device | undefined) {
  return (d?.ports ?? []).filter((p) => p.dir === "out" && /^(DP|HDMI|12G-SDI|3G-SDI|DVI)/.test(p.type));
}

// ---------------- helpers ----------------
/** Content spec per wall from canvas px; keeps an existing codec/fps per wall, drops specs for removed walls. */
export function syncContentSpecs(r: ShowRecord): Patch[] {
  const fps = houseFps(r);
  const specs = r.led.walls.map((w) => {
    const px = wallPx(r, w);
    const prev = r.servers.content.contentSpecs.find((c) => c.wallId === w.id);
    return { wallId: w.id, w_px: px.w_px, h_px: px.h_px, codec: prev?.codec ?? DEFAULT_CODEC, fps: prev?.fps ?? fps };
  });
  const same = JSON.stringify(specs) === JSON.stringify(r.servers.content.contentSpecs);
  return same ? [] : [{ op: "replace", path: "/servers/content/contentSpecs", value: specs }];
}

function outputsFor(r: ShowRecord, d: Device, existing: ServerHost["outputs"]): ServerHost["outputs"] {
  const walls = r.led.walls.map((w) => w.id);
  const def = defaultOutput(r);
  const outs = existing.map((o) => ({ ...o, feedsWallId: o.feedsWallId && walls.includes(o.feedsWallId) ? o.feedsWallId : null }));
  const fed = new Set(outs.map((o) => o.feedsWallId).filter(Boolean));
  const free = serverOutPorts(d).filter((p) => !outs.some((o) => o.portId === p.id));
  for (const wallId of walls) {
    if (fed.has(wallId)) continue;
    const idle = outs.find((o) => !o.feedsWallId);
    if (idle) idle.feedsWallId = wallId;
    else {
      const p = free.shift();
      if (!p) break;
      outs.push({ portId: p.id, resolution: def.resolution, refresh: def.refresh, feedsWallId: wallId });
    }
    fed.add(wallId);
  }
  if (!outs.length) {
    const p = serverOutPorts(d)[0];
    if (p) outs.push({ portId: p.id, resolution: def.resolution, refresh: def.refresh, feedsWallId: null });
  }
  return outs;
}

/** Every host feeds every wall from one output each: reuses idle outputs, then free output ports; clears feeds to removed walls. */
export function assignOutputs(r: ShowRecord): Patch[] {
  const out: Patch[] = [];
  for (const h of r.servers.hosts) {
    const d = devOf(r, h.deviceId);
    if (!d) continue;
    const next = outputsFor(r, d, h.outputs);
    if (JSON.stringify(next) !== JSON.stringify(h.outputs)) out.push({ op: "replace", path: `/servers/hosts/${h.id}/outputs`, value: next });
  }
  return out;
}

/** Adds a master + backup pair (default disguise vx 2) paired via failover, one output per wall each. */
export function addServerPair(r: ShowRecord, newId: NewId, templateId = DEFAULT_SERVER_TEMPLATE): Patch[] {
  const t = library.get(templateId);
  if (!t || t.class !== "server") throw new Error(`${templateId} is not a server template`);
  const used = new Set(r.devices.map((d) => d.label.toLowerCase()));
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let i = 0;
  while (i + 1 < letters.length && (used.has(`srv-${letters[i]}`.toLowerCase()) || used.has(`srv-${letters[i + 1]}`.toLowerCase()))) i += 2;
  const devA = instantiate(t, `SRV-${letters[i]}`, newId);
  const devB = instantiate(t, `SRV-${letters[i + 1]}`, newId);
  const idA = newId("srv"), idB = newId("srv");
  const tc = (specOf(devA).timecode as ServerHost["timecode"]) ?? "LTC";
  const platform = String(t.spec.platform ?? t.make);
  const host = (id: string, d: Device, role: ServerHost["role"], failover: string | null): ServerHost => ({
    id, deviceId: d.id, platform, role, outputs: outputsFor(r, d, []), inputs: d.ports.filter((p) => p.dir === "in" && /SDI/.test(p.type)).slice(0, 1).map((p) => ({ portId: p.id, source: "PGM" })),
    timecode: tc, failover,
  });
  return [
    { op: "add", path: "/devices/-", value: devA },
    { op: "add", path: "/devices/-", value: devB },
    { op: "add", path: "/servers/hosts/-", value: host(idA, devA, "master", idB) },
    { op: "add", path: "/servers/hosts/-", value: host(idB, devB, "backup", null) },
  ];
}

// ---------------- validate ----------------
function processorFor(r: ShowRecord, w: Wall | undefined): Device | undefined {
  if (!w) return undefined;
  const procs = w.processorIds.map((id) => devOf(r, id)).filter((d): d is Device => !!d);
  return procs.find((d) => ((specOf(d).acceptedFormats as string[] | undefined) ?? []).length > 0) ?? procs[0];
}

export function validateServers(r: ShowRecord, ctx?: Partial<ValidateContext>): CheckDraft[] {
  const out: CheckDraft[] = [];
  const walls = new Map(r.led.walls.map((w) => [w.id, w]));

  // SRV-001 content spec px ≠ wall px
  r.servers.content.contentSpecs.forEach((c, i) => {
    const w = walls.get(c.wallId);
    if (!w) return;
    const px = wallPx(r, w);
    if (c.w_px === px.w_px && c.h_px === px.h_px) return;
    const fix = syncContentSpecs(r);
    out.push({
      code: "SRV-001", severity: "warn", title: "Output / canvas mismatch", target: w.id, involved: [w.id],
      message: `${w.name} content is built at ${fmt(c.w_px)}×${fmt(c.h_px)} px but the wall is ${fmt(px.w_px)}×${fmt(px.h_px)} px.`,
      rule: `Content spec px must equal the wall's px; ${fmt(c.w_px)}×${fmt(c.h_px)} ≠ ${fmt(px.w_px)}×${fmt(px.h_px)}.`,
      evidence: [
        { label: `${w.name} content spec`, value: `${fmt(c.w_px)}×${fmt(c.h_px)} px ${c.codec} @ ${c.fps}`, path: `/servers/content/contentSpecs/${i}` },
        { label: `${w.name} wall px`, value: `${fmt(px.w_px)}×${fmt(px.h_px)} px`, path: `/derived/led/perWall/${w.id}` },
      ],
      fixes: [
        { label: `Rebuild ${w.name} content spec at ${fmt(px.w_px)}×${fmt(px.h_px)} px`, module: "servers", ...(fix.length ? { patch: fix } : {}) },
        { label: `Resize ${w.name} to match the content`, module: "led" },
      ],
    });
  });

  const ledInput = normFormat(r.signal.formats.ledInput);
  for (const h of r.servers.hosts) {
    const d = devOf(r, h.deviceId);
    const label = d?.label ?? "Server";
    h.outputs.forEach((o, i) => {
      const op = `/servers/hosts/${h.id}/outputs/${i}`;
      // SRV-002 output vs processor input
      if (o.feedsWallId) {
        const w = walls.get(o.feedsWallId);
        const proc = processorFor(r, w);
        const accepted = ((proc ? specOf(proc).acceptedFormats : undefined) as string[] | undefined)?.map(normFormat) ?? [];
        const f = outputFormat(o);
        const notAccepted = accepted.length > 0 && !accepted.includes(f);
        const notLed = !!ledInput && f !== ledInput;
        if (w && (notAccepted || notLed)) {
          const why = notAccepted
            ? `${proc!.label} accepts ${accepted.slice(0, 6).join(", ")}${accepted.length > 6 ? ", …" : ""}; the output is ${f}.`
            : `LED input format is ${ledInput}; the output is ${f}.`;
          out.push({
            code: "SRV-002", severity: "block", title: "Output / processor input", target: o.portId || h.id, involved: [h.id, o.portId, w.id, ...(proc ? [proc.id] : [])].filter(Boolean),
            message: `${portName(r, h, o.portId)} sends ${o.resolution} @ ${o.refresh} to ${w.name}, which ${proc ? `${proc.label} ` : ""}does not take.`,
            rule: why,
            evidence: [
              { label: `${portName(r, h, o.portId)} format`, value: `${o.resolution} @ ${o.refresh}`, path: op },
              ...(proc ? [{ label: `${proc.label} accepted formats`, value: accepted.join(", ") || "unspecified", path: proc.spec?.acceptedFormats ? `/devices/${proc.id}/spec/acceptedFormats` : `library:${proc.templateId ?? proc.model}.spec.acceptedFormats` }] : []),
              { label: "LED input format", value: r.signal.formats.ledInput || "unset", path: "/signal/formats/ledInput" },
            ],
            fixes: [
              ...(ledInput && (!accepted.length || accepted.includes(ledInput)) ? [{
                label: `Set ${portName(r, h, o.portId)} to ${r.signal.formats.ledInput}`, module: "servers" as const,
                patch: [{ op: "replace" as const, path: `${op}/resolution`, value: parseFormat(ledInput)!.resolution }, { op: "replace" as const, path: `${op}/refresh`, value: parseFormat(ledInput)!.rate }],
              }] : []),
              { label: "Insert a scaler between the server and the processor", module: "signal" as const },
            ],
          });
        }
      } else if (r.led.walls.length) {
        // SRV-004 output unassigned
        const fix = assignOutputs(r);
        out.push({
          code: "SRV-004", severity: "warn", title: "Output unassigned", target: o.portId || h.id, involved: [h.id, o.portId].filter(Boolean),
          message: `${portName(r, h, o.portId)} does not feed any wall, while the show has ${r.led.walls.length} wall${r.led.walls.length > 1 ? "s" : ""}.`,
          rule: `Every server output needs a feedsWallId when walls exist; ${portName(r, h, o.portId)} has none of ${r.led.walls.map((w) => w.name).join(", ")}.`,
          evidence: [
            { label: `${portName(r, h, o.portId)} feeds`, value: "none", path: `${op}/feedsWallId` },
            { label: "Walls", value: r.led.walls.map((w) => w.name).join(", "), path: "/led/walls" },
          ],
          fixes: [
            { label: `Assign ${label} outputs to walls (auto)`, module: "servers", ...(fix.length ? { patch: fix } : {}) },
            { label: `Remove the unused output from ${label}`, module: "servers", patch: [{ op: "remove", path: op }] },
          ],
        });
      }
    });

    // SRV-003 no failover
    if (h.role === "master" && !h.failover && ctx?.profile?.dualServerExpected) {
      const spare = r.servers.hosts.find((x) => x.id !== h.id && x.role !== "master" && !r.servers.hosts.some((m) => m.failover === x.id));
      out.push({
        code: "SRV-003", severity: "warn", title: "No failover", target: h.id, involved: [h.id],
        message: `${label} is a master with no backup server, but this ${ctx.profile.type} show expects dual servers.`,
        rule: `Profile expects dual servers; ${label} failover is empty.`,
        evidence: [
          { label: `${label} failover`, value: "none", path: `/servers/hosts/${h.id}/failover` },
          { label: "Profile dual server expected", value: "yes", path: `profile:${ctx.profile.type}.dualServerExpected` },
        ],
        fixes: spare
          ? [{ label: `Pair ${label} with ${devOf(r, spare.deviceId)?.label ?? "the spare host"}`, module: "servers", patch: [{ op: "replace", path: `/servers/hosts/${h.id}/failover`, value: spare.id }] }]
          : [{ label: `Add a backup server for ${label}`, module: "servers" }],
      });
    }
  }

  // SRV-005 genlock-capable server with no sync generator
  const hasTcGen = r.devices.some((d) => d.class === "tcGen");
  if (!hasTcGen) {
    for (const d of r.devices) {
      if (d.class !== "server") continue;
      // Only a spec the device actually carries (its own, or its template by id) — never inferred from make/model.
      const s = { ...(d.templateId ? library.get(d.templateId)?.spec ?? {} : {}), ...(d.spec ?? {}) };
      if (s.genlock !== true) continue;
      out.push({
        code: "SRV-005", severity: "warn", title: "No sync generator", target: d.id, involved: [d.id],
        message: `${d.label} expects genlock but the show has no sync generator.`,
        rule: `A server with genlock = true needs a tcGen device for reference; ${d.label} genlock = true, sync generators = 0.`,
        evidence: [
          { label: `${d.label} genlock`, value: "yes", path: d.spec?.genlock !== undefined ? `/devices/${d.id}/spec/genlock` : `library:${d.templateId}.spec.genlock` },
          { label: "Sync generators", value: "0", path: "/devices" },
        ],
        fixes: [{ label: "Add an Evertz 5601MSC master sync", module: "servers" }],
      });
    }
  }
  return out;
}

// ---------------- seed ----------------
/** Blank-show default: SRV-A (master) + SRV-B (backup) disguise vx 2 paired via failover; HAP content spec per wall at the house rate. Idempotent. */
export function seedServers(r: ShowRecord, ctx: Pick<SeedContext, "newId">): Patch[] {
  const out: Patch[] = [];
  if (!r.servers.hosts.length) out.push(...addServerPair(r, ctx.newId));
  out.push(...syncContentSpecs(r));
  return out;
}

// ---------------- export ----------------
export function renderServerOutputs(r: ShowRecord): string {
  const rows: unknown[][] = [];
  for (const h of r.servers.hosts) {
    const d = devOf(r, h.deviceId);
    for (const o of h.outputs) rows.push([d?.label ?? "", h.platform, h.role, portName(r, h, o.portId), o.resolution, o.refresh, r.led.walls.find((w) => w.id === o.feedsWallId)?.name ?? "",
      devOf(r, r.servers.hosts.find((x) => x.id === h.failover)?.deviceId)?.label ?? "", h.timecode]);
  }
  return toCsv(["Server", "Platform", "Role", "Output", "Resolution", "Refresh", "Feeds wall", "Failover", "Timecode"], rows);
}

export const serversModule: ModuleContract = {
  id: "servers",
  version: "1.0.0",
  owns: ["/servers"],
  reads: ["/servers", "/led/canvas", "/led/walls", "/derived/led/perWall", "/signal/formats", "/signal/links", "/devices"],
  deviceClasses: ["server", "kvm", "capture", "tcGen"],
  cableTypes: [],
  seed: (record, ctx) => seedServers(record, ctx),
  derive: () => ({}),
  validate: (record, ctx) => validateServers(record, ctx),
  exports: [{ key: "server-outputs", label: "Server outputs", mime: "text/csv", render: renderServerOutputs }],
};
