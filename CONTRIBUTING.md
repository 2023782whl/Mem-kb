# Contributing to MEM-KB

感谢你帮助 MEM-KB 变得更好。小修复可以直接提交 Pull Request；涉及数据模型、权限、公开 API 或主要交互的改动，请先创建 Discussion 或 Feature Request 对齐方案。

## 本地开发

```bash
npm run infra:up
cp backend/app/config/.env.example backend/app/config/.env.local
cp frontend/.env.example frontend/.env.local
npm run install:all
npm run db:setup
npm run dev
```

## 提交前检查

```bash
npm run check
npm run test:e2e
npm run audit
```

提交时请遵循以下约定：

- 保持改动范围聚焦，避免混入无关格式化。
- 新行为需要单元测试；页面布局或关键流程需要 Playwright 覆盖。
- 数据库变更通过迁移完成，并考虑 RLS、租户隔离和回滚。
- 不提交 `.env.local`、令牌、生产日志、用户数据或本地存储文件。
- 注释只解释代码本身无法表达的约束与原因。

## Pull Request

PR 描述应包含问题、方案、验证方式和界面截图（如适用）。维护者可能要求拆分过大的变更或补充迁移与安全测试。
