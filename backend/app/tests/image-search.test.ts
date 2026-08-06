import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), embedMultimodal: vi.fn() }));
vi.mock("../src/db/pool.js", () => ({ query: mocks.query }));
vi.mock("../src/providers/embedding.js", () => ({
  embedMultimodal: mocks.embedMultimodal,
  vectorLiteral: () => "[0.1]"
}));

import { searchImagesByText } from "../src/services/image-search.js";

describe("searchImagesByText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns lexical image matches without a remote embedding call", async () => {
    mocks.query.mockResolvedValueOnce([{ id: "image-a", workspace_id: "workspace-b", similarity: 0.9 }]);

    const rows = await searchImagesByText("tenant-a", ["workspace-a", "workspace-b"], "知识问答图片");

    expect(rows[0]?.id).toBe("image-a");
    expect(mocks.embedMultimodal).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[0]?.[1]?.[1]).toEqual(["workspace-a", "workspace-b"]);
  });

  it("embeds once only when lexical recall is empty", async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "image-b", workspace_id: "workspace-b", similarity: 0.8 }]);
    mocks.embedMultimodal.mockResolvedValueOnce(Array(1024).fill(0.1));

    const rows = await searchImagesByText("tenant-a", ["workspace-b", "workspace-a"], "抽象运营氛围");

    expect(rows[0]?.id).toBe("image-b");
    expect(mocks.embedMultimodal).toHaveBeenCalledTimes(1);
  });
});
