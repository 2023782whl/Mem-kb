import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embedTexts: vi.fn(),
  query: vi.fn(),
  rerankDocuments: vi.fn()
}));

vi.mock("../src/db/pool.js", () => ({ query: mocks.query, tx: vi.fn() }));
vi.mock("../src/providers/retrieval.js", () => ({
  embedTexts: mocks.embedTexts,
  rerankDocuments: mocks.rerankDocuments
}));

import { retrieveDocumentKnowledge } from "../src/services/document-retrieval.js";

describe("retrieveDocumentKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.embedTexts.mockResolvedValue([Array(1024).fill(0.1)]);
    mocks.rerankDocuments.mockResolvedValue([{ index: 0, score: 0.95 }]);
  });

  it("scopes lexical and vector candidates before ranking", async () => {
    const candidate = {
      id: "chunk-1",
      asset_id: "asset-1",
      chunk_index: 0,
      heading: "标题优化",
      content: "关键词用于标题和主图优化。",
      title: "关键词策略.md",
      gbrain_slug: "tenant/workspace/asset-1",
      score: 0.8
    };
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([]);

    const hits = await retrieveDocumentKnowledge("tenant-a", "workspace-a", "关键词优化");

    expect(hits).toHaveLength(1);
    expect(hits[0]?.assetId).toBe("asset-1");
    expect(mocks.query).toHaveBeenCalledTimes(6);
    for (const [sql, params] of mocks.query.mock.calls) {
      expect(params.slice(0, 2)).toEqual(["tenant-a", "workspace-a"]);
      if (sql.includes("document_chunks")) expect(sql).toContain("c.tenant_id = $1 and c.workspace_id = $2");
      else expect(sql).toMatch(/query_embedding_cache|retrieval_result_cache/);
    }
  });

  it("returns a scoped cached result without model calls", async () => {
    mocks.query.mockResolvedValueOnce([{
      results: [{ chunkId: "chunk-1", assetId: "asset-1", title: "缓存.md", heading: "", content: "缓存内容", slug: null, score: 0.9 }]
    }]);

    const hits = await retrieveDocumentKnowledge("tenant-a", "workspace-a", "重复问题");

    expect(hits[0]?.title).toBe("缓存.md");
    expect(mocks.embedTexts).not.toHaveBeenCalled();
    expect(mocks.rerankDocuments).not.toHaveBeenCalled();
  });
});
