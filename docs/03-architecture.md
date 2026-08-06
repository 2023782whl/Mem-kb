# 技术架构

## 当前仓库审计

- `frontend/`：React 知识问答、文档知识和图片素材应用。
- `backend/gbrain/`：完整 GBrain `0.42.67.0` 源码，提供 MCP HTTP、OAuth、页面 CRUD、混合检索、问答、关系图谱和多 source 隔离。
- 旧版 `ai-workbench/` 原型已移除，不属于当前架构。

GBrain 是知识引擎，不是完整业务后端。账号、租户、Workspace、文件、图片向量、会话、统计和前端 REST/SSE 仍由 `backend/app` 提供。

## 总体结构

```text
Browser
  │ HTTPS + HttpOnly Cookie
  ▼
frontend (React)
  │ REST + SSE
  ▼
backend/app (业务 API)
  ├── Tenant/Auth/Session/RBAC/ACL
  ├── Workspace/Asset/Category/Product
  ├── Conversation/Citation/Analytics
  ├── Link Fetcher/Web Search
  ├── LLM Wiki/Content Parser
  ├── GPT/VLM/Multimodal Adapters
  ├── StorageProvider
  └── GBrain Adapter
         │ server-side OAuth/MCP
         ▼
backend/gbrain
  ├── pages/chunks/text embeddings
  ├── search/query
  ├── links/backlinks/graph
  └── source scope enforcement
```

## 技术选型

### Frontend

- React 19 + Vite + TypeScript。
- React Router：登录、问答、文档知识、图片素材和深链接。
- TanStack Query：服务端数据、重试和缓存失效。
- Zustand：折叠栏、当前视图等轻量 UI 状态。
- React Hook Form + Zod：表单。
- Lucide React：统一图标。
- Cytoscape.js：文档和图片关系图谱。

### Backend App

- Node.js 22 + TypeScript + Fastify。
- Zod：请求、响应和环境变量校验。
- PostgreSQL + Drizzle ORM。
- pgvector：文档文本向量和图片跨模态向量。
- Argon2id：密码哈希。
- 数据库 jobs 表 + worker：解析、VLM、向量化和 GBrain 索引任务。
- SSE：模型回答和资产处理状态。

独立 `backend/app` 而不直接改 GBrain 上游源码，保证 GBrain 可升级，并让业务权限、文件处理和模型编排保持稳定。

## 本地 PostgreSQL 方案

第一阶段使用同一个本地 PostgreSQL 实例、两个独立数据库：

```text
PostgreSQL localhost
├── aiteam_app
│   ├── tenant/user/workspace/asset
│   ├── conversation/citation/analytics
│   ├── document_chunks/query cache (pgvector)
│   └── image_embeddings (pgvector)
└── gbrain
    ├── pages/chunks/text embeddings
    └── links/graph/search
```

- 两个数据库都安装 `vector` 扩展，向量维度统一为 1024。
- 业务库保存 Workspace 隔离的文档分块，保证候选召回前即完成 Tenant/Workspace 过滤。
- GBrain 独立保存长期知识分块与向量，负责通用混合检索、关系和知识复用；业务代码不直接修改其内部表。
- 图片向量使用 HNSW + cosine 索引；第一版固定一个跨模态模型和向量维度。
- GBrain 与业务表通过 `workspace.gbrain_source_id` 和 `asset.gbrain_slug` 映射。
- 禁止业务代码直接修改 GBrain 内部表，只调用公开 operation/MCP。
- 本地备份必须同时包含两个数据库和 `backend/storage`。

## 存储职责

| 数据 | 存储位置 | 原因 |
| --- | --- | --- |
| 租户、用户、会话、角色 | `aiteam_app` | 产品身份和隔离 |
| Workspace、类目、商品、资产元数据 | `aiteam_app` | 业务主键和状态机 |
| 会话、引用、反馈、使用统计 | `aiteam_app` | 热门问题/文档和审计 |
| 图片跨模态向量 | `aiteam_app` + pgvector | 图搜图、文搜图 |
| 文档检索分块和查询缓存 | `aiteam_app` + pgvector | 租户前置过滤、RRF 和 Rerank |
| 文档、图片原文件 | 本地 StorageProvider | MVP 零云依赖，可切 MinIO/OSS |
| 长期知识文本、chunk、文档向量 | GBrain/PostgreSQL | GBrain 混合检索和关系复用 |
| VLM 摘要、SOP、策略和关系 | GBrain/PostgreSQL | 长期知识和图谱 |
| 缩略图、提取文本、临时文件 | 本地 StorageProvider | 不污染数据库 |

原始文件不存 PostgreSQL `bytea`。数据库只保存随机 `storage_key`、SHA-256、大小、MIME 和处理状态。

## 租户与 GBrain 隔离

```text
tenant
  -> workspace(scope=personal|team, kind=document|image|mixed)
      -> asset(document|image|webpage|ai_answer)
```

- 所有业务表直接或间接带 `tenant_id`。
- PostgreSQL 开启 RLS；每个请求在事务内设置当前 `tenant_id`。
- 个人 Workspace 的 ACL 强制 `owner_id = current_user_id`。
- 团队 Workspace 使用 Owner、Editor、Viewer 成员关系。
- 每个 Workspace 对应 `source_id = tenant/<tenantId>/workspace/<workspaceId>`。
- GBrain OAuth/allowedSources 再限制可检索 source，避免只依赖应用层过滤。

## 内容处理链路

### 文档/网页

```text
上传文件或粘贴 URL
  -> StorageProvider/Link Fetcher
  -> LLM Wiki/Parser 提取正文、结构、标题和元数据
  -> 生成带 frontmatter 的 Markdown
  -> GBrain put_page
  -> 分块、文档向量和关系图谱
  -> asset.status = ready
```

- PDF、DOCX、XLSX 由业务 worker 提取文本后写入 GBrain。
- URL 抓取必须限制协议、重定向、响应大小和内网地址，防止 SSRF。
- 网页内容保留 URL、站点、抓取时间和正文哈希，支持重新抓取和版本比较。

### 图片

```text
上传图片
  -> 原图/缩略图写入 StorageProvider
  -> OCR + VLM 生成描述、标签和视觉属性
  -> 跨模态模型生成图片向量 -> pgvector
  -> VLM Markdown 摘要 -> GBrain put_page
  -> 建立类目/商品/主题/场景关系
  -> image.status = ready
```

- GBrain 当前 `/ingest` 不直接接收图片二进制，因此原图必须留在 StorageProvider。
- 文搜图和图搜图统一使用同一跨模态向量空间。
- GBrain 负责图片的文本知识和关系，不替代图片向量检索。

## 问答与自沉淀

```text
用户问题
  -> 校验 Tenant/Workspace ACL
  -> 可选 Web Search/URL Fetch
  -> Tenant/Workspace 范围内全文 + pgvector 候选召回
  -> RRF 融合 + qwen3-rerank 精排
  -> GBrain 作为长期知识回退检索
  -> pgvector 图片检索
  -> 合并并去重上下文
  -> 用户选定模型流式生成
  -> 输出网页/文档/图片引用
  -> 保存消息、引用和统计
```

点击“沉淀到 Workspace”后：

```text
编辑标题/正文
  -> 创建 asset(type=ai_answer, format=markdown)
  -> 保存来源问题、模型和引用 frontmatter
  -> GBrain put_page
  -> 索引成功后返回文档链接
```

默认模型为 GPT-5.5。模型切换通过统一 `ModelProvider` 接口实现，前端只显示后端配置并通过健康检查的模型。

## 安全与权限

- 密码 Argon2id；Cookie 使用 `Secure + HttpOnly + SameSite=Lax`。
- GPT/VLM/Web Search/GBrain Token 和数据库口令只在后端环境变量。
- 服务层执行 ACL；前端隐藏按钮不视为权限控制。
- 权限点：`workspace.read/write/manage`、`asset.read/upload/delete/download`、`qa.ask`、`qa.capture`、`image.search`。
- 下载通过鉴权 API 或短时签名 URL，不暴露磁盘路径。
- 上传校验扩展名、MIME、文件头、大小和配额。
- URL 抓取禁止访问 localhost、内网 IP、云元数据地址和非 HTTP(S) 协议。
- 登录失败、下载、删除、问答、沉淀和权限拒绝写入 audit_log。
