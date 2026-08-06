import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../src/services/document-chunker.js";

describe("chunkMarkdown", () => {
  it("keeps headings and produces stable bounded chunks", () => {
    const markdown = `# 运营 SOP\n\n${"执行步骤。".repeat(300)}\n\n## 复盘\n\n记录结果。`;
    const chunks = chunkMarkdown(markdown, 600);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].heading).toBe("运营 SOP");
    expect(chunks.at(-1)?.heading).toBe("复盘");
    expect(chunks.every((chunk) => chunk.content.length <= 1_200 && chunk.hash.length === 64)).toBe(true);
  });

  it("keeps short sections together until the target size is reached", () => {
    const markdown = Array.from({ length: 12 }, (_, index) => `## 小节 ${index + 1}\n\n${"内容".repeat(40)}`).join("\n\n");
    const chunks = chunkMarkdown(markdown, 600, 300);

    expect(chunks.length).toBeLessThan(12);
    expect(chunks.every((chunk) => chunk.content.length <= 600)).toBe(true);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
  });
});
