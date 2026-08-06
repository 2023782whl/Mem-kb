# 故障排查指南

本文档帮助你快速定位和解决 MEM-KB 常见问题。

## 目录

- [检索相关](#检索相关)
- [性能问题](#性能问题)
- [数据库问题](#数据库问题)
- [GBrain 连接](#gbrain-连接)
- [向量索引](#向量索引)
- [队列和后台任务](#队列和后台任务)

---

## 检索相关

### 问题：向量召回率低

**症状：** RAG 评测显示 Recall < 0.8，问答无法找到相关文档

**可能原因与解决方案：**

1. **向量模型配置不一致**
   ```bash
   # 检查 backend/app 和 GBrain 的向量模型是否一致
   grep -r "text-embedding" backend/app/config/
   grep -r "text-embedding" backend/gbrain/gbrain.yml
   ```
   
   确保：
   - `backend/app/config/model.yaml` 中的 embedding 模型
   - `backend/gbrain/gbrain.yml` 中的 embedding_model
   - 两者使用相同的模型和维度（默认 1024 维）

2. **向量维度不匹配**
   ```sql
   -- 检查 document_chunks 表中的向量维度
   SELECT vector_dims(embedding) as dims, count(*) 
   FROM document_chunks 
   GROUP BY dims;
   ```
   
   如果发现多个维度，需要重新生成向量：
   ```bash
   npm --prefix backend/app run embedding:backfill
   ```

3. **document_chunks 覆盖率不足**
   ```sql
   -- 检查有多少资产已索引
   SELECT 
     count(DISTINCT a.id) as total_assets,
     count(DISTINCT c.asset_id) as indexed_assets
   FROM assets a
   LEFT JOIN document_chunks c ON c.asset_id = a.id
   WHERE a.deleted_at IS NULL AND a.status = 'ready';
   ```
   
   如果 indexed_assets < total_assets，运行：
   ```bash
   npm --prefix backend/app run embedding:backfill
   ```

4. **相似度阈值过高**
   
   检查 `.env.local`:
   ```bash
   RETRIEVAL_MIN_SIMILARITY_THRESHOLD=0.7  # 默认值
   ```
   
   如果召回率低，可以临时降低阈值（如 0.6）来排查是否是阈值问题。

### 问题：检索速度慢

**症状：** 查询响应时间超过 3 秒

**排查步骤：**

1. **检查是否有慢查询**
   ```bash
   # 查看日志中的慢查询警告
   tail -f backend/app/logs/aiteam-api.log | grep "Slow query"
   ```

2. **检查 HNSW 索引是否存在**
   ```sql
   SELECT indexname, indexdef 
   FROM pg_indexes 
   WHERE tablename = 'document_chunks' 
     AND indexdef LIKE '%hnsw%';
   ```
   
   如果没有索引，创建：
   ```sql
   CREATE INDEX document_chunks_embedding_idx 
   ON document_chunks 
   USING hnsw (embedding vector_cosine_ops);
   ```

3. **检查缓存命中率**
   
   同一查询第二次应该< 10ms。如果始终慢，检查：
   - Redis 是否正常运行
   - `RETRIEVAL_CACHE_TTL_SECONDS` 配置

4. **检查候选数量**
   
   `.env.local`:
   ```bash
   RETRIEVAL_CANDIDATE_LIMIT=30  # 默认值
   RETRIEVAL_RERANK_INPUT_LIMIT=20
   ```
   
   如果设置过大（如 100+），会影响性能。

---

## 性能问题

### 问题：数据库连接池耗尽

**症状：** 报错 `Error: Connection pool timeout`

**解决方案：**

1. **增加连接池大小**
   
   `.env.local`:
   ```bash
   DATABASE_POOL_MAX=20  # 默认 10
   ```

2. **检查是否有长事务未释放**
   ```sql
   SELECT pid, state, query_start, state_change, query
   FROM pg_stat_activity
   WHERE state != 'idle' 
     AND (now() - query_start) > interval '30 seconds';
   ```
   
   如果有卡住的事务，可以手动终止：
   ```sql
   SELECT pg_terminate_backend(pid);
   ```

3. **检查慢查询**
   
   设置环境变量启用慢查询日志：
   ```bash
   SLOW_QUERY_THRESHOLD_MS=1000  # 默认值
   ```

### 问题：内存占用过高

**症状：** Node.js 进程内存持续增长

**排查步骤：**

1. **检查缓存大小**
   ```sql
   -- 检查查询向量缓存
   SELECT count(*), pg_size_pretty(sum(octet_length(embedding::text))) 
   FROM query_embedding_cache_v2;
   
   -- 检查检索结果缓存
   SELECT count(*), pg_size_pretty(sum(octet_length(results::text))) 
   FROM retrieval_scope_cache;
   ```
   
   清理过期缓存：
   ```sql
   DELETE FROM query_embedding_cache_v2 
   WHERE last_used_at < now() - interval '7 days';
   
   DELETE FROM retrieval_scope_cache 
   WHERE expires_at < now();
   ```

2. **检查向量数据大小**
   ```sql
   SELECT 
     pg_size_pretty(pg_total_relation_size('document_chunks')) as total_size,
     count(*) as chunk_count
   FROM document_chunks;
   ```

3. **Node.js 堆内存限制**
   
   如果需要处理大量数据，增加内存限制：
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm run dev:api
   ```

---

## 数据库问题

### 问题：迁移失败

**症状：** `npm run db:setup` 报错

**解决方案：**

1. **检查 PostgreSQL 版本**
   ```sql
   SELECT version();
   ```
   
   需要 PostgreSQL 17+ 和 pgvector 扩展。

2. **检查 pgvector 扩展**
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'vector';
   ```
   
   如果不存在：
   ```sql
   CREATE EXTENSION vector;
   ```

3. **检查权限**
   ```sql
   SELECT rolname, rolsuper, rolcreaterole, rolcreatedb 
   FROM pg_roles 
   WHERE rolname IN ('aiteam_owner', 'aiteam_runtime');
   ```
   
   确保 `aiteam_owner` 有创建权限。

### 问题：RLS 策略阻止查询

**症状：** 查询返回空结果，但数据确实存在

**排查：**

1. **检查当前上下文**
   ```sql
   SELECT current_setting('app.tenant_id', true),
          current_setting('app.user_id', true),
          current_setting('app.system', true);
   ```

2. **临时禁用 RLS 测试**（仅开发环境）
   ```sql
   ALTER TABLE assets DISABLE ROW LEVEL SECURITY;
   -- 测试查询
   ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
   ```

3. **检查策略数量**
   ```sql
   SELECT count(*) FROM pg_policies;
   ```
   
   应该 >= 28 条策略（CI 要求）。

---

## GBrain 连接

### 问题：GBrain 服务不可用

**症状：** 报错 `GBrain connection failed` 或 `ECONNREFUSED`

**解决方案：**

1. **检查 GBrain 是否运行**
   ```bash
   curl http://127.0.0.1:3131/health
   ```
   
   如果无响应，启动 GBrain：
   ```bash
   npm run dev:gbrain
   ```

2. **检查配置**
   
   `.env.local`:
   ```bash
   GBRAIN_BASE_URL=http://127.0.0.1:3131
   GBRAIN_MCP_URL=http://127.0.0.1:3131/mcp
   GBRAIN_TOKEN=your-token-here  # 可选
   ```

3. **检查网络连通性**
   ```bash
   nc -zv 127.0.0.1 3131
   ```

4. **查看 GBrain 日志**
   ```bash
   # GBrain 的日志输出位置取决于启动方式
   tail -f backend/gbrain/logs/*.log
   ```

### 问题：GBrain 向量维度不匹配

**症状：** 报错 `Vector dimension mismatch`

**解决方案：**

GBrain 使用专门的迁移命令更新向量：
```bash
cd backend/gbrain
bun run src/cli.ts migrate embeddings \
  --model dashscope:text-embedding-v3 \
  --dimensions 1024
```

**不要**直接修改 GBrain 的内部向量列。

---

## 向量索引

### 问题：向量查询很慢，即使有 HNSW 索引

**排查步骤：**

1. **检查索引参数**
   ```sql
   SELECT indexname, indexdef 
   FROM pg_indexes 
   WHERE tablename = 'document_chunks';
   ```
   
   HNSW 索引应该使用 `vector_cosine_ops`。

2. **检查索引是否被使用**
   ```sql
   EXPLAIN ANALYZE
   SELECT id FROM document_chunks
   WHERE tenant_id = 'your-tenant-id'
   ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
   LIMIT 10;
   ```
   
   应该看到 `Index Scan using document_chunks_embedding_idx`。

3. **重建索引**
   ```sql
   REINDEX INDEX document_chunks_embedding_idx;
   ```

4. **调整 HNSW 参数**（需要重建索引）
   ```sql
   DROP INDEX IF EXISTS document_chunks_embedding_idx;
   CREATE INDEX document_chunks_embedding_idx 
   ON document_chunks 
   USING hnsw (embedding vector_cosine_ops)
   WITH (m = 16, ef_construction = 64);  -- 调整这些参数
   ```

---

## 队列和后台任务

### 问题：资产处理卡住

**症状：** 上传文档后，状态一直是 `indexing`

**排查步骤：**

1. **检查 Worker 是否运行**
   ```bash
   ps aux | grep "worker.ts"
   ```
   
   如果没有运行：
   ```bash
   npm run dev:worker
   ```

2. **检查 Redis 连接**
   ```bash
   redis-cli ping
   ```
   
   应该返回 `PONG`。

3. **检查队列中的任务**
   ```bash
   redis-cli
   > LLEN "bull:aiteam-asset-processing:wait"
   > LLEN "bull:aiteam-asset-processing:active"
   > LLEN "bull:aiteam-asset-processing:failed"
   ```

4. **查看失败任务**
   ```sql
   SELECT id, title, status, error 
   FROM assets 
   WHERE status = 'failed' 
   ORDER BY updated_at DESC 
   LIMIT 10;
   ```

5. **重试失败的资产**
   ```sql
   UPDATE assets 
   SET status = 'queued', error = NULL 
   WHERE id = 'asset-id-here';
   ```

### 问题：夜间巩固任务失败

**症状：** `consolidation_runs` 表中状态为 `failed`

**排查：**

1. **查看失败原因**
   ```sql
   SELECT id, error, created_at 
   FROM consolidation_runs 
   WHERE status = 'failed' 
   ORDER BY created_at DESC 
   LIMIT 5;
   ```

2. **查看日志**
   ```sql
   SELECT phase, status, detail, created_at 
   FROM consolidation_logs 
   WHERE run_id = 'your-run-id' 
   ORDER BY created_at;
   ```

3. **手动触发巩固**
   
   通过 API 或直接调用：
   ```bash
   curl -X POST http://127.0.0.1:8788/api/consolidation/run \
     -H "Cookie: session=your-session-cookie"
   ```

---

## 常见错误代码

| 错误代码 | 含义 | 解决方案 |
|---------|------|----------|
| `invalid_qa_scope` | Workspace 不存在或无权限 | 检查 workspace_id 和用户权限 |
| `rate_limit_exceeded` | 请求过于频繁 | 等待后重试，或调整 `QA_REQUESTS_PER_MINUTE` |
| `dependency_unavailable` | 外部服务不可用 | 检查模型 API、GBrain、Redis 连接 |
| `permission_denied` | 权限不足 | 检查用户角色和 workspace 成员关系 |

---

## 性能调优建议

### PostgreSQL 配置

推荐在 `postgresql.conf` 中设置：

```ini
shared_buffers = 256MB          # 至少 256MB
effective_cache_size = 1GB      # 系统可用内存的 50-75%
work_mem = 16MB                 # 复杂查询的工作内存
maintenance_work_mem = 128MB    # 索引创建和维护
random_page_cost = 1.1          # SSD 磁盘
```

### 向量检索参数

`.env.local`:
```bash
# 召回阶段候选数量（每个 workspace）
RETRIEVAL_CANDIDATE_LIMIT=30

# 送入 rerank 的数量
RETRIEVAL_RERANK_INPUT_LIMIT=20

# 最终返回结果数量
RETRIEVAL_RESULT_LIMIT=10

# 最低向量相似度
RETRIEVAL_MIN_SIMILARITY_THRESHOLD=0.7

# 结果缓存时间（秒）
RETRIEVAL_CACHE_TTL_SECONDS=300
```

### 慢查询阈值

```bash
SLOW_QUERY_THRESHOLD_MS=1000  # 超过 1 秒记录警告
```

---

## 获取帮助

如果以上方法无法解决问题：

1. **查看日志**
   ```bash
   tail -f backend/app/logs/aiteam-api.log
   ```

2. **启用调试模式**
   ```bash
   LOG_LEVEL=debug npm run dev
   ```

3. **提交 Issue**
   
   请包含：
   - 错误信息和堆栈
   - 相关配置（隐藏敏感信息）
   - PostgreSQL 和 Node.js 版本
   - 复现步骤

4. **查看项目文档**
   - [架构文档](docs/03-architecture.md)
   - [部署文档](docs/10-deployment-and-operations.md)
   - [API 文档](docs/04-api-and-data-contract.md)
