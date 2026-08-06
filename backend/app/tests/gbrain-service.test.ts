import { describe, expect, it } from "vitest";
import {
  capability,
  filterWorkspaceAnomalies,
  filterWorkspaceRecords,
  jobCanCancel,
  jobCanRetry,
  workspaceSlugPrefix
} from "../src/modules/gbrain/service.js";
import { isGBrainPageNotFound, type GBrainJob } from "../src/services/gbrain.js";

function job(status: string): GBrainJob {
  return { id: 1, name: "test", queue: "default", status, progress: null };
}

describe("gbrain discovery service", () => {
  it("builds a stable tenant and workspace slug prefix", () => {
    expect(workspaceSlugPrefix("tenant-a", "workspace-b")).toBe("aiteam/tenant-a/workspace/workspace-b/");
  });

  it("filters anomalies to the active workspace", () => {
    const prefix = workspaceSlugPrefix("tenant-a", "workspace-b");
    const rows = filterWorkspaceAnomalies([
      { cohort_kind: "type", count: 3, page_slugs: [`${prefix}assets/1`, "aiteam/tenant-z/workspace/x/assets/2"] },
      { cohort_kind: "type", count: 1, page_slugs: ["aiteam/tenant-z/workspace/x/assets/3"] }
    ], prefix);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
    expect(rows[0].page_slugs).toEqual([`${prefix}assets/1`]);
  });

  it("removes records without workspace provenance", () => {
    const prefix = workspaceSlugPrefix("tenant-a", "workspace-b");
    expect(filterWorkspaceRecords([{ slug: `${prefix}notes/1` }, { slug: "people/global" }], prefix)).toEqual([{ slug: `${prefix}notes/1` }]);
  });

  it("returns capability errors without throwing raw tool failures", async () => {
    await expect(capability(async () => { throw new Error(JSON.stringify({ message: "未发布", suggestion: "请启用配置" })); })).resolves.toEqual({
      available: false,
      data: null,
      error: "未发布 请启用配置"
    });
  });

  it("allows only valid job transitions", () => {
    expect(jobCanRetry(job("failed"))).toBe(true);
    expect(jobCanRetry(job("waiting"))).toBe(false);
    expect(jobCanCancel(job("active"))).toBe(true);
    expect(jobCanCancel(job("completed"))).toBe(false);
  });

  it("recognizes an already missing GBrain page as an idempotent delete", () => {
    expect(isGBrainPageNotFound(new Error(JSON.stringify({ error: "page_not_found", message: "Page not found" })))).toBe(true);
    expect(isGBrainPageNotFound(new Error("network unavailable"))).toBe(false);
  });
});
