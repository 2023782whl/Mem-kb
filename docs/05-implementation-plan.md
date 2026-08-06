# 实施计划与验收

## 实施原则

先完成“文档入库 -> GBrain 检索 -> GPT 回答 -> 一键沉淀”的真实闭环，再增加联网、使用统计和图片跨模态检索。每个阶段都必须可独立验收。

## Phase 0：项目与本地基础设施（0.5 天）

- 在 `frontend/` 初始化 React + Vite + TypeScript。
- 在 `backend/app/` 初始化 Fastify + TypeScript。
- 保留 `backend/gbrain/` 为独立上游目录。
- 创建本地 PostgreSQL 的 `aiteam_app`、`gbrain` 两个数据库。
- 在业务库启用 pgvector；创建 `.env.example` 和统一启动脚本。
- 从 `ai-workbench/` 只迁移 GPT-5.5、GBrain、Storage 适配思路，不整目录复制。

验收：前端、业务 API、GBrain 和 PostgreSQL 均可通过一条开发命令启动并通过健康检查。

## Phase 1：租户、登录、权限和设计系统（1.5 天）

- 建立颜色、排版、图标、按钮、输入、弹窗、空/错/加载状态。
- 完成登录页和知识问答、文档知识、图片素材三项导航。
- 完成 Tenant、User、Session、Workspace、Member 数据模型。
- 创建个人 Workspace 和团队 Workspace，实现 Owner、Editor、Viewer。
- 启用 PostgreSQL RLS、Cookie 会话、登录限流和路由守卫。

验收：不同租户互不可见；个人 Workspace 仅本人可见；直接调用越权 API 返回 403。

## Phase 2：文档 Workspace 与本地文件（1.5 天）

- 完成 Workspace 创建、重命名和归档。
- 完成文档知识三栏页面、列表、筛选、搜索、排序和预览。
- 实现 LocalStorageProvider、SHA-256 去重、Range 下载和软删除。
- 支持 Markdown、TXT、PDF、DOCX、XLSX 上传和逐文件进度。

验收：可以创建“电商运营知识库”，上传、预览、下载和删除真实文件；磁盘路径不暴露给浏览器。

## Phase 3：LLM Wiki 解析与 GBrain 入库（1.5 天）

- 建立 Parser 接口，提取文档标题、正文、结构和元数据。
- 生成带租户、Workspace、Asset 和来源信息的 Markdown frontmatter。
- 实现 jobs worker、失败重试和状态进度。
- 实现 GBrain `put/get/list/search/delete` 适配器。
- 一个 Workspace 对应一个 GBrain source；Asset 使用稳定 slug。

验收：文档状态从 queued 走到 ready；GBrain 能检索正文；重复上传不会重复建页；跨 Workspace search 被阻断。

## Phase 4：模型问答与知识自更新（2 天）

- 完成 ima 风格知识问答首页和会话页。
- 接入后端模型目录和模型切换，默认 GPT-5.5。
- GBrain search 按授权 Workspace 检索，GPT-5.5 通过 SSE 流式回答。
- 保存会话、消息、引用、点赞/点踩。
- 实现“沉淀到 Workspace”：编辑标题/正文、写 Markdown、调用 GBrain、返回文档入口。
- 引用跳到文档知识并定位原文。

验收：回答来自真实模型；引用能回到真实文档；保存回答后能被下一次检索命中；失败时不显示假成功。

## Phase 5：联网搜索、链接解读与使用洞察（1.5 天）

- 接入 Web Search Provider，区分网页引用和知识库引用。
- 实现安全 Link Fetcher、正文提取、详细解读和网页 Asset 入库。
- 防止 SSRF、超大响应、重定向循环和非 HTTP(S) 协议。
- 记录 query_events 和 message_citations。
- 完成高频问题、高频引用文档，所有聚合结果遵守权限。

验收：粘贴公开 URL 能生成带网页引用的解读；内网 URL 被拒绝；热门数据来自真实事件。

## Phase 6：文档图谱（1 天）

- 接入 GBrain links/backlinks/traverse_graph。
- 完成 Workspace 图谱、节点搜索、类型筛选和 1-3 层深度。
- 文档节点显示名称、100 字摘要、标签、更新时间和打开入口。

验收：节点和边全部来自 GBrain；节点可以打开真实文档；跨租户节点不出现。

## Phase 7：图片素材与 pgvector（2 天）

- 完成图片 Workspace、三级类目、商品和图片网格。
- 完成图片上传、缩略图、OCR、VLM 100 字摘要和标签。
- 接入固定跨模态模型，生成图片/文本向量并写入 pgvector。
- 实现图搜图、文搜图；SQL 先限定 Tenant/Workspace，再执行向量排序。
- 将 VLM Markdown 摘要和关系写入 GBrain。
- 完成类目、商品、图片、场景和风格图谱。

验收：同一商品相似图片能优先命中；文本描述能检索相关图片；点击节点能进入商品/图片详情。

## Phase 8：响应式、测试与交付（1 天）

- 完成桌面三栏、平板双栏、移动端三级页面。
- 键盘操作、焦点态、reduced-motion 和无障碍标签。
- 单元测试：RLS、ACL、状态机、slug、引用映射、重复上传。
- 集成测试：登录、上传、GBrain、问答、沉淀、URL、图片检索。
- 浏览器 E2E：Owner、Editor、Viewer 和跨租户隔离。
- 用三张参考设计稿做桌面/移动截图比对。
- 编写启动、迁移、备份恢复和生产部署说明。

验收：构建、类型检查和测试通过；真实 GPT-5.5、GBrain、Web、VLM/pgvector 链路通过；主流程无重叠和横向溢出。

## 工期与优先级

- 文档知识 MVP：约 6 个工作日，包含租户、登录、文档入库、GPT-5.5 问答和回答沉淀。
- 完整一期：约 12 个工作日，增加联网、URL、统计、文档图谱和图片跨模态检索。

### P0：先上线

- Tenant、个人/团队 Workspace、RLS + ACL。
- 文档上传、解析、预览、删除。
- GBrain 真实写入、检索和引用。
- 模型切换、GPT-5.5 流式问答。
- 回答一键沉淀为 Markdown。
- 基础会话、复制和反馈。

### P1：一期补全

- 联网搜索和链接详细解读。
- 高频问题、高频引用文档。
- 文档关系图谱。
- 三级类目、商品、VLM 摘要。
- pgvector 图搜图、文搜图和图片图谱。

## 核心验收场景

1. Tenant A 的 Owner 登录并创建个人“运营打法”和团队“电商运营知识库”。
2. 上传 SOP PDF，页面展示解析和索引过程，最终可被 GBrain 检索。
3. 开启文档知识问答并切换 GPT-5.5，答案包含可跳转引用。
4. 将答案编辑后沉淀到个人“运营打法”，再次提问可以命中新文档。
5. 粘贴网页链接，得到带网页引用和知识库引用的联合解读。
6. 高频问题和文档引用次数随真实使用更新。
7. 在文档图谱点击 SOP 节点，看到 100 字摘要并打开原文。
8. 在素材 Workspace 的三级类目下创建商品并上传图片。
9. VLM 生成描述；文搜图和图搜图返回正确素材。
10. Tenant B、Viewer 或无权限用户无法通过前端和直接 API 访问 Tenant A 数据。

## 风险控制

| 风险 | 控制方式 |
| --- | --- |
| 直接修改 GBrain 导致无法升级 | 通过 Adapter 调用公开 operation/MCP |
| 全局检索后过滤导致漏召回/越权 | 业务 pgvector 先限定 Tenant/Workspace，再执行向量排序；GBrain 作为长期知识层 |
| 图片文件塞进 PostgreSQL | 原图存 StorageProvider，PG 只存元数据和向量 |
| URL 抓取形成 SSRF | DNS/IP 校验、协议白名单、大小/超时/重定向限制 |
| 前端隐藏按钮形成假权限 | PostgreSQL RLS + 服务层 ACL + GBrain source scope |
| 图片检索结果跨租户 | SQL 查询先限定 tenant/workspace，再做向量排序 |
| 回答沉淀显示假成功 | 业务 Asset 与 GBrain 索引均成功后再返回 ready |
| 模型/搜索密钥泄露 | 所有 Provider 只在后端运行 |

## 已冻结默认项

- 品牌使用 `Mem-kb 知识中心`。
- 产品层统一称 `Workspace（知识库）`。
- 本地 PostgreSQL 使用 `aiteam_app`、`gbrain` 两个数据库。
- 文档向量由业务库隔离检索层和 GBrain 长期知识层分别管理；图片向量由业务库 pgvector 管理。
- 原文件使用本地 StorageProvider，后续可切 MinIO/OSS。
- 首版后端角色为 Owner、Editor、Viewer，前端不增加权限管理页面。
