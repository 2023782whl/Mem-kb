# Security Policy

## Supported versions

安全修复优先应用于 `main` 分支的最新版本。早期版本不保证继续获得补丁。

## Reporting a vulnerability

请使用 GitHub 仓库的 **Security → Report a vulnerability** 私密报告入口。不要创建公开 Issue，也不要附带真实用户数据、生产令牌或可直接利用的公开演示地址。

报告中请包含：

- 受影响的组件与版本或 commit
- 可复现步骤及最小化示例
- 影响范围与可能的缓解方式

维护者会在确认报告后协调披露和修复。公开披露前请给项目合理的响应时间。

## Deployment checklist

- 更换默认开发账号并使用唯一强密码。
- 配置至少 32 位的 `AUTH_SECRET`，所有外部入口启用 HTTPS。
- 将数据库、Redis、GBrain 与对象存储限制在可信网络。
- 使用最小权限的模型和存储凭证，定期轮换密钥。
- 对上传文件、备份、审计日志和 Trace 中的敏感信息设置保留策略。
