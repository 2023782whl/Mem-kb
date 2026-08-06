import { describe, expect, it } from "vitest";
import { notePublicationHash } from "../src/modules/notes/publication.js";

describe("note publication", () => {
  it("produces a stable hash and changes only when publishable content changes", () => {
    const note = { title: "运营方案", content_markdown: "## 结论\n执行 A", content_json: { type: "doc" }, tags: ["SOP"] };
    expect(notePublicationHash(note)).toBe(notePublicationHash({ ...note, tags: ["SOP", "SOP"] }));
    expect(notePublicationHash(note)).not.toBe(notePublicationHash({ ...note, content_markdown: `${note.content_markdown}\n执行 B` }));
  });
});
