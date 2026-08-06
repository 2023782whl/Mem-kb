import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Asset } from "../../types/domain";
import { AssetWorkbench } from "./AssetWorkbench";

vi.mock("../../api/client", () => ({
  api: { preview: vi.fn(() => new Promise(() => undefined)), retryAsset: vi.fn() }
}));

const documentAsset: Asset = {
  id: "asset-document",
  tenant_id: "tenant",
  workspace_id: "workspace",
  owner_id: "user",
  category_id: null,
  product_id: null,
  type: "document",
  format: "docx",
  title: "只读文档.docx",
  mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size_bytes: 1024,
  storage_key: "uploads/document.docx",
  sha256: "hash",
  status: "ready",
  summary: "只读文档",
  extracted_text: "正文",
  index_text: "正文",
  markdown_storage_key: "processed/document.md",
  thumbnail_storage_key: null,
  processing_provider: "eopera",
  processing_version: "1",
  processed_at: "2026-08-04T00:00:00.000Z",
  gbrain_slug: null,
  source_url: null,
  ocr_text: null,
  tags: [],
  metadata: {},
  error: null,
  created_at: "2026-08-04T00:00:00.000Z",
  updated_at: "2026-08-04T00:00:00.000Z",
  deleted_at: null
};

describe("AssetWorkbench", () => {
  it("keeps knowledge documents read-only", () => {
    const { container } = render(
      <AssetWorkbench
        workspaceName="知识库"
        graph={{ nodes: [], edges: [] }}
        selectedAsset={documentAsset}
        view="preview"
        onViewChange={vi.fn()}
        onSelectNode={vi.fn()}
        onChanged={vi.fn()}
        onDelete={vi.fn()}
        onManage={vi.fn()}
        onDownload={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "图谱" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Markdown 原文" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑文档" })).not.toBeInTheDocument();
    expect(container.querySelector(".workbench-toolbar-row")).toBeInTheDocument();
    expect(container.querySelector(".workbench-utility-actions")).toBeInTheDocument();
  });
});
