import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../services/document-chunker.js";

describe("chunkMarkdown", () => {
  it("should split long document into chunks", () => {
    const markdown = "# 标题\n\n" + "段落内容包含足够的文字来触发分块。".repeat(100) + "\n\n## 第二部分\n\n" + "更多内容。".repeat(100);
    const chunks = chunkMarkdown(markdown, 1000, 300);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].heading).toBe("标题");
    expect(chunks[0].content.length).toBeLessThanOrEqual(1000);
    expect(chunks[0].hash).toBeDefined();
  });

  it("should preserve heading hierarchy", () => {
    const markdown = `# 一级标题

第一段内容。

## 二级标题

第二段内容。

### 三级标题

第三段内容。`;

    const chunks = chunkMarkdown(markdown);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].heading).toMatch(/标题/);
  });

  it("should merge short sections", () => {
    const markdown = `# 标题

短段落1

短段落2

短段落3`;

    const chunks = chunkMarkdown(markdown, 1800, 500);
    // 短段落应该合并成一个 chunk
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain("短段落1");
    expect(chunks[0].content).toContain("短段落2");
    expect(chunks[0].content).toContain("短段落3");
  });

  it("should split very long blocks", () => {
    const veryLongParagraph = "x".repeat(3000);
    const markdown = `# 标题\n\n${veryLongParagraph}`;

    const chunks = chunkMarkdown(markdown, 1800, 500);
    expect(chunks.length).toBeGreaterThan(1);
    // 每个 chunk 不应超过 maxChars
    chunks.forEach(chunk => {
      expect(chunk.content.length).toBeLessThanOrEqual(1800);
    });
  });

  it("should generate unique hash for each chunk", () => {
    const markdown = `# 标题1

内容1

# 标题2

内容2`;

    const chunks = chunkMarkdown(markdown);
    const hashes = chunks.map(c => c.hash);
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(hashes.length);
  });

  it("should handle empty or whitespace-only markdown", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("   \n\n   ")).toEqual([]);
  });

  it("should assign sequential indices", () => {
    const markdown = "# 标题\n\n" + "段落。\n\n".repeat(100);
    const chunks = chunkMarkdown(markdown, 500, 200);

    chunks.forEach((chunk, index) => {
      expect(chunk.index).toBe(index);
    });
  });

  it("should use custom maxChars and minChars", () => {
    const markdown = "段落。".repeat(50);
    const chunks1 = chunkMarkdown(markdown, 1000, 300);
    const chunks2 = chunkMarkdown(markdown, 500, 100);

    // 更小的 maxChars 应该产生更多 chunks
    expect(chunks2.length).toBeGreaterThanOrEqual(chunks1.length);
  });
});
