import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { LoginPage } from "./LoginPage";

afterEach(() => vi.restoreAllMocks());

describe("LoginPage", () => {
  it("prefills the local admin account and submits it", async () => {
    const user = { id: "user-admin", tenant_id: "tenant-zw", email: "admin@mem-kb.local", name: "系统管理员", role: "admin" as const, is_admin: true, status: "active" as const, created_at: "2026-08-04T00:00:00.000Z" };
    vi.spyOn(api, "login").mockResolvedValue({ user, expiresAt: "2026-08-05T00:00:00.000Z" });
    const onLogin = vi.fn();

    render(<LoginPage onLogin={onLogin} />);

    expect(screen.getByLabelText("用户名")).toHaveValue("admin");
    expect(screen.getByLabelText("密码")).toHaveValue("admin123456");
    expect(screen.getByLabelText("知识沉淀")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /进入知识中心/ }));

    await waitFor(() => expect(api.login).toHaveBeenCalledWith("admin", "admin123456", false));
    expect(onLogin).toHaveBeenCalledWith(user);
  });
});
