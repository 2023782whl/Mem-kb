import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { User } from "../../types/domain";
import { UserManagement } from "./UserManagement";

const admin: User = {
  id: "user-admin", tenant_id: "tenant-zw", email: "admin@mem-kb.local", name: "系统管理员",
  role: "admin", is_admin: true, status: "active", created_at: "2026-08-04T00:00:00.000Z"
};

afterEach(() => vi.restoreAllMocks());

describe("UserManagement", () => {
  it("shows users and their enforced role", async () => {
    vi.spyOn(api, "users").mockResolvedValue({ users: [admin] });
    render(<UserManagement currentUser={admin} />);
    await waitFor(() => expect(screen.getByText("admin@mem-kb.local")).toBeInTheDocument());
    expect(screen.getByText("管理员")).toBeVisible();
    expect(screen.getByText("当前账号")).toBeVisible();
    expect(screen.getByRole("button", { name: "添加用户" })).toBeVisible();
  });
});
