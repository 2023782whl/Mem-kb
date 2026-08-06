# GBrain 高级能力阶段 6～10 实施计划

## 目标

在阶段 1～5 的笔记、知识生命周期和 Facts 基础上，把 GBrain 的关系发现、知识洞察、联邦源、后台任务、Schema、Ontology、Skillpack 与 Advisor 接入 Mem-kb，形成可观察、可治理、可追溯的企业知识系统。

## 阶段 6：关系探索

- 从当前 Workspace 的真实资产和笔记中选择起点。
- 使用 `traverse_graph` 做 1～10 跳入向、出向或双向遍历。
- 同时展示反向链接、时间线、标签和关系来源。
- 使用 `find_trajectory` 查看实体指标与事件轨迹。
- 所有 slug 必须属于当前 Tenant 与 Workspace。

验收：不生成模拟节点；空图谱明确显示暂无关系；非法或跨 Workspace slug 被拒绝。

## 阶段 7：智能洞察

- 使用 `find_experts` 按主题发现专家。
- 使用 `find_anomalies` 查看知识增长异常。
- 使用 `find_contradictions` 展示已执行探针发现的冲突。
- 使用 `ontology_get`、`ontology_dimensions`、`ontology_conflicts` 查看实体画像和知识冲突。
- 管理员可通过 `ontology_propose` 提交带置信度、来源和有效期的观察。

验收：所有结果来自真实 GBrain；未运行探针时显示原因，不伪造冲突或专家。

## 阶段 8：联邦源与运行中心

- 使用 `sources_list` 与 `sources_status` 查看知识源、页数、同步时间和克隆状态。
- 使用 `get_status_snapshot`、`get_stats`、`get_health` 展示同步、向量覆盖率和知识质量。
- 使用 `list_jobs`、`get_job_progress` 展示任务状态和进度。
- 管理员可重试失败任务或取消未完成任务，所有操作写入 Mem-kb 审计日志。
- 运行中心与 Tenant 管理员权限绑定。

验收：普通成员无法访问全局运维数据；任务操作幂等、可审计，失败原因可见。

## 阶段 9：知识治理

- 使用 `advisor` 展示版本漂移、孤立页面和配置建议。
- 使用 `get_active_schema_pack`、`list_schema_packs`、`schema_stats` 展示 Schema 身份与覆盖率。
- 使用 `list_skills`、`get_skill`、`list_brain_skillpack` 浏览 GBrain 技能目录。
- 使用 `list_link_sources` 展示关系证据来源。
- GBrain 运行配置显式发布 Advisor 和只读 Skill 目录。

验收：治理页面只读；修复命令仅展示，不在页面自动执行；不可用能力给出清晰配置提示。

## 阶段 10：收口与交付

- 后端按 Adapter、Service、Routes 分层，GBrain 原始响应在 Service 层归一化。
- 前端按 Facts、关系探索、智能洞察、运行中心、知识治理拆分组件。
- 清理旧发现页重复逻辑和废弃样式。
- 完成权限、Workspace 边界、响应归一化单元测试。
- 完成前后端构建、真实只读接口回归、桌面端和移动端视觉验收。

验收：现有问答、知识中心、笔记无回退；测试数据不污染真实 Workspace；生产构建通过。

## 模块边界

```text
backend/app/src/services/gbrain.ts              GBrain 类型化 Adapter
backend/app/src/modules/gbrain/service.ts       权限范围与响应归一化
backend/app/src/modules/gbrain/routes.ts        HTTP API、管理员操作与审计
frontend/src/features/discovery                 发现中心页面和业务视图
frontend/src/api/client.ts                      前端 API Adapter
frontend/src/types/domain.ts                    稳定领域契约
```

## 安全边界

- Workspace 能力先执行 Mem-kb 权限校验，再调用 GBrain。
- 关系探索和实体画像只接受当前 Workspace 的真实 GBrain slug。
- 联邦源、任务、全局 Schema、Advisor 和 Skill 目录仅管理员可见。
- 前端永远不接触 GBrain MCP Token、数据库凭据或模型密钥。
- 所有重试、取消和 Ontology 写入都写入 `audit_logs`。

## 实施结果

阶段 6～10 的后端适配接口和本实施方案保留，但发现中心及高级 GBrain 前端能力按产品决策延期。当前 `/discover` 跳转到问答页，不把关系洞察、联邦源、后台任务、Schema、Advisor 或 Skills 视为已交付的用户功能。

## 验收记录

本阶段尚未进入前端验收。后续重新启动时，应按本文件逐项验证权限、真实来源、不可用状态和窄屏布局，不能使用历史演示数据作为完成依据。
