# MEM-KB 开源前代码审查计划

## 审查范围

本次审查针对以下几个关键维度：
1. **性能优化** - 数据库查询、向量检索、缓存策略
2. **功能完整性** - RAG 评测、知识巩固、召回质量
3. **代码质量** - 测试覆盖率、错误处理、日志规范
4. **安全加固** - 敏感信息泄露、注入防护、权限控制
5. **开源准备** - 文档完整性、配置示例、部署指南

---

## 1. 性能优化

### 1.1 数据库查询优化

#### 发现的问题：
- ❌ **缺少查询性能监控**：未发现 `EXPLAIN ANALYZE` 或慢查询日志
- ⚠️ **N+1 查询风险**：consolidation 中逐个处理 broken citations（行 158-167）
- ⚠️ **批量操作优化空间**：document-retrieval.ts 中分块插入限制为 100 条（行 70）

#### 建议：
1. **添加慢查询监控**
   - 在 pool.ts 中添加查询耗时跟踪
   - 记录超过阈值（如 1000ms）的查询
   
2. **优化 N+1 查询**
   ```typescript
   // consolidation/service.ts 行 158-167
   // 当前：逐个查询替换资产
   // 优化：使用 batch query + CASE WHEN
   const replacements = await query(`
     select DISTINCT ON (lower(a.title))
       mc.id as citation_id, a.id as asset_id
     from unnest($1::text[]) WITH ORDINALITY as broken(citation_id, ord)
     join message_citations mc on mc.id = broken.citation_id
     join assets a on lower(a.title) = lower(mc.title)
     where a.tenant_id = $2 and a.deleted_at is null
     order by lower(a.title), a.updated_at desc
   `, [brokenIds, tenantId]);
   ```

3. **索引审查清单**
   - [ ] `document_chunks(tenant_id, workspace_id, asset_id)` - 已有？
   - [ ] `document_chunks(embedding) vector_cosine_ops` - 已有 HNSW
   - [ ] `assets(tenant_id, workspace_id, lower(title))` - 用于引用修复
   - [ ] `qa_traces(tenant_id, workspace_id, created_at)` - 用于评测
   - [ ] `message_citations(message_id, asset_id)` - 已有？

### 1.2 向量检索优化

#### 当前实现分析（document-retrieval.ts）：
✅ **已实现的优化**：
- RRF 混合检索（向量 + 全文）
- 查询向量缓存（query_embedding_cache_v2）
- 结果缓存（retrieval_scope_cache，默认 300s TTL）
- Singleflight 去重（防止并发查询重复计算）
- 每个资产最多 2 个分块

⚠️ **可优化点**：
1. **候选数量动态调整**（行 177）
   ```typescript
   // 当前：candidateLimit = base * min(workspaces, 4)
   // 问题：多 workspace 时可能召回过多
   // 建议：根据实际命中率动态调整
   const candidateLimit = Math.min(
     env.retrieval.candidateLimit * workspaceIds.length,
     env.retrieval.candidateLimit * 4
   );
   ```

2. **向量相似度阈值缺失**
   ```typescript
   // 行 188-193 向量查询
   // 建议：添加最低相似度阈值过滤
   where c.tenant_id = $1 
     and c.workspace_id = any($2::text[]) 
     and a.deleted_at is null 
     and a.status = 'ready'
     and (1 - (c.embedding <=> $3::vector)) > 0.7  -- 添加阈值
   ```

3. **缓存击穿保护**
   - 当前已有 Singleflight，但缓存过期后仍有瞬间并发
   - 建议：添加缓存预热机制（热门查询自动续期）

### 1.3 分块策略优化

#### 当前实现（document-chunker.ts）：
- 固定大小：maxChars=1800, minChars=500
- 按段落分割，超长块硬切
- 保留标题层级

⚠️ **改进建议**：
1. **语义分块**（可选升级）
   - 当前是硬分块，可能切断语义单元
   - 建议：添加语义边界检测（如句号、段落完整性）

2. **重叠窗口**
   ```typescript
   // 建议添加：overlapping chunks 提升召回
   export function chunkMarkdown(markdown: string, {
     maxChars = 1800,
     minChars = 500,
     overlap = 200  // 新增：前后重叠 200 字符
   }) {
     // 在 flush() 时保留前一块的末尾 overlap 字符
   }
   ```

---

## 2. RAG 评测与召回质量

### 2.1 评测系统分析（evaluation/service.ts）

✅ **已实现的指标**：
- Recall（召回率）：hit / expected
- Accuracy（准确率）：hit / retrieved
- Citation Correctness（引用正确性）：资产是否存在且有效

⚠️ **缺失的关键指标**：
1. **MRR (Mean Reciprocal Rank)** - 正确文档的排名
2. **NDCG (Normalized DCG)** - 考虑排序的评分
3. **Hit@K** - Top-K 召回率
4. **Answer Relevance** - 答案与问题的相关性（需要 LLM 评分）

#### 建议添加：
```typescript
// evaluation/metrics.ts
export function calculateMRR(retrieved: string[], expected: string[]) {
  for (let i = 0; i < retrieved.length; i++) {
    if (expected.includes(retrieved[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export function calculateHitAtK(retrieved: string[], expected: string[], k: number) {
  const topK = retrieved.slice(0, k);
  return expected.some(id => topK.includes(id)) ? 1 : 0;
}
```

### 2.2 评测数据集质量

#### 当前问题（行 23-40）：
- 仅从历史对话提取（最多 30 条，90 天内）
- 可能存在数据泄露（测试集 = 训练集）
- 缺少多样性保证

#### 建议：
1. **添加合成测试集**
   ```sql
   -- 创建标准测试集表
   CREATE TABLE rag_evaluation_fixtures (
     id text PRIMARY KEY,
     tenant_id text NOT NULL,
     workspace_id text NOT NULL,
     question text NOT NULL,
     expected_document_ids text[] NOT NULL,
     difficulty text, -- 'easy' | 'medium' | 'hard'
     category text,   -- 'factual' | 'reasoning' | 'multi-hop'
     created_by text NOT NULL
   );
   ```

2. **时间分割验证**
   - 使用 T-90d 之前的对话作为评测集
   - T-90d 之后的对话用于索引

---

## 3. 知识巩固功能

### 3.1 当前实现分析（consolidation/service.ts）

✅ **已实现的能力**：
- 定时调度（cron 表达式）
- 引用修复（broken citations）
- 知识结构整理（rebuild relations）
- 租户级别锁（pg_advisory_xact_lock）
- 租约机制（lease_owner）

⚠️ **可改进点**：

1. **并发控制过于保守**
   ```typescript
   // 行 78-84：租户级锁阻止同一租户的所有巩固任务
   // 问题：大租户可能有多个独立 workspace，可以并行处理
   // 建议：改为 workspace 级别锁
   await client.query(
     `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
     [`consolidation:${tenantId}:${workspaceId}`]
   );
   ```

2. **引用修复逻辑不完整**（行 147-171）
   - 仅处理 `deleted_at is not null` 的资产
   - 未处理标题更改、重复标题、跨 workspace 引用
   
   建议添加：
   ```typescript
   // 1. 记录修复历史
   CREATE TABLE citation_repair_log (
     id text PRIMARY KEY,
     run_id text NOT NULL,
     citation_id text NOT NULL,
     old_asset_id text,
     new_asset_id text,
     repair_reason text, -- 'deleted' | 'title_mismatch' | 'duplicate'
     created_at timestamptz DEFAULT now()
   );
   
   // 2. 智能匹配算法
   // - 标题相似度（Levenshtein distance）
   // - 内容向量相似度
   // - 创建时间接近度
   ```

3. **关系重建缺少增量更新**
   ```typescript
   // rebuildWorkspaceRelations() 是全量重建
   // 建议：添加增量更新模式
   export async function incrementalUpdateRelations(
     tenantId: string,
     workspaceId: string,
     since: Date  // 仅处理此时间后的变更
   ) {
     // 只重建受影响的节点和边
   }
   ```

### 3.2 性能与可观测性

#### 建议添加：
1. **进度报告**
   ```typescript
   // 当前：仅在完成时记录总数
   // 建议：流式进度更新
   for (let i = 0; i < workspaces.length; i++) {
     await addLog(run.id, tenantId, "progress", "info", 
       `处理 workspace ${i+1}/${workspaces.length}: ${workspace.name}`
     );
   }
   ```

2. **失败重试机制**
   - 当前：单个 workspace 失败不影响其他
   - 建议：记录失败原因，支持单独重试

---

## 4. 代码质量

### 4.1 测试覆盖率

❌ **严重不足**：
- Backend 有 87 个 TS 文件，但 **0 个测试文件**
- Frontend 有 83 个文件，测试情况未知
- 仅有 mock 模式的回归测试

#### 必须添加的测试：
1. **单元测试优先级**：
   - [ ] `document-chunker.ts` - 分块逻辑
   - [ ] `document-retrieval.ts` - RRF 融合、缓存
   - [ ] `evaluation/metrics.ts` - 评测指标计算
   - [ ] `consolidation/service.ts` - 调度、引用修复
   - [ ] `providers/embedding.ts` - 向量生成
   - [ ] `providers/retrieval.ts` - rerank

2. **集成测试**：
   ```typescript
   // tests/integration/retrieval.test.ts
   describe('Document Retrieval', () => {
     it('should return cached results for duplicate queries', async () => {
       const result1 = await retrieveDocumentKnowledge(tenantId, wsId, 'test');
       const result2 = await retrieveDocumentKnowledge(tenantId, wsId, 'test');
       expect(result1).toEqual(result2);
       // 验证只调用了一次向量 API
     });
     
     it('should respect workspace isolation', async () => {
       // ...
     });
   });
   ```

3. **E2E 测试**：
   - CI 中已配置 Playwright，但未看到测试文件

### 4.2 日志规范

⚠️ **发现的问题**：
- 仍有 20 处 `console.log` / `console.error`
- 应统一使用 pino logger

#### 清理清单：
```bash
# 需要替换为 logger.info() / logger.error()
grep -r "console\\.log\|console\\.error" backend/app/src --include="*.ts"
```

### 4.3 错误处理

✅ **已实现**（errors.ts）：
- 统一错误响应格式
- 生产环境隐藏详细错误信息
- 429/503 错误自动解析 retry-after

⚠️ **改进建议**：
1. **添加错误追踪 ID**
   ```typescript
   export function toHttpErrorResponse(error: unknown, runtime: string) {
     const errorId = createId("error");
     logger.error({ errorId, error }, "Request failed");
     return {
       statusCode: 500,
       body: { 
         error: "internal_error", 
         message: runtime === "production" ? "服务异常" : err.message,
         errorId  // 返回给用户，用于问题排查
       },
       log: true
     };
   }
   ```

2. **结构化错误上报**
   - 集成 Sentry 或类似服务
   - 记录用户上下文（tenantId, userId, traceId）

---

## 5. 安全加固

### 5.1 敏感信息泄露

✅ **已防护**：
- `.env.local` 已在 .gitignore
- 密钥通过环境变量注入
- RLS（Row Level Security）已启用
- 生产环境隐藏错误详情

⚠️ **需要检查**：
1. **日志脱敏**
   ```typescript
   // 确保不记录敏感字段
   logger.info({
     user: { id: user.id, email: maskEmail(user.email) },
     // 不要记录：password_hash, api_key, session_token
   });
   ```

2. **错误消息过滤**
   - SQL 错误可能泄露表结构
   - 文件路径可能泄露部署信息

### 5.2 注入防护

✅ **已防护**：
- 使用参数化查询（$1, $2）
- Zod schema 验证输入

✅ **SSRF 防护**（已在架构文档提及）：
- URL 抓取限制协议、重定向、响应大小
- 内网地址过滤

#### 建议添加检查清单：
```typescript
// services/link-fetcher.ts（需要审查此文件）
function isPrivateIP(hostname: string): boolean {
  // 127.0.0.1, 10.x, 192.168.x, 169.254.x, ::1
}

function isSafeUrl(url: string): boolean {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  if (isPrivateIP(parsed.hostname)) return false;
  return true;
}
```

### 5.3 权限控制

✅ **多层防护**：
- RLS 策略（CI 验证 >= 28 条策略）
- `set local role aiteam_runtime` 降权
- ACL 检查（personal workspace owner 验证）
- OAuth/MCP for GBrain

⚠️ **建议**：
1. **审计日志**
   - 记录敏感操作（删除文档、修改权限、巩固任务）
   - 保留时间策略

2. **速率限制细化**
   - 当前：Fastify rate-limit（全局）
   - 建议：按操作类型分级限制
     - 查询：100/min
     - 上传：10/min
     - 管理操作：5/min

---

## 6. 开源准备

### 6.1 文档完整性

✅ **已有文档**：
- README.md - 完整的功能介绍和快速开始
- 架构文档、API 文档、部署文档
- SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md

⚠️ **需要补充**：
1. **API 文档规范化**
   - 添加 OpenAPI/Swagger 规范
   - 自动生成 API 文档

2. **故障排查指南**
   ```markdown
   # TROUBLESHOOTING.md
   
   ## 常见问题
   
   ### 向量召回率低
   - 检查 embedding 模型配置
   - 验证向量维度一致性
   - 查看 document_chunks 覆盖率
   
   ### GBrain 连接失败
   - 确认 GBRAIN_BASE_URL 和 GBRAIN_TOKEN
   - 检查网络连通性
   ```

3. **性能调优指南**
   ```markdown
   # PERFORMANCE.md
   
   ## 数据库优化
   - 推荐配置 shared_buffers = 256MB
   - 推荐配置 effective_cache_size = 1GB
   - HNSW 索引参数调优
   
   ## 缓存策略
   - 查询向量缓存：默认永久（定期清理）
   - 检索结果缓存：默认 300s
   - 调整 RETRIEVAL_CACHE_TTL_SECONDS
   ```

### 6.2 配置示例

✅ **已有**：
- `.env.example`
- `.env.production.example`
- `config/model.yaml`

⚠️ **需要补充**：
1. **不同规模的配置模板**
   - `config/model.yaml.minimal` - 单模型最小配置
   - `config/model.yaml.full` - 多模型完整示例

2. **Docker Compose 模板**
   - 开发环境（当前 compose.dev.yml ✅）
   - 生产环境（当前 docker-compose.yml ✅）
   - 高可用配置（需要添加）

### 6.3 License 和版权

✅ **已有 MIT License**

⚠️ **需要检查**：
1. **GBrain 版权**
   - 文档提到 "完整 GBrain 0.42.67.0 源码"
   - 需要确认 GBrain 的 License 兼容性
   - 如果是第三方代码，需要在 README 中声明

2. **依赖审计**
   ```bash
   # 检查依赖 License
   npx license-checker --summary
   # 确保没有 GPL 等传染性 License
   ```

---

## 执行优先级

### P0 - 必须修复（开源前）
1. ✅ 添加单元测试（至少核心模块 50% 覆盖率）
2. ✅ 清理所有 console.log，统一使用 logger
3. ✅ 审查 GBrain License 兼容性
4. ✅ 添加 TROUBLESHOOTING.md
5. ✅ SQL 注入防护审计（特别是 link-fetcher）

### P1 - 强烈建议（开源后一个月）
1. ✅ 添加慢查询监控
2. ✅ 优化 consolidation 中的 N+1 查询
3. ✅ 实现 MRR/NDCG 评测指标
4. ✅ 添加错误追踪 ID
5. ✅ 完善评测数据集（合成 + 时间分割）

### P2 - 持续优化
1. ⚙️ 语义分块和重叠窗口
2. ⚙️ 向量相似度阈值动态调整
3. ⚙️ 关系重建增量更新
4. ⚙️ OpenAPI 文档生成
5. ⚙️ 性能调优指南

---

## 下一步行动

1. **用户确认优先级**
   - 哪些问题需要立即修复？
   - 哪些可以作为 GitHub Issues 开源后社区贡献？

2. **创建任务清单**
   - 为每个 P0/P1 项创建独立的实现计划
   - 估算工作量

3. **安全审计**
   - 第三方安全扫描（Snyk, Dependabot）
   - 人工审计高风险模块（auth, permissions, file upload）

---

*此计划基于对以下模块的代码审查生成：*
- `backend/app/src/services/document-retrieval.ts`
- `backend/app/src/services/document-chunker.ts`
- `backend/app/src/modules/evaluation/service.ts`
- `backend/app/src/modules/consolidation/service.ts`
- `backend/app/src/providers/embedding.ts`
- `backend/app/src/providers/retrieval.ts`
- `backend/app/src/http/errors.ts`
- `backend/app/src/db/pool.ts`
- 架构文档和部署文档
