import { describe, expect, it } from "vitest";
import { normalizeNoteTags, noteBodyFromPage, notePageContent } from "../src/modules/notes/content.js";

describe("note content", () => {
  it("serializes markdown with stable frontmatter", () => {
    const content = notePageContent({
      title: "运营复盘",
      content_markdown: "## 结论\n\n保留有效策略。",
      tags: ["运营", "复盘", "运营"],
      workspace_id: "workspace-1",
      owner_id: "user-1"
    });
    expect(content).toContain('title: "运营复盘"');
    expect(content).toContain('tags: ["运营", "复盘"]');
    expect(noteBodyFromPage(content)).toBe("## 结论\n\n保留有效策略。");
  });

  it("normalizes and caps tags", () => {
    expect(normalizeNoteTags([" 运营 ", "运营", "复盘", "", "SOP"])).toEqual(["运营", "复盘", "SOP"]);
    expect(normalizeNoteTags(Array.from({ length: 12 }, (_, index) => `标签${index}`))).toHaveLength(8);
  });
});
