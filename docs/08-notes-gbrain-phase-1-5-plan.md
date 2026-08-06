# 笔记与 GBrain 阶段 1～5 实施计划

## 目标

在现有知识问答、文档知识和图片素材基础上，完成双侧栏产品壳、笔记工作区、AI 写作助手、GBrain 知识生命周期和 Facts 长期记忆，形成“检索、创作、沉淀、治理”的闭环。

## 数据职责

- PostgreSQL：租户、用户、权限、Workspace、笔记元数据、草稿、事实审核状态和审计。
- GBrain：笔记 Markdown、标签、版本、时间线、反向链接、语义关系和 Facts。
- 本地存储 / MinIO / OSS：文档、图片和笔记附件。
- GPT-5.5：笔记写作、内容分析和结构化事实抽取。

## 阶段 1：双侧栏产品壳

- 一级侧栏固定为知识问答、知识中心、笔记和发现。
- 二级上下文栏由业务页面负责：会话、Workspace、笔记目录或发现筛选。
- 保留现有路由和业务行为，补充 `/notes` 与 `/discover`。
- 桌面端支持紧凑侧栏，移动端使用底部主导航和抽屉式上下文栏。

验收：所有一级路由可直接访问和刷新，现有问答、文档、图片页面无行为回退。

## 阶段 2：笔记基础能力

- 支持目录、笔记创建、搜索、收藏、自动保存、软删除、回收站和恢复。
- 笔记归属 Tenant、Workspace 与创建者，复用现有 Workspace RBAC。
- 编辑器保存 HTML 与规范 Markdown，支持预览和 Markdown 原文。
- 保存采用版本号乐观锁，避免旧草稿覆盖新内容。

验收：笔记生命周期完整，刷新后状态保持，跨 Workspace 访问被拒绝。

## 阶段 3：笔记 AI 助手

- 支持总结、提纲、续写、改写、扩写、缩写和自由指令。
- 可选择知识库检索与联网搜索，输出引用来源。
- GPT-5.5 使用 SSE 流式输出，支持停止、重试、插入、替换和追加。
- AI 结果必须由用户确认后写入正文。

验收：流式内容可稳定停止和重试，引用可追溯，AI 不直接覆盖正文。

## 阶段 4：GBrain 知识生命周期

- 笔记创建和保存调用 `put_page`，删除和恢复调用 `delete_page`、`restore_page`。
- 标签通过 `add_tag`、`remove_tag`、`get_tags` 双向同步。
- 历史通过 `get_versions` 与 `revert_version` 展示并回滚。
- 时间线通过 `add_timeline_entry` 与 `get_timeline` 记录创建、编辑和 AI 应用。
- 反向链接通过 `get_backlinks` 展示引用当前笔记的知识资产。

验收：标签、历史、时间线和反向链接来自真实 GBrain 数据，GBrain 不可用时返回明确错误。

## 阶段 5：Facts 长期记忆

- 笔记保存后可请求 GBrain `extract_facts` 抽取事实。
- PostgreSQL 维护 Fact 与笔记的映射及 `pending / verified / forgotten` 审核状态。
- 只有已确认 Facts 才进入 AI 写作和问答上下文。
- 支持确认、纠错和遗忘，遗忘调用 GBrain `forget_fact`。
- 每条 Fact 展示来源笔记、证据、置信度和创建时间。

验收：Facts 可追溯、可审核、可遗忘，不跨 Tenant 或 Workspace 返回。

## 模块边界

```text
frontend/src/features/notes      笔记编辑与生命周期 UI
frontend/src/features/notes      Facts 与知识发现 UI
backend/app/src/modules/notes    笔记 HTTP API
backend/app/src/modules/notes    Facts 审核 API
backend/app/src/services/gbrain.ts  GBrain 类型化适配
```

## 测试与交付

- 后端：归一化、权限、乐观锁和 Facts 状态单元测试。
- 接口：笔记 CRUD、恢复、AI SSE、版本回滚和 Fact 审核回归。
- 前端：TypeScript、生产构建和桌面/移动端 Playwright 截图。
- 数据：确认现有资产、会话和图谱数量无异常变化。

## 实施结果

- 阶段 1 已完成：一级窄侧栏、业务上下文栏、`/notes`、`/discover` 和移动端底部导航已落地。
- 阶段 2 已完成：目录、搜索、收藏、自动保存、乐观锁、软删除、回收站和恢复已接入 PostgreSQL。
- 阶段 3 已完成：GPT-5.5 笔记助手支持知识检索、联网、SSE、停止、重试、插入、追加和替换。
- 阶段 4 已完成：GBrain 页面、标签、版本回滚、时间线、反向链接和删除恢复使用真实接口。
- 阶段 5 已完成：Facts 使用 GPT-5.5 抽取，支持待确认、确认、纠正和遗忘；只有已确认事实进入问答与写作上下文。

### GBrain 模型映射

- Chat/Facts：`openai:gpt-5.5`，通过内部 OpenAI 兼容地址调用。
- Embedding：DashScope `text-embedding-v3`，1024 维。
- GBrain 启动脚本负责把应用环境映射到模型网关，不在代码或文档中保存密钥。

### 已完成验证

- 笔记创建、更新、版本、标签、时间线、删除和恢复接口回归。
- Facts 真实抽取、确认、纠正、遗忘以及 Workspace 状态过滤回归。
- 笔记 AI 助手真实 GPT-5.5 流式输出回归。
- 桌面端与移动端布局、滚动容器和横向溢出检查。
- 前后端 TypeScript、单元测试与生产构建检查。
