import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Note } from "../../types/domain";
import { NoteInspector } from "./NoteInspector";

const note: Note = {
  id: "note-1", workspace_id: "ws-1", owner_id: "user-1", folder_id: null,
  title: "测试笔记", content_markdown: "正文", content_json: {}, source_asset_id: null, published_asset_id: null, tags: [], is_favorite: false,
  status: "active", sync_status: "synced", sync_error: null,
  gbrain_slug: "notes/test", version: 1, published_version: 1, auto_publish: false, last_published_hash: "hash", last_published_at: "2026-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null
};

afterEach(() => vi.restoreAllMocks());

describe("NoteInspector", () => {
  it("offers starter questions and keeps the current note visible in the composer", async () => {
    const assist = vi.spyOn(api, "streamNoteAssist").mockImplementation(async (_id, _body, handlers) => {
      handlers.done?.("问题回答");
    });
    render(<NoteInspector note={note} assets={[]} selection="" cursorContext="正文" onApply={vi.fn()} onTagsChange={vi.fn()} onAutoPublishChange={vi.fn()} onReverted={vi.fn()} onOpenSource={vi.fn()} />);

    expect(screen.getByText("Hi，我可以帮你做什么")).toBeVisible();
    expect(screen.getByTitle("基于：测试笔记")).toHaveTextContent("基于测试笔记");
    fireEvent.click(screen.getByRole("button", { name: "这份笔记解决了什么问题？" }));
    await waitFor(() => expect(assist).toHaveBeenCalledTimes(1));
    expect(assist.mock.calls[0][1]).toMatchObject({
      action: "custom",
      instruction: "这份笔记解决了什么问题？",
      locale: "zh-CN"
    });
  });

  it("keeps all output actions available after generation", async () => {
    vi.spyOn(api, "streamNoteAssist").mockImplementation(async (_id, _body, handlers) => {
      handlers.delta?.("生成结果");
      handlers.done?.("生成结果");
    });
    const onApply = vi.fn();
    render(<NoteInspector note={note} assets={[]} selection="" cursorContext="正文" onApply={onApply} onTagsChange={vi.fn()} onAutoPublishChange={vi.fn()} onReverted={vi.fn()} onOpenSource={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(screen.getByText("生成结果")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "插入光标处" })).toBeVisible();
    expect(screen.getByRole("button", { name: "追加到文末" })).toBeVisible();
    expect(screen.getByRole("button", { name: "替换全文" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "追加到文末" }));
    expect(onApply).toHaveBeenCalledWith("生成结果", "append");
  });

  it("explains and optimizes the selected text from quick actions", async () => {
    const assist = vi.spyOn(api, "streamNoteAssist").mockImplementation(async (_id, _body, handlers) => {
      handlers.done?.("完成");
    });
    render(<NoteInspector note={note} assets={[]} selection="待优化内容" cursorContext="上下文" onApply={vi.fn()} onTagsChange={vi.fn()} onAutoPublishChange={vi.fn()} onReverted={vi.fn()} onOpenSource={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "解释" }));
    await waitFor(() => expect(assist).toHaveBeenCalled());
    expect(assist.mock.calls[0][1]).toMatchObject({ action: "custom", selection: "待优化内容" });

    fireEvent.click(screen.getByRole("button", { name: "优化" }));
    await waitFor(() => expect(assist).toHaveBeenCalledTimes(2));
    expect(assist.mock.calls[1][1]).toMatchObject({ action: "rewrite", selection: "待优化内容" });
  });

  it("sends a suggested question immediately when the note opens the assistant", async () => {
    const assist = vi.spyOn(api, "streamNoteAssist").mockImplementation(async (_id, _body, handlers) => {
      handlers.delta?.("基于当前笔记的回答");
      handlers.done?.("基于当前笔记的回答");
    });
    const onPromptHandled = vi.fn();
    render(<NoteInspector
      note={note}
      assets={[]}
      selection=""
      cursorContext="正文"
      onApply={vi.fn()}
      onTagsChange={vi.fn()}
      onAutoPublishChange={vi.fn()}
      onReverted={vi.fn()}
      onOpenSource={vi.fn()}
      pendingPrompt={{ id: 7, noteId: note.id, text: "这篇笔记的关键步骤是什么？" }}
      onPromptHandled={onPromptHandled}
    />);

    await waitFor(() => expect(assist).toHaveBeenCalledTimes(1));
    expect(assist.mock.calls[0][1]).toMatchObject({
      action: "custom",
      instruction: "这篇笔记的关键步骤是什么？",
      locale: "zh-CN"
    });
    expect(onPromptHandled).toHaveBeenCalledWith(7);
    await waitFor(() => expect(screen.getByText("基于当前笔记的回答")).toBeVisible());
  });
});
