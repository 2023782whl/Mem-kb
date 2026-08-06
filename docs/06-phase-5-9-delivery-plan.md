# 阶段 5-9 实施与验收计划

## 实施状态（2026-08-02）

阶段 5-9 已完成并通过回归验收：

- 阶段 5：真实 GPT-5.5、模型切换、SSE、中断/重试、引用、反馈、分支和回答沉淀。
- 阶段 6：真实联网搜索、公开链接解析、SSRF 防护、高频问题和高频引用统计。
- 阶段 7：多格式文档转 Markdown、摘要/实体/关系抽取、带来源证据的文档图谱。
- 阶段 8：三级类目与商品、真实 VLM、OCR/标签/摘要、pgvector 文搜图和图搜图。
- 阶段 9：后台型产品壳、桌面三栏、移动端导航、完整构建/回归/依赖与视觉验收。

当前交付采用本地 PostgreSQL、pgvector 和本地文件存储；StorageProvider 已保留 MinIO/OSS 迁移边界。GBrain 写入、链接和遍历为真实调用，不保留前端假成功入口。

## 目标架构

```text
Tenant
  -> Business Unit / Personal Space
    -> Workspace
      -> Category(1-3) / Product
        -> Asset(document | image | webpage | ai_answer)
```

- PostgreSQL 保存租户、权限、资产、会话、统计、任务和来源证据。
- pgvector 保存图片与文本的统一多模态向量。
- 本地 StorageProvider 保存原始文档、图片和生成的 Markdown。
- GBrain 保存规范 Markdown、SOP、长期知识和可遍历关系。
- 所有检索先应用 Tenant、Business Unit 和 Workspace ACL，再参与排序。

## 阶段 5：GPT-5.5 问答与知识自更新

- 前端从后端模型目录读取可用模型，移除 GPT-5.5 硬编码。
- 增加 SSE：`meta`、`citation`、`delta`、`done`、`error`。
- 文档检索组合 GBrain、业务资产和来源去重。
- 保存会话、消息、引用、反馈和查询事件。
- 回答可编辑后沉淀为独立 Markdown Asset，并写入 GBrain。

验收：回答真实流式输出；引用可追溯；沉淀内容可被下一轮问答命中。

## 阶段 6：联网搜索、链接解读与使用统计

- WebSearchProvider 隔离具体搜索实现，并保留供应商扩展入口。
- LinkFetcher 只允许公开 HTTP(S)，限制 DNS/IP、重定向、体积和超时。
- 网页正文转换为规范 Markdown，可直接成为 webpage Asset。
- 聚合真实高频问题、高频引用文档和网页来源。

验收：公开链接可解读和沉淀；私网链接被拒绝；统计来自真实查询和引用。

## 阶段 7：文档知识图谱

- 文档先转换为统一 Markdown，再生成摘要、主题、实体、SOP 和关系。
- 图谱关系必须保存来源 Asset 和证据，不创建无证据连线。
- GBrain 页面通过 wiki links 建立双向关系；应用 API 提供授权后的图谱视图。
- 节点支持搜索、点击详情、100 字摘要和打开原文。

验收：节点和边可回溯到真实文档；跨 Workspace 和跨租户不可见。

## 阶段 8：图片素材、VLM、图搜图和文搜图

- 图片 Workspace 支持三级类目、商品和图片资产。
- VLM 输出 OCR、约 100 字摘要、场景、商品、卖点、风格和标签。
- 多模态 Embedding 将文本和图片映射到同一 1024 维空间并写入 pgvector。
- 文搜图、图搜图先执行 ACL，再按余弦相似度排序。
- 图片摘要和类目/商品关系同步到 GBrain。

验收：文本和参考图都能检索真实图片；节点可进入商品和图片详情。

## 阶段 9：响应式、测试与交付

- 路由固定为登录、知识问答、知识中心；图片素材是知识中心子路由。
- 桌面三栏、平板双栏、移动端抽屉/详情页。
- 统一薄荷绿色 AI 工作台视觉，保留清晰的引用证据轨迹。
- 完成类型检查、单元、集成、回归、ACL、E2E 和视觉截图验收。
- 删除失效开关、重复代码、假数据入口和无调用 API。

## 代码边界

```text
frontend/src/
  app/                 路由、产品壳、会话
  features/            auth、qa、knowledge、images
  shared/              UI、hooks、API、类型

backend/app/src/
  auth/                会话和资源权限
  modules/             qa、web、analytics、graph、images、workspaces
  providers/           model、search、embedding、storage、gbrain
  services/            解析、入库、任务编排
```

## 质量门禁

1. 每个表和查询都携带租户边界，越权 API 必须返回 403/404。
2. Provider 不泄露密钥，外部失败返回可恢复的标准错误。
3. 上传、VLM、向量化和 GBrain 写入有明确状态，不显示假成功。
4. 前端页面组件按业务拆分，`App` 只负责路由组合。
5. 构建、类型检查、回归测试和桌面/移动视觉验收全部通过后才能交付。

## 实际验收

```bash
cd backend/app
npm run db:setup
npm run typecheck
npm run build
npm run test:regression
npm audit --omit=dev

cd ../../frontend
npm run typecheck
npm run build
npm audit --omit=dev
```

已覆盖的关键回归路径：登录与 ACL、业务分区、文档上传与解析、GBrain 真实写入、GPT-5.5 SSE、回答沉淀、统计、图谱、链接 SSRF 拦截、图片 VLM/向量化/检索。

## 交付边界

- 应用查询会降权到 `aiteam_runtime` 角色；28 张业务表已启用并强制 RLS，数据库策略与业务 ACL 共同隔离租户和 Workspace。
- 联网搜索当前通过独立 Provider 接入，可按部署环境替换为 Firecrawl、Tavily 或企业搜索服务。
- 图片跨模态向量依赖已配置的 DashScope 多模态 Embedding；失败时任务会保留明确错误状态。
- GBrain、模型和外部 Provider 的密钥只从本地环境变量读取，不进入前端或版本库。
