import { describe, expect, it } from "vitest";
import { nextScheduledAt } from "../src/modules/consolidation/service.js";

describe("night consolidation schedule", () => {
  it("selects today's future time in Asia/Shanghai", () => {
    const next = nextScheduledAt("02:30", "Asia/Shanghai", new Date("2026-08-04T17:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-08-04T18:30:00.000Z");
  });

  it("rolls an elapsed schedule to the next local day", () => {
    const next = nextScheduledAt("02:30", "Asia/Shanghai", new Date("2026-08-05T01:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-08-05T18:30:00.000Z");
  });
});
