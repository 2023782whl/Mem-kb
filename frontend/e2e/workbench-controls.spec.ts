import { expect, test, type Page } from "@playwright/test";

const now = "2026-08-05T00:00:00.000Z";
const user = {
  id: "user-1", tenant_id: "tenant-1", email: "admin@example.com", name: "管理员",
  role: "admin", is_admin: true, status: "active", created_at: now
};
const workspace = {
  id: "ws-1", tenant_id: "tenant-1", owner_id: "user-1", business_unit_id: null,
  name: "运营知识库", description: "", scope: "personal", kind: "document",
  gbrain_source_id: "source-1", status: "active", created_at: now, updated_at: now
};
const note = {
  id: "note-1", workspace_id: "ws-1", owner_id: "user-1", folder_id: null,
  title: "测试笔记", content_markdown: "# 测试", content_json: {}, source_asset_id: null,
  published_asset_id: null, tags: [], is_favorite: false, status: "active", sync_status: "synced",
  sync_error: null, gbrain_slug: "notes/test", version: 1, published_version: 1,
  auto_publish: false, last_published_hash: "hash", last_published_at: now,
  created_at: now, updated_at: now, deleted_at: null
};

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") return route.fulfill({ json: { user } });
    if (url.pathname === "/api/workspaces") return route.fulfill({ json: { workspaces: [workspace] } });
    if (url.pathname === "/api/models") return route.fulfill({ json: { models: [{ id: "gpt", name: "gpt-5.5", modelName: "gpt-5.5", kind: "LLM", configured: true, supportsVision: true, capabilities: [] }] } });
    if (url.pathname === "/api/health") return route.fulfill({ json: { ok: true, gbrain: { ok: true }, models: [] } });
    if (url.pathname === "/api/users") return route.fulfill({ json: { users: [user] } });
    if (url.pathname === "/api/gbrain/operations") return route.fulfill({ json: { sourceStatuses: [], auditLogs: [] } });
    if (url.pathname === "/api/qa/conversations") return route.fulfill({ json: { conversations: [] } });
    if (url.pathname === "/api/analytics/insights") return route.fulfill({ json: { questions: [], documents: [] } });
    if (url.pathname === "/api/assets") return route.fulfill({ json: { assets: [] } });
    if (url.pathname === "/api/workspaces/ws-1/graph") return route.fulfill({ json: { nodes: [], edges: [] } });
    if (url.pathname === "/api/note-folders") return route.fulfill({ json: { folders: [] } });
    if (url.pathname === "/api/notes") return route.fulfill({ json: { notes: [note] } });
    if (url.pathname === "/api/evaluations") return route.fulfill({ json: { runs: [] } });
    if (url.pathname === "/api/consolidation") return route.fulfill({ json: {
      config: { id: "config-1", tenant_id: "tenant-1", enabled: false, schedule_time: "02:30", timezone: "Asia/Shanghai", workspace_ids: [], next_run_at: null, last_run_at: null, created_at: now, updated_at: now },
      runs: [], logs: []
    } });
    return route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/qa");
  await page.evaluate(() => localStorage.clear());
});

test("问答与笔记侧栏折叠状态会保留", async ({ page }) => {
  await page.reload();
  await page.getByRole("button", { name: "收起问答历史" }).click();
  await expect(page.locator(".qa-module-layout")).toHaveClass(/history-collapsed/);
  await page.reload();
  await expect(page.getByRole("button", { name: "展开问答历史" })).toBeVisible();

  await page.goto("/notes");
  await page.getByRole("button", { name: "收起笔记 Workspace" }).click();
  await expect(page.locator(".notes-page")).toHaveClass(/navigator-collapsed/);
  await page.reload();
  await expect(page.getByRole("button", { name: "展开笔记 Workspace" })).toBeVisible();
});

test("问答欢迎页清楚展示检索开关与知识空状态入口", async ({ page }) => {
  await page.reload();
  const webSearch = page.getByRole("button", { name: /联网搜索/ });
  await expect(webSearch).toHaveAttribute("aria-pressed", "false");
  await expect(webSearch.getByText("关")).toBeVisible();
  await webSearch.click();
  await expect(webSearch).toHaveAttribute("aria-pressed", "true");
  await expect(webSearch.getByText("开")).toBeVisible();
  await expect(page.getByRole("link", { name: /添加知识资料/ })).toHaveAttribute("href", "/knowledge/documents");
});

test("知识中心宽度调整支持键盘并在刷新后保留", async ({ page }) => {
  await page.goto("/knowledge/documents");
  const assetHandle = page.getByRole("separator", { name: "调整资产列表宽度" });
  const graphHandle = page.getByRole("separator", { name: "调整右侧图谱宽度" });
  await assetHandle.press("ArrowRight");
  await graphHandle.press("ArrowLeft");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("mem-kb:knowledge-asset-rail-width"))).toBe("260");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("mem-kb:knowledge-graph-width"))).toBe("536");
  await page.reload();
  await expect.poll(() => page.locator(".knowledge-page").evaluate((element) => getComputedStyle(element).getPropertyValue("--asset-rail-width").trim())).toBe("260px");
  await expect.poll(() => page.locator(".knowledge-page").evaluate((element) => getComputedStyle(element).getPropertyValue("--graph-pane-width").trim())).toBe("536px");
});

test("管理员可进入 RAG 评测与夜间巩固页面", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: /RAG 评测/ }).click();
  await expect(page.getByRole("heading", { name: "RAG 评测" })).toBeVisible();
  await expect(page.getByText("召回率")).toBeVisible();
  await expect(page.getByText("引用正确性")).toBeVisible();

  await page.getByRole("button", { name: /夜间巩固/ }).click();
  await expect(page.getByRole("heading", { name: "夜间巩固" })).toBeVisible();
  await expect(page.getByText("执行时间")).toBeVisible();
  await expect(page.getByRole("button", { name: "立即运行" })).toBeVisible();
});
