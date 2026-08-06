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
      workspace_id: "workspace-a",
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
      expect(params[0]).toBe("tenant-a");
      if (sql.includes("document_chunks")) {
        expect(params[1]).toEqual(["workspace-a"]);
        expect(sql).toContain("c.workspace_id = any($2::text[])");
      } else {
        expect(sql).toMatch(/query_embedding_cache_v2|retrieval_scope_cache/);
      }
    }
  });

  it("returns a scoped cached result without model calls", async () => {
    mocks.query.mockResolvedValueOnce([{
      results: [{ chunkId: "chunk-1", workspaceId: "workspace-a", assetId: "asset-1", title: "缓存.md", heading: "", content: "缓存内容", slug: null, score: 0.9 }]
    }]);

    const hits = await retrieveDocumentKnowledge("tenant-a", "workspace-a", "重复问题");

    expect(hits[0]?.title).toBe("缓存.md");
    expect(mocks.embedTexts).not.toHaveBeenCalled();
    expect(mocks.rerankDocuments).not.toHaveBeenCalled();
  });

  it("embeds and reranks once across multiple workspaces", async () => {
    const left = { id: "left", workspace_id: "workspace-a", asset_id: "asset-a", chunk_index: 0, heading: "A", content: "A 内容", title: "A.md", gbrain_slug: null, score: 0.7 };
    const right = { id: "right", workspace_id: "workspace-b", asset_id: "asset-b", chunk_index: 0, heading: "B", content: "B 内容", title: "B.md", gbrain_slug: null, score: 0.9 };
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([left, right])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([right, left])
      .mockResolvedValueOnce([]);
    mocks.rerankDocuments.mockResolvedValueOnce([{ index: 1, score: 0.98 }, { index: 0, score: 0.8 }]);

    const hits = await retrieveDocumentKnowledge("tenant-a", ["workspace-b", "workspace-a"], "统一查询");

    expect(mocks.embedTexts).toHaveBeenCalledTimes(1);
    expect(mocks.rerankDocuments).toHaveBeenCalledTimes(1);
    expect(hits.map((item) => item.workspaceId).sort()).toEqual(["workspace-a", "workspace-b"]);
    const documentCalls = mocks.query.mock.calls.filter(([sql]) => String(sql).includes("document_chunks"));
    expect(documentCalls.every(([, params]) => JSON.stringify(params[1]) === JSON.stringify(["workspace-a", "workspace-b"]))).toBe(true);
  });
});
