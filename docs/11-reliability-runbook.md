# 稳定性、容量与故障处置

## 运行边界

API 只处理交互请求；资产解析、微信长轮询和夜间巩固由独立 Worker 执行。资产与维护任务使用不同 BullMQ 队列，避免大文档解析阻塞定时整理。微信绑定使用 PostgreSQL 租约，同一绑定同时只由一个 Worker 轮询，Worker 失联后会自动转移。

问答入口和外部模型调用均有并发舱壁、有限等待队列、总超时、指数退避与熔断器。过载时返回 `429` 或 `503` 及 `Retry-After`，不会无限堆积请求。多 Workspace 检索先批量鉴权，再并行召回，并限制范围与单库结果占比。

## 建议 SLO

| 指标 | 目标 | 告警条件 |
| --- | --- | --- |
| API 可用性 | 月度 ≥ 99.9% | 5 分钟错误率 > 1% |
| 普通 API P95 | < 500 ms | 连续 10 分钟 > 800 ms |
| QA 首字节 P95 | < 5 s | 连续 10 分钟 > 8 s |
| 检索 P95 | < 2 s | 连续 10 分钟 > 3 s |
| DB 连接等待 P95 | < 50 ms | 连续 5 分钟 > 200 ms |
| 队列等待 | 资产 < 5 分钟 | waiting 持续增长 10 分钟 |

## 容量调整

先根据 `/metrics` 观察 `aiteam_http_request_duration_seconds`、`aiteam_db_pool_acquire_seconds`、`aiteam_db_pool_connections`、`aiteam_queue_jobs` 和 `aiteam_workload_concurrency`。单实例稳定 QPS 应通过预发布压测确定，不用线程数直接推算。

调整顺序：先扩 API 副本，再确认数据库连接总数；模型吞吐不足时优先降低 `PROVIDER_CONCURRENCY` 或接入网关配额，不盲目扩请求。所有 API 实例的 `DATABASE_POOL_MAX` 总和应低于 PostgreSQL `max_connections` 的 70%，为 Worker、迁移和运维预留连接。

本地烟测：

```bash
LOAD_BASE_URL=http://127.0.0.1:8788 \
LOAD_CONCURRENCY=20 LOAD_DURATION_MS=10000 \
npm run test:load
```

线上容量测试应在隔离预发布环境执行，并分别覆盖 `/api/live`、多 Workspace 检索、流式 QA、上传与队列消费；模型端使用独立测试配额。

## 故障处置

- `429` 增长：检查 QA/Provider waiting；确认是否真实流量突增，再扩容或调配额。
- `503` 增长：检查熔断范围、模型网关、GBrain 与 Redis；恢复依赖后熔断器会自动半开探测。
- DB 等待升高：查慢 SQL和锁等待，不先扩大连接池；确认向量 HNSW 索引和租户过滤命中。
- 资产队列堆积：检查 Worker 存活、failed 数与文档解析依赖；任务以数据库 processing id 幂等重派。
- 微信停止召回：检查绑定状态、`lease_owner/lease_expires_at`、Worker 日志与凭证过期状态；不要在 API 容器启动额外轮询器。
- 夜间巩固卡住：检查 maintenance 队列和 run 租约；Worker 崩溃后 BullMQ 会将 stalled job 重投。

发布前执行 `npm run check`，再完成一次负载烟测。每季度演练 PostgreSQL/文件恢复、Redis 丢失后的任务重派、模型网关超时和 Worker 强制终止。
