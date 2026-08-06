# API 与数据契约

## 统一约定

- 前缀：`/api/v1`。
- 认证：HttpOnly Cookie。
- 错误：`{ code, message, field?, requestId }`。
- 分页：`limit + cursor`。
- 时间：ISO 8601 UTC。
- ID：UUIDv7/ULID。
- 问答流：SSE，事件为 `meta`、`delta`、`citation`、`done`、`error`。
- 所有业务请求由服务端从会话中取得 `tenant_id`，不信任客户端传入租户 ID。

## Auth 与租户

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/auth/login` | public | 邮箱密码登录 |
| POST | `/auth/logout` | logged-in | 注销当前会话 |
| GET | `/auth/me` | logged-in | 当前账号、租户、角色和 Workspace |
| POST | `/auth/session/refresh` | logged-in | 滑动续期 |

## 模型目录

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/models` | logged-in | 返回已启用且健康的模型及能力 |

模型响应只包含 `id`、`name`、`iconUrl`、`capabilities`、`supportsVision` 和状态，不返回 API Key、内部 Base URL。

## Workspace

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/workspaces` | logged-in | 可见的个人/团队 Workspace |
| POST | `/workspaces` | `workspace.write` | 创建 Workspace |
| GET | `/workspaces/:id` | `workspace.read` | 详情、统计和索引状态 |
| PATCH | `/workspaces/:id` | `workspace.write` | 重命名、类型和说明 |
| DELETE | `/workspaces/:id` | `workspace.manage` | 归档/软删除 |

创建请求：

```json
{
  "name": "电商运营知识库",
  "scope": "team",
  "kind": "document",
  "description": "运营 SOP、策略和复盘"
}
```

## Assets

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/workspaces/:id/assets` | `asset.read` | 搜索、类型筛选、排序、分页 |
| POST | `/workspaces/:id/assets` | `asset.upload` | multipart 多文件上传 |
| POST | `/workspaces/:id/links` | `asset.upload` | 抓取 URL 并建立网页 Asset |
| GET | `/assets/:id` | `asset.read` | 元数据、摘要、状态和引用统计 |
| GET | `/assets/:id/content` | `asset.read` | 预览/下载，支持 Range |
| GET | `/assets/:id/extracted` | `asset.read` | 提取文本和 chunk 定位信息 |
| DELETE | `/assets/:id` | `asset.delete` | 软删除并安排 GBrain 删除 |
| POST | `/assets/:id/retry` | `asset.upload` | 重试解析/VLM/索引 |
| POST | `/assets/:id/refresh` | `asset.upload` | 重新抓取 URL 类型 Asset |

资产状态机：

```text
uploading -> uploaded -> queued -> extracting -> indexing -> ready
                                  └──────────────-> failed
ready -> archived -> deleted
```

图片在 `extracting` 内细分 OCR、VLM 和 embedding 进度，前端仍展示统一百分比。

## 知识问答

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/conversations` | `qa.ask` | 最近会话 |
| POST | `/conversations` | `qa.ask` | 新建会话和知识范围 |
| GET | `/conversations/:id` | owner | 消息与引用 |
| POST | `/conversations/:id/messages` | `qa.ask` | SSE 流式回答 |
| POST | `/messages/:id/feedback` | owner | 点赞/点踩 |
| POST | `/messages/:id/capture` | `qa.capture` | 回答沉淀为 Markdown Asset |
| GET | `/qa/top-questions` | `qa.ask` | 当前权限范围高频问题 |
| GET | `/qa/top-assets` | `asset.read` | 当前权限范围高频引用资产 |

发送问题：

```json
{
  "content": "分析这个链接并结合运营 SOP 给出建议：https://example.com/article",
  "modelId": "gpt-5.5",
  "sources": {
    "webSearch": true,
    "documents": true,
    "images": false
  },
  "scope": {
    "workspaceIds": ["01J..."],
    "assetIds": []
  },
  "links": ["https://example.com/article"]
}
```

SSE：

```text
event: meta
data: {"messageId":"01J...","model":"gpt-5.5"}

event: delta
data: {"text":"根据网页内容和运营 SOP，建议先…"}

event: citation
data: {"index":1,"kind":"document","assetId":"01J...","title":"商品运营SOP","snippet":"..."}

event: citation
data: {"index":2,"kind":"web","url":"https://example.com/article","title":"...","snippet":"..."}

event: done
data: {"usage":{"inputTokens":1200,"outputTokens":320}}
```

沉淀回答：

```json
{
  "workspaceId": "01J...",
  "title": "商品主图优化策略",
  "content": "# 商品主图优化策略\n\n..."
}
```

接口只有在 Markdown 已保存且 GBrain `put_page` 成功后返回 `status: ready`；异步模式返回 `status: indexing` 和可查询 jobId。

## 图片类目、商品与检索

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/workspaces/:id/categories` | `workspace.read` | 类目树 |
| POST | `/workspaces/:id/categories` | `workspace.write` | 创建一至三级类目 |
| PATCH | `/categories/:id` | `workspace.write` | 重命名/移动类目 |
| POST | `/categories/:id/products` | `workspace.write` | 三级类目下创建商品 |
| GET | `/products/:id/images` | `asset.read` | 商品图片列表 |
| POST | `/products/:id/images` | `asset.upload` | 上传图片 |
| POST | `/image-search/text` | `image.search` | 文搜图 |
| POST | `/image-search/image` | `image.search` | multipart 图搜图 |

文搜图请求：

```json
{
  "query": "白底护肤品主图，强调清爽和补水",
  "workspaceIds": ["01J..."],
  "categoryId": "01J...",
  "limit": 30
}
```

图片搜索返回相似度、缩略图、VLM 摘要、所属类目和商品。服务端先应用 Tenant/Workspace ACL，再执行 pgvector 检索。

## Graph

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/workspaces/:id/graph` | `workspace.read` | Workspace 图谱概览 |
| GET | `/assets/:id/graph` | `asset.read` | 文档/图片邻接图 |

查询参数：`depth=1..3`、`types=document,image,product,category,person,topic,sop`、`q=`。

```json
{
  "nodes": [
    {
      "id": "asset:01J...",
      "type": "document",
      "label": "客服话术",
      "summary": "该文档定义了售前、售中和售后标准话术…",
      "assetId": "01J..."
    }
  ],
  "edges": [
    { "id": "e1", "source": "asset:01J...", "target": "topic:服务支持", "type": "supports" }
  ]
}
```

## 业务数据表

```text
tenants
  id, name, status, created_at

users
  id, tenant_id, email, password_hash, display_name, status, created_at

sessions
  id, tenant_id, user_id, token_hash, expires_at, last_seen_at, ip, user_agent

workspaces
  id, tenant_id, owner_id, name, scope(personal|team),
  kind(document|image|mixed), gbrain_source_id, archived_at

workspace_members
  tenant_id, workspace_id, user_id, role(owner|editor|viewer)

categories
  id, tenant_id, workspace_id, parent_id, level(1|2|3), name, sort_order

products
  id, tenant_id, workspace_id, category_id, name, attributes_json

assets
  id, tenant_id, workspace_id, product_id, owner_id,
  type(document|image|webpage|ai_answer), name, mime_type,
  size, sha256, storage_key, status, progress, error_code,
  summary, ocr_text, gbrain_slug, source_url, extracted_at, deleted_at

image_embeddings
  tenant_id, asset_id, model_id, embedding vector(N), created_at

conversations
  id, tenant_id, user_id, title, model_id, source_flags_json,
  scope_json, created_at, updated_at

messages
  id, tenant_id, conversation_id, role, content, model_id,
  status, token_usage_json

message_citations
  tenant_id, message_id, citation_index, kind,
  asset_id, gbrain_slug, chunk_id, url, snippet

message_feedback
  tenant_id, message_id, user_id, rating(up|down), reason, created_at

query_events
  id, tenant_id, user_id, normalized_question, workspace_ids,
  message_id, created_at

jobs
  id, tenant_id, type, asset_id, status, attempts,
  payload_json, run_after, error

audit_logs
  id, tenant_id, actor_id, action, resource_type,
  resource_id, result, metadata_json, created_at
```

所有租户业务表启用 PostgreSQL RLS；组合唯一键和索引包含 `tenant_id`。

## GBrain 适配器

```ts
interface GBrainAdapter {
  health(): Promise<Health>;
  putPage(input: PutPageInput): Promise<PageRef>;
  getPage(slug: string): Promise<GBrainPage>;
  listPages(input: ListPagesInput): Promise<GBrainPageSummary[]>;
  search(input: SearchInput): Promise<SearchHit[]>;
  getLinks(slug: string): Promise<Link[]>;
  getBacklinks(slug: string): Promise<Link[]>;
  traverseGraph(slug: string, depth: number): Promise<GraphResult>;
  deletePage(slug: string): Promise<void>;
}
```

开发阶段可用本机 CLI 适配器；正式服务使用 GBrain HTTP MCP + OAuth，避免每个请求创建新进程。每次调用都必须带当前 Workspace 对应的 source scope。
