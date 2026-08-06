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
const asset = {
  id: "asset-1", tenant_id: "tenant-1", workspace_id: "ws-1", owner_id: "user-1",
  category_id: null, product_id: null, type: "document", format: "md", title: "知识资产.md",
  mime_type: "text/markdown", size_bytes: 1024, storage_key: "uploads/asset.md", sha256: "hash",
  status: "ready", summary: "一份等待转为工作笔记的知识资产", extracted_text: "# 资产正文",
  index_text: "资产正文", markdown_storage_key: "processed/asset.md", thumbnail_storage_key: null,
  processing_provider: "local", processing_version: "1", processed_at: now, gbrain_slug: null,
  source_url: null, ocr_text: null, tags: [], metadata: {}, error: null,
  created_at: now, updated_at: now, deleted_at: null
};
const noteFromAsset = { ...note, id: "note-from-asset", title: asset.title, content_markdown: "# 资产正文", source_asset_id: asset.id };

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") return route.fulfill({ json: { user } });
    if (url.pathname === "/api/me/avatar" && route.request().method() === "PATCH") return route.fulfill({ json: { user: { ...user, avatar_type: "preset", avatar_value: "jade" } } });
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

test("问答与笔记侧栏默认收起，固定后才会保留", async ({ page }) => {
  await page.reload();
  await expect(page.locator(".qa-module-layout")).toHaveClass(/history-collapsed/);
  await expect(page.locator("#topbar-panel-trigger-slot").getByRole("button", { name: "展开问答历史" })).toBeVisible();
  await page.getByRole("button", { name: "展开问答历史" }).click();
  await page.getByRole("button", { name: "固定问答历史" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "收起问答历史" })).toBeVisible();

  await page.goto("/notes");
  await expect(page.locator(".notes-page")).toHaveClass(/navigator-collapsed/);
  await expect(page.locator("#topbar-panel-trigger-slot").getByRole("button", { name: "展开笔记列表" })).toBeVisible();
  await page.getByRole("button", { name: "展开笔记列表" }).click();
  await page.getByRole("button", { name: "固定笔记列表" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "收起笔记列表" })).toBeVisible();
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
  await expect(page.locator("#topbar-panel-trigger-slot").getByRole("button", { name: "展开知识空间" })).toBeVisible();
  await page.getByRole("button", { name: "展开知识空间" }).click();
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

test("知识视图标签、资产操作和真实节点数保持同一工具行", async ({ page }) => {
  await page.route("**/api/assets**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/assets/asset-1/preview") return route.fulfill({ json: { asset, text: "# 资产正文" } });
    if (url.pathname === "/api/assets") return route.fulfill({ json: { assets: [asset] } });
    return route.fallback();
  });
  await page.goto("/knowledge/documents");
  const toolbar = page.locator(".workbench-toolbar-row");
  const tabs = toolbar.locator(".workbench-tabs");
  const status = toolbar.locator(".graph-status");

  await expect(tabs).toBeVisible();
  await expect(status).toContainText("0 个真实节点");
  const [tabsBox, statusBox] = await Promise.all([tabs.boundingBox(), status.boundingBox()]);
  expect(tabsBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(Math.abs((tabsBox!.y + tabsBox!.height / 2) - (statusBox!.y + statusBox!.height / 2))).toBeLessThanOrEqual(4);
  const summaryPaddingTop = await page.locator(".workbench-body.view-summary").evaluate((element) => parseFloat(getComputedStyle(element).paddingTop));
  expect(summaryPaddingTop).toBeLessThanOrEqual(36);
});

test("笔记列表中的知识资产点击后直接进入工作笔记", async ({ page }) => {
  await page.unroute("**/api/**");
  let openCount = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") return route.fulfill({ json: { user } });
    if (url.pathname === "/api/health") return route.fulfill({ json: { ok: true, gbrain: { ok: true }, models: [] } });
    if (url.pathname === "/api/workspaces") return route.fulfill({ json: { workspaces: [workspace] } });
    if (url.pathname === "/api/note-folders") return route.fulfill({ json: { folders: [] } });
    if (url.pathname === "/api/notes") return route.fulfill({ json: { notes: openCount ? [noteFromAsset] : [] } });
    if (url.pathname === "/api/assets") return route.fulfill({ json: { assets: [asset] } });
    if (url.pathname === `/api/assets/${asset.id}/open-in-notes`) {
      openCount += 1;
      return route.fulfill({ json: { note: noteFromAsset, created: true } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto("/notes");
  await page.getByRole("button", { name: "展开笔记列表" }).click();
  await page.locator(".note-entry-main", { hasText: asset.title }).click();

  await expect.poll(() => openCount).toBe(1);
  await expect(page.getByLabel("笔记标题")).toHaveValue(asset.title);
  await expect(page.locator(".workspace-asset-viewer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看原始资产" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "在笔记中打开" })).toHaveCount(0);
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

test("租户用户可以选择预设头像并同步更新全局头像", async ({ page }) => {
  await page.reload();
  await page.getByRole("button", { name: "打开个人资料" }).click();
  await expect(page.getByRole("dialog", { name: "设置个人头像" })).toBeVisible();
  await page.getByRole("button", { name: "预设头像" }).click();
  await page.getByRole("button", { name: "选择jade预设头像" }).click();
  await page.getByRole("button", { name: "保存头像" }).click();
  await expect(page.getByRole("dialog", { name: "设置个人头像" })).toBeHidden();
  await expect(page.locator(".topbar-user .user-avatar.avatar-jade")).toBeVisible();
});
