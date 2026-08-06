# 混合召回与向量迁移交付

## 当前状态

2026-08-02 已完成文档向量召回迁移：

- Mem-kb：9 个真实文档资产、1542 个分块，向量覆盖率 100%。
- GBrain：134 个可检索分块，向量覆盖率 100%。
- 两层向量均为 1024 维，模型为 `text-embedding-v3`。
- 精排模型为 `qwen3-rerank`。
- 图片继续使用独立的 `multimodal-embedding-v1` 向量空间。

## 检索链路

```text
ACL 校验
  -> Workspace 结果缓存
  -> PostgreSQL 全文候选 + 1024 维向量候选
  -> 候选阶段限定 Tenant/Workspace
  -> RRF 融合
  -> qwen3-rerank 精排
  -> 每个资产最多保留 2 个分块
  -> Top 10 交给 GPT-5.5
  -> 无本地结果时回退 GBrain
```

业务库的 `document_chunks` 不是新的知识源。Markdown Asset 与 GBrain 页面仍是知识内容，业务向量层只承担安全隔离和低延迟候选召回。

## 配置映射

`backend/app/config/model.yaml` 是 Mem-kb 模型目录：

- `embedding_qwen_text_embedding_v3` -> `text-embedding-v3` -> 1024 维。
- `reranker_aliyun_qwen3_rerank` -> `qwen3-rerank`。
- `embedding_aliyun_multimodal_v1` -> 图片跨模态向量。

GBrain 文件配置显式映射为：

```json
{
  "embedding_model": "dashscope:text-embedding-v3",
  "embedding_dimensions": 1024
}
```

密钥只从本地环境变量注入，不进入 YAML、文档或前端。

## 索引策略

- Markdown 按段落和标题切分，目标上限 1800 字，短章节合并到约 500 字后再切分。
- 每个分块保存内容哈希；文档重建时复用未变化分块的向量。
- 文档编辑、重新解析和删除会使当前 Workspace 的检索结果缓存失效。
- 查询向量按 Tenant/Workspace 缓存；最终结果短缓存默认 300 秒。
- `document_chunks` 使用 HNSW cosine 索引，全文候选使用 `pg_trgm` GIN 索引。

## 运维命令

```bash
npm --prefix backend/app run db:setup
npm --prefix backend/app run embedding:backfill
npm run dev:gbrain
npm --prefix backend/app test
npm run typecheck
npm run build
npm run test:regression
```

GBrain 迁移使用其官方 `migrate embeddings` 命令，不直接修改内部向量列。

## 验收结果

- `text-embedding-v3` 实际探针返回 1024 维。
- `qwen3-rerank` 实际连通和 GBrain model doctor 均通过。
- 个人 Workspace 能召回真实 DOCX/Markdown；空的客服 Workspace 返回 0 条。
- 真实 GPT-5.5 问答返回 2236 字回答，并引用真实 DOCX 和 PRD。
- 首次公网检索约 4.3 秒；同一高频问题缓存命中约 1 毫秒。
- 后端单元测试、全链路回归、前后端类型检查和生产构建全部通过。
