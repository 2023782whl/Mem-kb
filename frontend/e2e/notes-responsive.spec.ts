import { expect, test } from "@playwright/test";

const user = { id: "user-1", tenant_id: "tenant-1", email: "admin@example.com", name: "管理员", is_admin: true, status: "active" };
const workspace = { id: "ws-1", tenant_id: "tenant-1", owner_id: "user-1", name: "运营知识库", description: "", scope: "personal", kind: "document", status: "active", role: "owner", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
const note = { id: "note-1", workspace_id: "ws-1", owner_id: "user-1", folder_id: null, title: "测试笔记", content_markdown: "## 需求分析\n- 用户画像\n## 内容策略\n- 标题优化\n## 运营 SOP\n- 执行节奏\n## 竞品研究\n- 差异化\n## 数据复盘\n- 核心指标\n## 优化方案\n- 迭代路径", content_json: {}, source_asset_id: null, published_asset_id: null, tags: [], is_favorite: false, status: "active", sync_status: "synced", sync_error: null, gbrain_slug: "notes/test", version: 1, published_version: 1, auto_publish: false, last_published_hash: "hash", last_published_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null };

test("AI output actions remain visible from 120% through 50% equivalent layouts", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") return route.fulfill({ json: { user } });
    if (url.pathname === "/api/workspaces") return route.fulfill({ json: { workspaces: [workspace] } });
    if (url.pathname.endsWith("/note-folders")) return route.fulfill({ json: { folders: [] } });
    if (url.pathname.endsWith("/notes")) return route.fulfill({ json: { notes: [note] } });
    if (url.pathname === "/api/assets") return route.fulfill({ json: { assets: [] } });
    if (url.pathname.endsWith("/assist/stream")) return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: "event: delta\ndata: {\"text\":\"# 生成结果\\n\\n正文\"}\n\nevent: done\ndata: {\"answer\":\"# 生成结果\\n\\n正文\"}\n\n"
    });
    return route.fulfill({ json: {} });
  });

  await page.goto("/notes");
  await expect(page.locator(".note-editor-shell")).toBeVisible({ timeout: 30_000 });
  const launcher = page.getByRole("button", { name: "打开 AI 问答" });
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(page.getByText("Hi，我可以帮你做什么", { exact: true })).toBeVisible();
  await expect(page.locator(".composer-note-context")).toContainText("测试笔记");
  if (process.env.CAPTURE_UI) await page.screenshot({ path: "/tmp/mem-kb-assistant-empty.png", fullPage: true });
  await page.getByRole("button", { name: "这份笔记解决了什么问题？" }).click();
  const action = page.getByRole("button", { name: "插入光标处" });
  await expect(action).toBeVisible();
  const assistantHeadingSize = await page.locator(".copilot-message.assistant .markdown-content h1").evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(assistantHeadingSize).toBeLessThanOrEqual(20);

  for (const viewport of [
    { width: 1440, height: 720 },
    { width: 1728, height: 864 },
    { width: 2160, height: 1080 },
    { width: 3456, height: 1728 }
  ]) {
    await page.setViewportSize(viewport);
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  }
});

test("draft autosave stays local until publish and document views share one source", async ({ page }) => {
  let saved = { ...note };
  let publishCount = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/api/me") return route.fulfill({ json: { user } });
    if (url.pathname === "/api/workspaces") return route.fulfill({ json: { workspaces: [workspace] } });
    if (url.pathname.endsWith("/note-folders")) return route.fulfill({ json: { folders: [] } });
    if (url.pathname === "/api/notes" && method === "GET") return route.fulfill({ json: { notes: [saved] } });
    if (url.pathname === "/api/assets") return route.fulfill({ json: { assets: [] } });
    if (url.pathname === "/api/notes/note-1" && method === "PUT") {
      const body = route.request().postDataJSON();
      saved = { ...saved, title: body.title, content_markdown: body.content, content_json: body.contentJson, version: saved.version + 1, sync_status: "pending" };
      return route.fulfill({ json: { note: saved } });
    }
    if (url.pathname === "/api/notes/note-1/publish") {
      publishCount += 1;
      saved = { ...saved, published_version: saved.published_version + 1, sync_status: "synced", last_published_hash: "next" };
      return route.fulfill({ json: { note: saved, asset: null, revision: null, unchanged: false } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto("/notes");
  await expect.poll(() => page.locator(".primary-sidebar").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(247, 248, 250)");
  await expect.poll(() => page.locator('.primary-nav a[href="/notes"]').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(238, 242, 255)");
  await expect.poll(() => page.locator('.primary-nav a[href="/notes"] .nav-glyph').evaluate((element) => getComputedStyle(element).color)).toBe("rgb(54, 85, 214)");
  await expect.poll(() => page.locator(".note-navigator").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(245, 247, 251)");
  await expect.poll(() => page.locator(".note-publish").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(23, 25, 29)");
  await page.getByLabel("笔记标题").fill("新的运营方案");
  await expect.poll(() => saved.title).toBe("新的运营方案");
  expect(publishCount).toBe(0);
  await expect(page.getByText("草稿已保存 · 待发布")).toBeVisible();

  await page.getByRole("button", { name: "导图" }).click();
  await expect(page.getByLabel("笔记思维导图")).toBeVisible();
  await expect(page.getByText("13 个节点")).toBeVisible();
  await expect(page.getByLabel("导图方向")).toHaveValue("right");
  await expect(page.locator(".note-mindmap > p")).toHaveCount(0);
  await page.getByRole("button", { name: "适应画布" }).click();
  await expect(page.getByRole("button", { name: "打开 AI 问答" })).toHaveCount(0);
  await page.mouse.move(1000, 600);
  if (process.env.CAPTURE_UI) await page.screenshot({ path: "/tmp/mem-kb-mindmap-clear.png", fullPage: true });
  await page.getByLabel("更多导图操作").click();
  await expect(page.getByRole("button", { name: "定位中心节点" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 SVG" })).toBeVisible();
  const svgDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "SVG" }).click();
  const svgDownload = await svgDownloadPromise;
  expect(svgDownload.suggestedFilename()).toBe("新的运营方案.svg");
  await page.getByRole("button", { name: "分屏" }).click();
  await expect(page.getByLabel("笔记思维导图")).toBeVisible();
  await expect(page.locator(".note-editor-scroll")).toBeVisible();

  await page.getByRole("button", { name: /发布/ }).click();
  await expect.poll(() => publishCount).toBe(1);
  await expect(page.getByText("已发布 · 草稿已保存")).toBeVisible();
});

test("专注模式保留笔记正文并可正常退出", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") return route.fulfill({ json: { user } });
    if (url.pathname === "/api/workspaces") return route.fulfill({ json: { workspaces: [workspace] } });
    if (url.pathname.endsWith("/note-folders")) return route.fulfill({ json: { folders: [] } });
    if (url.pathname.endsWith("/notes")) return route.fulfill({ json: { notes: [note] } });
    if (url.pathname === "/api/assets") return route.fulfill({ json: { assets: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/notes");
  await page.getByRole("button", { name: "进入专注模式" }).click();

  await expect(page.locator(".notes-page")).toHaveClass(/focus-mode/);
  await expect(page.locator(".note-workspace")).toBeVisible();
  await expect(page.getByLabel("笔记标题")).toHaveValue(note.title);
  await expect(page.locator(".note-editor-scroll")).toBeVisible();
  await expect(page.getByRole("button", { name: "退出专注模式" })).toBeVisible();
  await page.getByRole("button", { name: "退出专注模式" }).click();
  await expect(page.locator(".notes-page")).not.toHaveClass(/focus-mode/);
});

test("长文大纲限制在正文可视区并独立滚动", async ({ page }) => {
  const longNote = {
    ...note,
    content_markdown: Array.from({ length: 24 }, (_, index) => `## 第 ${index + 1} 节\n本节正文`).join("\n\n")
  };
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") return route.fulfill({ json: { user } });
    if (url.pathname === "/api/workspaces") return route.fulfill({ json: { workspaces: [workspace] } });
    if (url.pathname.endsWith("/note-folders")) return route.fulfill({ json: { folders: [] } });
    if (url.pathname.endsWith("/notes")) return route.fulfill({ json: { notes: [longNote] } });
    if (url.pathname === "/api/assets") return route.fulfill({ json: { assets: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/notes");
  await page.locator(".note-outline-toggle").hover();

  const panel = page.locator(".note-outline-panel");
  const content = page.locator(".note-content-view");
  await expect(panel).toBeVisible();
  const [panelBox, contentBox, scrollState] = await Promise.all([
    panel.boundingBox(),
    content.boundingBox(),
    panel.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY }))
  ]);
  expect(panelBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(
    contentBox!.y + contentBox!.height
  );
  expect(scrollState.overflowY).toBe("auto");
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
});
