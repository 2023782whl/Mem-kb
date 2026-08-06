import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../src/utils/concurrency.js";

describe("mapWithConcurrency", () => {
  it("bounds active work and preserves input order", async () => {
    let active = 0;
    let peak = 0;
    const values = [35, 5, 25, 10, 15];

    const result = await mapWithConcurrency(values, 2, async (value, index) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return `${index}:${value}`;
    });

    expect(peak).toBe(2);
    expect(result).toEqual(["0:35", "1:5", "2:25", "3:10", "4:15"]);
  });

  it("uses one worker when concurrency is invalid", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3], 0, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
    });
    expect(peak).toBe(1);
  });
});
