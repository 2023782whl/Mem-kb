import { describe, expect, it } from "vitest";
import { resolveFileFormat } from "./FileTypeIcon";

describe("resolveFileFormat", () => {
  it("prefers the filename extension", () => {
    expect(resolveFileFormat("txt", "季度复盘.PDF")).toBe("pdf");
  });

  it("normalizes the supplied format", () => {
    expect(resolveFileFormat("DOCX", "没有扩展名")).toBe("docx");
  });
});
