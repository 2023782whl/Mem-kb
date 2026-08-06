# 生产部署与运维

## 部署组成

`docker-compose.yml` 启动 Web、API、独立 Worker、GBrain、PostgreSQL/pgvector 和 Redis。Web 通过同源 `/api` 反向代理 API；浏览器只保存 HttpOnly Session Cookie，不接触模型或 GBrain 密钥。公网 HTTPS 应由云负载均衡、Caddy、Traefik 或企业网关终止，并转发到 Web 的 `8080` 端口。

## 首次部署

1. 复制 `.env.production.example` 为 `.env.production`，生成独立的数据库密码、至少 32 位 `AUTH_SECRET` 和符合 `[A-Za-z0-9_-]` 的至少 32 位 `GBRAIN_TOKEN`。
2. 将 `APP_ORIGIN` 设置为真实 HTTPS 域名，并配置模型网关密钥。
3. 启动服务：

```bash
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
```

API 容器启动前自动执行幂等数据库迁移；生产环境不会写入演示用户。首次创建管理员：

```bash
docker compose --env-file .env.production exec \
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD='replace-with-a-strong-password' \
  -e ADMIN_NAME='系统管理员' \
  api node dist/src/db/create-admin.js
```

## 健康与监控

- 用户侧健康：`GET /api/health`，包含数据库、Redis、队列和 GBrain 状态。
- Prometheus 指标：`GET /metrics`，包含 HTTP 请求耗时/状态和队列 waiting/active/failed 数量。
- 生产日志输出到标准输出，同时按天或 100 MB 轮转到 `app-logs` 卷，保留 14 个文件。
- 建议至少对 API 不健康、GBrain 不健康、队列 failed 增长、P95 延迟和磁盘/数据库容量设置告警。

## 备份与恢复

数据库和本地存储必须成对备份。使用 OSS 时，数据库仍用脚本备份，文件依赖 OSS 版本控制与生命周期策略。

```bash
DATABASE_URL='postgresql://...' \
STORAGE_ROOT='/srv/aiteam/storage' \
AITEAM_BACKUP_DIR='/srv/aiteam/backups' \
./scripts/backup.sh
```

默认保留 14 天，可用 `AITEAM_BACKUP_RETENTION_DAYS` 调整。恢复会清理并覆盖目标数据库，必须显式传入 `--confirm` 和绝对备份目录，并在停掉 API/Worker 后执行：

```bash
DATABASE_URL='postgresql://...' STORAGE_ROOT='/srv/aiteam/storage' \
./scripts/restore.sh --confirm /srv/aiteam/backups/20260803T120000Z
```

恢复后重新启动服务，并检查 `/api/health`、随机文件下载、问答引用和队列失败数。至少每季度在隔离环境演练一次恢复。

## 升级与回滚

升级前先备份，再执行 `docker compose --env-file .env.production up -d --build`。迁移均为幂等前向迁移；需要代码回滚时切回旧镜像，但若包含不可逆数据库变更，应从升级前备份恢复到隔离实例验证后再切流量。
