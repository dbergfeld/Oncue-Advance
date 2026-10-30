import { describe, expect, it } from "vitest";
import { engine } from "../engine";
import { loadExample } from "../setup/example";
import { memoryPersist } from "../store/persist";
import { Workspace } from "../store/store";

describe("example show is read-only until copied", () => {
  it("refuses writes on the example and accepts them on its copy", () => {
    const ws = new Workspace(engine, memoryPersist());
    const ex = loadExample(ws);
    const res = ws.patch(ex.showId, "shell", [{ op: "replace", path: "/name", value: "Edited" }], "edit example");
    expect(res.ok).toBe(false);
    expect(res.errors?.[0].code).toBe("E_FROZEN");
    const copy = ws.copyShow(ex.showId);
    expect(copy.meta.source).toBe("copy");
    expect(ws.patch(copy.showId, "shell", [{ op: "replace", path: "/name", value: "Edited" }], "edit copy").ok).toBe(true);
  });
});
