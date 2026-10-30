import { describe, expect, it } from "vitest";
import { LIBRARY, instantiate, library, makeLookup, normFormat, templateForDevice, templateForTileModel } from "../../library/library";
import { newId } from "../../store/ids";

// Every templateId named in the Device library tab and the Cable & panels tab.
const SPEC_ROWS = {
  processor: ["tpl_brompton_sx40", "tpl_brompton_xd", "tpl_brompton_s8", "tpl_brompton_s4", "tpl_brompton_sq200", "tpl_novastar_mx40pro", "tpl_novastar_mx30", "tpl_megapixel_helios", "tpl_megapixel_helios8k"],
  tile: ["tpl_roe_cb5", "tpl_roe_cb5_mkii", "tpl_roe_cb5_half", "tpl_roe_cb3", "tpl_roe_cb8", "tpl_roe_v8t", "tpl_roe_v8t_h", "tpl_roe_v8s", "tpl_roe_bm4", "tpl_roe_dm2_6", "tpl_absen_pl3_9", "tpl_infiled_db5"],
  cameras: ["tpl_sony_hdc3500", "tpl_sony_hdcu3500", "tpl_sony_hdc5500", "tpl_sony_hxcfb80", "tpl_pana_uc4000", "tpl_bmd_ursabroadcast_g2", "tpl_bmd_studio4kpro_g2", "tpl_pana_ue160", "tpl_sony_brcx1000", "tpl_marshall_cv568",
    // CCUs referenced by the camera rows
    "tpl_sony_hdcu5500", "tpl_sony_hxcufb80", "tpl_pana_ucu600"],
  converters: ["tpl_aja_hi5_12g", "tpl_aja_ha5_12g", "tpl_aja_fido_4t", "tpl_aja_fido_4r", "tpl_bmd_teranex_12g", "tpl_bmd_teranex_av", "tpl_decimator_mdhx", "tpl_decimator_12g_cross", "tpl_bmd_da_12g", "tpl_aja_12gda",
    "tpl_bmd_optical_12g", "tpl_bmd_studioconverter", "tpl_smpte_fiber_reel", "tpl_tac12_fiber", "tpl_netgear_m4250"],
  endpoints: ["tpl_ross_carbonite_ultra", "tpl_ross_ultrix_fr1", "tpl_bmd_atem_constellation_8k", "tpl_bmd_atem_4me_constellation_4k", "tpl_bmd_videohub_40x40_12g", "tpl_bmd_hyperdeck_4kpro", "tpl_bmd_hyperdeck_extreme_8k",
    "tpl_disguise_vx2", "tpl_disguise_vx4", "tpl_resolume_server", "tpl_hippo_boreal_plus", "tpl_pixera_two", "tpl_bmd_decklink_8k", "tpl_evertz_5601", "tpl_tvlogic_lum_181h", "tpl_bmd_smartview_4k",
    "tpl_surgex_sx1120", "tpl_apc_ap7900b", "tpl_apc_smt1500rm", "tpl_motionlabs_200a", "tpl_motionlabs_400a"],
  panels: ["tpl_panel_stagebox_12sdi", "tpl_panel_fibre_12lc", "tpl_panel_vw_24sdi", "tpl_panel_smpte_4", "tpl_panel_cat6_24", "tpl_panel_foh_8sdi", "tpl_panel_ac_pdu_front"],
};

const TILE_KEYS = ["pitch_mm", "w_mm", "h_mm", "d_mm", "px_w", "px_h", "maxW", "avgW", "nits", "ip", "curve", "protocol", "transparency_pct"];
const PROC_KEYS = ["protocol", "maxPx", "pxPerPort8bit", "pxPerPort10bit", "outputs1G", "outputs10G", "inputs", "maxCanvas", "genlock", "acceptedFormats"];

describe("device library", () => {
  it("has the catalog header and every spec row, with unique ids", () => {
    expect(LIBRARY.libraryVersion).toBe("2026.10.1");
    expect(LIBRARY.schemaVersion).toBe("1.0.0");
    const ids = LIBRARY.templates.map((t) => t.templateId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of Object.values(SPEC_ROWS).flat()) expect(library.get(id), id).toBeDefined();
    expect(ids.length).toBe(Object.values(SPEC_ROWS).flat().length);
  });

  it("carries the class-specific spec keys", () => {
    for (const t of LIBRARY.templates) {
      if (t.class === "tile") for (const k of TILE_KEYS) expect(t.spec, `${t.templateId}.${k}`).toHaveProperty(k);
      if (t.class === "processor") for (const k of PROC_KEYS) expect(t.spec, `${t.templateId}.${k}`).toHaveProperty(k);
      if (t.class === "converter") {
        for (const k of ["from", "to", "scaler", "frameSync", "poweredBy", "formatRule"]) expect(t.spec, `${t.templateId}.${k}`).toHaveProperty(k);
        expect(t.ports.some((p) => p.type === "AC-in" || p.type === "DC-in"), `${t.templateId} power port`).toBe(true);
      }
      if (t.class === "server") { expect(t.spec.timecode).toBe("LTC"); expect(t.spec.genlock).toBe(true); expect(t.spec).toHaveProperty("maxOutputRes"); }
      if (t.class === "distro") for (const k of ["service", "inletAmps", "outlets", "l2130Count"]) expect(t.spec).toHaveProperty(k);
      if (t.class === "patchPanel") { expect(t.spec).toHaveProperty("panelKind"); expect(Array.isArray(t.spec.jacks)).toBe(true); }
      // bidir only for network / intercom / SMPTE hybrid, plus the tile data and DeckLink rows the spec seeds that way.
      for (const p of t.ports) if (p.dir === "bidir") expect(["cat6", "intercom", "fiber-SMPTE", "etherCon", "12G-SDI", "fiber-LC"]).toContain(p.type);
    }
    expect(library.get("tpl_brompton_sx40")!.spec.pxPerPort8bit).toBe(525000);
    expect(library.get("tpl_novastar_mx40pro")!.spec.pxPerPort8bit).toBe(659722);
    expect(library.get("tpl_aja_hi5_12g")!.spec.formatRule).toBe("pass-through");
    expect(library.get("tpl_bmd_teranex_av")!.spec.formatRule).toBe("converting");
    expect(library.get("tpl_motionlabs_400a")!.spec.l2130Count).toBe(12);
  });

  it("instantiate expands port counts into p_ ids, copies spec and records the template", () => {
    const t = library.get("tpl_brompton_sx40")!;
    const d = instantiate(t, "PROC-1", newId);
    expect(d.id).toMatch(/^dev_/);
    expect(d.templateId).toBe("tpl_brompton_sx40");
    expect(d.source).toBe("manufacturer");
    expect(d.ports.length).toBe(t.ports.reduce((s, p) => s + p.count, 0));
    expect(d.ports.every((p) => /^p_[0-9a-z]{12}$/.test(p.id))).toBe(true);
    expect(new Set(d.ports.map((p) => p.id)).size).toBe(d.ports.length);
    expect(d.ports.filter((p) => p.type === "fiberLED").map((p) => p.name)).toEqual(["10G OUT 1", "10G OUT 2", "10G OUT 3", "10G OUT 4"]);
    expect(d.ports.find((p) => p.type === "12G-SDI")!.name).toBe("12G-SDI IN");
    expect(d.spec).toEqual(t.spec);
    expect(d.spec).not.toBe(t.spec);
    expect(d.inventoryRef).toEqual({ system: "RentalWorks", iCode: "", barcode: "" });
    expect(d.rackId).toBeNull();
    expect(d.ru).toBe(2);

    const xd = instantiate(library.get("tpl_brompton_xd")!, "XD-1", newId);
    expect(xd.ports.filter((p) => p.type === "etherCon" && p.dir === "out")).toHaveLength(10);

    const panel = instantiate(library.get("tpl_panel_stagebox_12sdi")!, "SL-SB-1", newId);
    const jacks = panel.spec!.jacks as { id: string; number: number; type: string; front: { cableId: null } }[];
    expect(jacks).toHaveLength(18);
    expect(jacks.every((j) => /^jack_/.test(j.id))).toBe(true);
    expect(jacks.map((j) => j.number)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(jacks[0]).toMatchObject({ type: "12G-SDI", front: { cableId: null }, rear: { cableId: null }, group: "SDI" });
  });

  it("resolves tile model strings", () => {
    expect(templateForTileModel("ROE CB5")?.templateId).toBe("tpl_roe_cb5");
    expect(templateForTileModel("Carbon CB5")?.templateId).toBe("tpl_roe_cb5");
    expect(templateForTileModel("CB5")?.templateId).toBe("tpl_roe_cb5");
    expect(templateForTileModel("ROE Visual Carbon CB5")?.templateId).toBe("tpl_roe_cb5");
    expect(templateForTileModel("ROE Vanish 8T")?.templateId).toBe("tpl_roe_v8t");
    expect(templateForTileModel("Vanish V8T")?.templateId).toBe("tpl_roe_v8t");
    expect(templateForTileModel("ROE CB5 MKII")?.templateId).toBe("tpl_roe_cb5_mkii");
    expect(templateForTileModel("roe cb3")?.templateId).toBe("tpl_roe_cb3");
    expect(templateForTileModel("Absen PL3.9")?.templateId).toBe("tpl_absen_pl3_9");
    expect(templateForTileModel("Mystery Panel 9")).toBeUndefined();
  });

  it("find matches class, protocol, make and text; deprecated only on an exact hit", () => {
    expect(library.find({ class: "processor", protocol: "Brompton" }).map((t) => t.templateId)).toContain("tpl_brompton_xd");
    expect(library.find({ class: "processor", protocol: "novastar" }).every((t) => t.make === "NovaStar")).toBe(true);
    expect(library.find({ make: "disguise" }).map((t) => t.templateId).sort()).toEqual(["tpl_disguise_vx2", "tpl_disguise_vx4"]);
    expect(library.find({ text: "SX-40" })[0].templateId).toBe("tpl_brompton_sx40");
    expect(library.find({ class: "tile", text: "vanish" }).length).toBe(3);
    const old = { ...library.get("tpl_roe_cb5")!, templateId: "tpl_old_cb5", model: "Carbon CB5 Legacy", aliases: ["CB5L"], deprecated: true };
    const lk = makeLookup([...LIBRARY.templates, old]);
    expect(lk.find({ text: "CB5" }).map((t) => t.templateId)).not.toContain("tpl_old_cb5");
    expect(lk.find({ text: "CB5L" }).map((t) => t.templateId)).toEqual(["tpl_old_cb5"]);
    expect(lk.find({ class: "tile" }).map((t) => t.templateId)).not.toContain("tpl_old_cb5");
  });

  it("resolves fixture devices by make/model and normalises formats", () => {
    expect(templateForDevice({ class: "processor", make: "Brompton", model: "SX40" })?.templateId).toBe("tpl_brompton_sx40");
    expect(templateForDevice({ class: "server", make: "disguise", model: "vx 2" })?.templateId).toBe("tpl_disguise_vx2");
    expect(templateForDevice({ class: "rackPdu", make: "SurgeX", model: "SX-1120-RT" })?.templateId).toBe("tpl_surgex_sx1120");
    expect(templateForDevice({ class: "distro", make: "Motion Labs", model: "200A 3Ø" })?.templateId).toBe("tpl_motionlabs_200a");
    expect(normFormat("1080p59.94")).toBe("1920x1080p59.94");
    expect(normFormat("3840×2160p59.94")).toBe("3840x2160p59.94");
    expect(normFormat("2160p60")).toBe("3840x2160p60");
  });
});
