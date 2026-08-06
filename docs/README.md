# Mem-kb 知识中心设计与实施文档

## 目标

Mem-kb 第一阶段交付个人登录和三个知识业务页面：

1. 个人账号登录
2. 知识问答
3. 文档知识
4. 图片素材

项目顶层只保留两个运行应用目录：

```text
mem-kb/
├── frontend/             # React Web
├── backend/              # 业务 API + GBrain
│   ├── app/              # 新增的业务后端/BFF
│   ├── gbrain/           # 已存在的 GBrain 源码
│   └── storage/          # 开发环境本地文件存储
└── docs/                 # 本设计文档
```

旧版 `ai-workbench/` 与历史 `backups/` 已按确认移除，不参与运行。

## 核心决策

- 前端：React + Vite + TypeScript + Wouter + TanStack Query。
- 后端：TypeScript 业务 API，负责账号、权限、知识库、文件、会话和模型编排。
- 内容处理：LLM Wiki/解析层把网页和文档转成结构化 Markdown，再写入 GBrain。
- 知识引擎：复用 `backend/gbrain`，沉淀企业运营资产、SOP 和个人策略打法；通过服务端适配层调用。
- 大模型：服务端提供模型目录和切换能力，默认使用现有 OpenAI-compatible `gpt-5.5`。
- 数据库：本地 PostgreSQL；业务库 pgvector 负责 Tenant/Workspace 隔离的文档与图片召回，GBrain 独立维护长期知识向量和关系。
- 文件：开发环境存 `backend/storage`，生产可通过统一 StorageProvider 选择本地卷或阿里云 OSS。
- 租户：`Tenant -> Workspace -> Asset`；Workspace 同时承担业务分区和知识库容器，分个人与团队两种。
- 权限：个人 Workspace 默认仅本人可见；团队 Workspace 使用租户隔离、RBAC、资源 ACL 和 GBrain source scope。
- 产品视觉：以用户提供的三张设计稿为正式方向，浅灰白底、薄边框和统一薄荷绿色交互体系。

## 当前状态

核心 MVP 已完成：登录、知识问答、文档与图片知识中心、笔记、Workspace/成员管理、文件回收站、异步解析队列、知识图谱、图片缩略图、PostgreSQL RLS、生产部署与自动化测试均已接入。文档检索支持 Workspace/文件范围、混合召回与精排。

按当前产品决策，`/discover` 仍跳转到问答页；发现中心及关系洞察、联邦源、任务治理、Advisor、Skills 等高级 GBrain 前端能力明确延期，后端适配接口保留但不视为已交付。

## 文档导航

- [产品范围](./01-product-scope.md)
- [页面与交互设计](./02-page-design.md)
- [技术架构](./03-architecture.md)
- [API 与数据契约](./04-api-and-data-contract.md)
- [实施计划与验收](./05-implementation-plan.md)
- [阶段 5-9 实施与验收计划](./06-phase-5-9-delivery-plan.md)
- [混合召回与向量迁移交付](./07-hybrid-retrieval-delivery.md)
- [笔记与 GBrain 阶段 1～5 实施计划](./08-notes-gbrain-phase-1-5-plan.md)
- [GBrain 高级能力阶段 6～10 实施计划](./09-gbrain-advanced-phase-6-10-plan.md)
- [生产部署与运维](./10-deployment-and-operations.md)

## 产品预览

- [知识问答工作台](./assets/screenshots/overview.png)
