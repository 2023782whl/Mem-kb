import { describe, expect, it } from "vitest";
import { normalizeAssistantMarkdown } from "./markdownNormalize";

describe("normalizeAssistantMarkdown", () => {
  it("unwraps assistant markdown fences and restores escaped headings", () => {
    expect(normalizeAssistantMarkdown("```markdown\n\\# 标题\n\n\\##小节\n\n• 要点\n```")).toBe("# 标题\n\n## 小节\n\n- 要点");
  });

  it("normalizes full-width heading marks without changing body text", () => {
    expect(normalizeAssistantMarkdown("＃＃ 业务场景\n\n正文内容")).toBe("## 业务场景\n\n正文内容");
  });
});
