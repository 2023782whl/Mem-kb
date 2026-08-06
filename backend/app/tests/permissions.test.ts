import { describe, expect, it } from "vitest";
import { canPerformWorkspaceAction, globalWorkspaceRole } from "../src/auth/permissions.js";

describe("global user roles", () => {
  it("maps tenant roles to workspace capabilities", () => {
    expect(globalWorkspaceRole("admin")).toBe("owner");
    expect(globalWorkspaceRole("editor")).toBe("editor");
    expect(globalWorkspaceRole("viewer")).toBe("viewer");
  });

  it("keeps viewers read-only and editors writable", () => {
    expect(canPerformWorkspaceAction("viewer", "read")).toBe(true);
    expect(canPerformWorkspaceAction("viewer", "write")).toBe(false);
    expect(canPerformWorkspaceAction("editor", "write")).toBe(true);
    expect(canPerformWorkspaceAction("editor", "manage")).toBe(false);
    expect(canPerformWorkspaceAction("owner", "manage")).toBe(true);
  });
});
