import { expect, test } from "@playwright/test";

const user = {
  id: "user-1", tenant_id: "tenant-1", email: "saved-admin", name: "系统管理员",
  role: "admin", is_admin: true, status: "active", created_at: "2026-08-05T08:30:00.000Z"
};

test("密码支持安全自动回填、显隐切换与偏好关闭", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        get: async () => ({ id: "saved-admin", password: "saved-secret" }),
        store: async () => undefined
      }
    });
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") return route.fulfill({ status: 401, json: { error: "unauthorized" } });
    if (url.pathname === "/api/auth/login") return route.fulfill({ json: { user, expiresAt: "2026-08-06T08:30:00.000Z" } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/");
  const password = page.getByLabel("密码", { exact: true });
  await expect(page.getByLabel("用户名")).toHaveValue("saved-admin");
  await expect(password).toHaveValue("saved-secret");
  await expect(password).toHaveAttribute("type", "password");
  await expect(page.getByRole("switch", { name: /自动回填密码/ })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: "显示密码" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "隐藏密码" }).click();
  await expect(password).toHaveAttribute("type", "password");
  if (process.env.CAPTURE_UI) await page.screenshot({ path: "/tmp/mem-kb-login-password.png", fullPage: true });

  await page.getByRole("switch", { name: /自动回填密码/ }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("mem_kb_password_autofill"))).toBe("false");
  await page.reload();
  await expect(page.getByRole("switch", { name: /自动回填密码/ })).toHaveAttribute("aria-checked", "false");
  await expect(password).toHaveValue("");
  await expect(password).toHaveAttribute("autocomplete", "new-password");
});
