import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModelInfo, Workspace } from "../../types/domain";
import { ChatComposer } from "./ChatComposer";

const models: ModelInfo[] = [{ id: "model", name: "测试模型", modelName: "test", kind: "LLM", configured: true, supportsVision: false }];
const workspaces: Workspace[] = [
  { id: "ops", tenant_id: "tenant", owner_id: "user", business_unit_id: null, name: "运营知识库", description: "", scope: "team", kind: "document", gbrain_source_id: "", status: "active", created_at: "", updated_at: "" },
  { id: "service", tenant_id: "tenant", owner_id: "user", business_unit_id: null, name: "客服知识库", description: "", scope: "team", kind: "document", gbrain_source_id: "", status: "active", created_at: "", updated_at: "" }
];

function renderComposer(onWorkspaceScopeChange = vi.fn()) {
  render(<ChatComposer value="" inputRef={createRef<HTMLTextAreaElement>()} models={models} modelId="model" workspaces={workspaces} workspaceId="ops" workspaceIds={["ops"]} options={{ documentQa: true, webSearch: false, imageSearch: false }} loading={false} uploading={false} disabled onChange={vi.fn()} onModelChange={vi.fn()} onWorkspaceScopeChange={onWorkspaceScopeChange} onOptionsChange={vi.fn()} onSubmit={vi.fn()} onStop={vi.fn()} onUpload={vi.fn()} onClearAttachment={vi.fn()} />);
  return onWorkspaceScopeChange;
}

describe("ChatComposer knowledge scope", () => {
  it("merges the current workspace and scope controls into one picker", () => {
    renderComposer();
    expect(screen.getByLabelText("选择知识库范围")).toHaveTextContent("运营知识库");
    expect(screen.queryByText("当前知识库")).not.toBeInTheDocument();
  });

  it("keeps multi-workspace retrieval inside the merged picker", () => {
    const onScopeChange = renderComposer();
    fireEvent.click(screen.getByLabelText("选择知识库范围"));
    fireEvent.click(screen.getByLabelText("客服知识库"));
    expect(onScopeChange).toHaveBeenCalledWith(["ops", "service"]);
  });

  it("closes the picker when the user clicks outside", () => {
    renderComposer();
    const summary = screen.getByLabelText("选择知识库范围");
    fireEvent.click(summary);
    const picker = summary.closest("details");
    expect(picker).toHaveAttribute("open");
    fireEvent.pointerDown(document.body);
    expect(picker).not.toHaveAttribute("open");
  });
});
