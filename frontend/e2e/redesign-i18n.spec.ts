import { expect, test, type Page } from "@playwright/test";

const now = "2026-08-05T08:30:00.000Z";
const user = {
  id: "user-1", tenant_id: "tenant-1", email: "admin@example.com", name: "系统管理员",
  role: "admin", is_admin: true, status: "active", created_at: now
};
const workspace = {
  id: "ws-1", tenant_id: "tenant-1", owner_id: "user-1", business_unit_id: null,
  name: "电商运营知识库", description: "运营知识与 SOP", scope: "team", kind: "document",
  gbrain_source_id: "source-1", status: "active", created_at: now, updated_at: now
};
const personalWorkspace = {
  ...workspace,
  id: "ws-personal",
  name: "个人运营打法",
  description: "个人策略、选品观察和可复用打法。",
  scope: "personal",
  gbrain_source_id: "source-personal"
};
const note = {
  id: "note-1", workspace_id: "ws-1", owner_id: "user-1", folder_id: null,
  title: "淘天电商运营：关键词分析实操 SOP",
  content_markdown: "# 关键词分析实操 SOP\n\n## 一、核心目标\n通过数据化手段挖掘高意图关键词。\n\n## 二、执行流程\n### 2.1 建立原始词库\n- 生意参谋搜索分析\n- 搜索下拉框拓词\n\n## 三、数据复盘\n持续记录转化率与投入产出比。",
  content_json: {}, source_asset_id: null, published_asset_id: null, tags: ["SOP", "电商运营"],
  is_favorite: true, status: "active", sync_status: "synced", sync_error: null,
  gbrain_slug: "notes/keyword-sop", version: 3, published_version: 2, auto_publish: false,
  last_published_hash: "hash", last_published_at: now, created_at: now, updated_at: now, deleted_at: null
};
const asset = {
  id: "asset-1", tenant_id: "tenant-1", workspace_id: "ws-1", owner_id: "user-1",
  category_id: null, product_id: null, type: "document", format: "pdf",
  title: "新品打造计划源策略.pdf", mime_type: "application/pdf", size_bytes: 428000,
  storage_key: "files/strategy.pdf", sha256: "abc", status: "ready",
  summary: "围绕新品人群、关键词、主图与价格建立统一策略，并通过阶段复盘持续优化转化效率。",
  extracted_text: null, index_text: null, markdown_storage_key: "markdown/strategy.md",
  thumbnail_storage_key: null, processing_provider: "document-ai", processing_version: "1",
  processed_at: now, gbrain_slug: "assets/strategy", source_url: null, ocr_text: null,
  tags: ["新品", "策略"], metadata: {}, error: null, created_at: now, updated_at: now, deleted_at: null
};
const personalAsset = {
  ...asset,
  id: "asset-personal",
  workspace_id: "ws-personal",
  title: "个人运营打法.md",
  summary: "沉淀个人策略、选品观察和可复用的运营打法。",
  tags: ["个人沉淀", "选品"]
};
const assetMarkdown = "# 新品打造计划源策略\n\n## 一、业务场景\n新品上市需要统一目标与节奏。\n\n## 二、场景目标\n建立可持续复盘的增长流程。\n\n## 三、执行步骤\n### 3.1 人群策略\n确定核心人群与拓展人群。\n\n### 3.2 关键词策略\n维护词库并持续优化。";

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") return route.fulfill({ json: { user } });
    if (url.pathname === "/api/health") return route.fulfill({ json: { ok: true, gbrain: { ok: true }, models: [] } });
    if (url.pathname === "/api/workspaces") return route.fulfill({ json: { workspaces: [workspace, personalWorkspace] } });
    if (url.pathname === "/api/note-folders") return route.fulfill({ json: { folders: [] } });
    if (url.pathname === "/api/notes") return route.fulfill({ json: { notes: [note] } });
    if (url.pathname === "/api/notes/note-1/overview") return route.fulfill({ json: { overview: {
      summary: "这篇笔记说明了关键词分析的目标、建库流程和复盘方法。",
      keyPoints: ["建立原始词库", "持续复盘转化率与投入产出比"],
      suggestedQuestions: ["如何建立高质量的原始词库？", "如何判断关键词是否值得持续投入？", "如何把复盘流程沉淀为 SOP？"]
    } } });
    if (url.pathname === "/api/notes/note-1/assist/stream") return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'event: delta\ndata: {"text":"可以先从搜索词、人群和转化数据建立原始词库。"}\n\nevent: done\ndata: {"answer":"可以先从搜索词、人群和转化数据建立原始词库。"}\n\n'
    });
    if (url.pathname === "/api/assets/asset-1/preview") return route.fulfill({ json: { asset, text: assetMarkdown } });
    if (url.pathname === "/api/assets/asset-personal/preview") return route.fulfill({ json: { asset: personalAsset, text: assetMarkdown } });
    if (url.pathname === "/api/assets") return route.fulfill({ json: { assets: url.searchParams.get("workspaceId") === "ws-personal" ? [personalAsset] : [asset] } });
    if (url.pathname === "/api/workspaces/ws-1/graph" || url.pathname === "/api/workspaces/ws-personal/graph") return route.fulfill({ json: { nodes: [], edges: [] } });
    if (url.pathname === "/api/models") return route.fulfill({ json: { models: [] } });
    return route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/notes");
  await page.locator(".note-editor-shell").waitFor({ state: "visible", timeout: 30_000 });
});

test("笔记页具备边界折叠、分组列表、目录与全局悬停说明", async ({ page }) => {
  await page.getByRole("button", { name: "展开笔记列表" }).click();
  await expect(page.getByRole("heading", { name: "今天" })).toBeVisible();
  await expect(page.locator(".note-entry.active")).toHaveCSS("background-color", "rgb(238, 242, 255)");

  const topbarContext = page.locator(".topbar-context");
  const toggle = page.getByRole("button", { name: "收起笔记列表" });
  const contextBox = await topbarContext.boundingBox();
  const toggleBox = await toggle.boundingBox();
  expect(contextBox).not.toBeNull();
  expect(toggleBox).not.toBeNull();
  expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(contextBox!.x);
  expect(Math.abs(
    toggleBox!.y + toggleBox!.height / 2 - (contextBox!.y + contextBox!.height / 2)
  )).toBeLessThanOrEqual(2);

  await page.mouse.move(500, 500);
  await toggle.hover();
  await expect(page.getByRole("tooltip")).toHaveText("收起笔记列表");

  const readingRail = page.locator(".note-reading-rail");
  await expect(page.getByText("大纲", { exact: true })).toHaveCount(0);
  await expect(page.locator(".note-progress-track")).toBeVisible();
  await readingRail.hover();
  await expect(page.getByText("大纲", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "跳转到：一、核心目标" })).toBeVisible();
  await page.mouse.move(500, 500);
  await expect(page.getByText("大纲", { exact: true })).toHaveCount(0);
  await readingRail.hover();
  await page.locator(".note-outline-panel").getByRole("button", { name: "固定文章目录" }).click();
  await page.mouse.move(500, 500);
  await expect(page.getByText("大纲", { exact: true })).toBeVisible();

  const missingLabels = await page.locator("button:visible, a[href]:visible, summary:visible, [role='button']:visible").evaluateAll((elements) => elements
    .filter((element) => !(element.getAttribute("data-tooltip") || element.getAttribute("title") || element.getAttribute("aria-label") || (element.textContent || "").trim()))
    .map((element) => element.outerHTML.slice(0, 180)));
  expect(missingLabels).toEqual([]);
  if (process.env.CAPTURE_UI) await page.screenshot({ path: "/tmp/mem-kb-notes-redesign.png", fullPage: true });
});

test("笔记 AI 概览的推荐追问会打开侧边助手并直接发送", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByText("AI 概览", { exact: true })).toBeVisible();
  await expect(page.getByText("推荐追问", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "如何建立高质量的原始词库？" }).click();
  await expect(page.getByText("AI 问答", { exact: true })).toBeVisible();
  await expect(page.locator(".copilot-message.user").getByText("如何建立高质量的原始词库？", { exact: true })).toBeVisible();
  await expect(page.getByText("可以先从搜索词、人群和转化数据建立原始词库。", { exact: true })).toBeVisible();
  if (process.env.CAPTURE_UI) await page.screenshot({ path: "/tmp/mem-kb-note-followup.png", fullPage: true });
});

test("语言切换覆盖导航、页面文案、控件说明并持久化", async ({ page }) => {
  await page.getByRole("button", { name: "切换语言" }).click();
  await page.getByText("English", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Notes" })).toBeVisible();
  const expandNotes = page.getByRole("button", { name: "Expand notes list" });
  await expect(expandNotes).toBeVisible();
  await expandNotes.click();
  await expect(page.getByText("Notes space", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("mem_kb_locale"))).toBe("en-US");
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch language" })).toBeVisible();
  await page.getByRole("button", { name: "Expand notes list" }).click();
  await expect(page.getByText("All content", { exact: true })).toBeVisible();
});

test("知识详情提供 AI 概览、目录、阅读进度和回到顶部能力", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/knowledge/documents");
  await expect(page.getByRole("heading", { name: "今天" })).toBeVisible();
  await page.locator(".asset-row-main").click();
  await expect(page.getByText("AI 概览", { exact: true })).toBeVisible();
  await expect(page.getByText("目录", { exact: true })).toBeVisible();
  await expect(page.locator(".document-progress")).toBeVisible();
  await expect(page.getByRole("button", { name: "复制摘要" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新生成 AI 概览" })).toBeVisible();
  await expect(page.getByText("推荐追问", { exact: true })).toHaveCount(0);
  if (process.env.CAPTURE_UI) await page.screenshot({ path: "/tmp/mem-kb-knowledge-redesign.png", fullPage: true });
});

test("知识默认显示摘要，工作区范围切换保持侧栏展开且图谱分栏可向左扩展", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/knowledge/documents");
  await expect(page.getByRole("button", { name: "摘要" })).toHaveClass(/active/);
  await page.getByRole("button", { name: "展开知识空间" }).click();
  await expect(page.getByRole("button", { name: "收起知识空间" })).toBeVisible();

  const detail = page.locator(".knowledge-detail");
  const before = await detail.boundingBox();
  const handle = page.getByRole("separator", { name: "调整右侧图谱宽度" });
  const handleBox = await handle.boundingBox();
  expect(before).not.toBeNull();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + 160);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x - 120, handleBox!.y + 160, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await detail.boundingBox())?.width || 0).toBeGreaterThan(before!.width + 60);

  await page.getByRole("button", { name: "个人工作区" }).click();
  await expect(page.getByRole("button", { name: "收起知识空间" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "个人运营打法", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "摘要" })).toHaveClass(/active/);
});
