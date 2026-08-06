import { describe, expect, it } from "vitest";
import type { AssetMedia } from "../src/db/schema.js";
import { buildIndexMarkdown, countDataImages, countProtectedMedia } from "../src/services/document-media.js";
import { evaluateDocumentQuality } from "../src/services/document-quality.js";

const media: AssetMedia = {
  id: "media-1",
  tenant_id: "tenant",
  workspace_id: "workspace",
  asset_id: "asset-1",
  storage_key: "document-media/asset-1/image.png",
  mime_type: "image/png",
  size_bytes: 10,
  sha256: "hash",
  width: 100,
  height: 80,
  sequence: 0,
  alt_text: "流程图",
  ocr_text: "提交审核",
  description: "运营流程图",
  anchor: { sequence: 0 },
  metadata: {},
  created_at: "",
  updated_at: ""
};

describe("document media", () => {
  it("keeps protected media in display Markdown and text evidence in index Markdown", () => {
    const markdown = "正文\n\n![流程图](/api/assets/asset-1/media/media-1)\n\n结尾";
    expect(countProtectedMedia(markdown, "asset-1")).toBe(1);
    expect(buildIndexMarkdown(markdown, [media])).toContain("图片：运营流程图；OCR：提交审核");
    expect(buildIndexMarkdown(markdown, [media])).not.toContain("/api/assets/");
  });

  it("fails quality checks when source media is missing or Base64 remains", () => {
    const quality = evaluateDocumentQuality({
      sourceMediaCount: 2,
      rawMarkdown: "![a](data:image/png;base64,AA==)",
      displayMarkdown: "![a](data:image/png;base64,AA==)",
      assetId: "asset-1",
      uniqueMediaCount: 0
    });
    expect(countDataImages("![a](data:image/png;base64,AA==)")).toBe(1);
    expect(quality.passed).toBe(false);
    expect(quality.missingMediaCount).toBe(2);
  });

  it("passes the seven-image acceptance gate", () => {
    const images = Array.from({ length: 7 }, (_, index) => `![图${index + 1}](/api/assets/asset-1/media/media-${index + 1})`).join("\n");
    const quality = evaluateDocumentQuality({
      sourceMediaCount: 7,
      rawMarkdown: images,
      displayMarkdown: images,
      assetId: "asset-1",
      uniqueMediaCount: 7
    });
    expect(quality).toMatchObject({ sourceMediaCount: 7, outputImageReferences: 7, missingMediaCount: 0, passed: true });
  });
});
