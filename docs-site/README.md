# MEM-KB 宣传网站部署指南

## 🚀 快速部署到 GitHub Pages（3 分钟）

### 方法 1：通过 GitHub 网页界面部署

1. **推送代码到 GitHub**
   ```bash
   git add docs-site/
   git commit -m "docs: 添加项目宣传页"
   git push origin main
   ```

2. **启用 GitHub Pages**
   - 访问：https://github.com/2023782whl/Mem-kb/settings/pages
   - Source 选择：`Deploy from a branch`
   - Branch 选择：`main`
   - Folder 选择：`/docs-site`
   - 点击 **Save**

3. **等待部署完成**（约 1-2 分钟）
   - 刷新页面，会看到部署地址
   - 访问：`https://2023782whl.github.io/Mem-kb/`

### 方法 2：使用 GitHub Actions 自动部署（推荐）

已创建自动部署工作流，每次推送会自动更新网站。

---

## 📝 自定义配置

### 修改内容
编辑 `docs-site/index.html`：
- 第 10 行：修改标题
- 第 320 行：修改 Hero 标题
- 第 321 行：修改副标题
- 第 460-520 行：修改功能卡片

### 修改样式
在 `<style>` 标签内调整：
- 第 20-26 行：修改配色方案
- 第 120 行：修改 Hero 背景渐变

### 添加 Logo
替换第 49-54 行的 `.logo-icon` 为你的 Logo 图片。

---

## 🎨 预览效果

本地预览：
```bash
# 方法 1：使用 Python
cd docs-site
python3 -m http.server 8000
# 访问 http://localhost:8000

# 方法 2：使用 npx
npx serve docs-site
```

---

## 📊 包含的内容

✅ 响应式设计（支持手机、平板、电脑）  
✅ 现代渐变背景  
✅ 功能特性展示（6 个核心功能）  
✅ 技术栈介绍  
✅ 项目统计数据  
✅ CTA 行动呼吁  
✅ 完整的页脚链接  
✅ 流畅的动画效果  

---

## 🔗 访问地址

部署成功后，你的网站将在：
- **主域名：** https://2023782whl.github.io/Mem-kb/
- **自定义域名：** 可在 GitHub Pages 设置中配置

---

## 💡 提示

- 部署后约 1-2 分钟生效
- 后续修改会自动部署（如果使用 GitHub Actions）
- 可以绑定自定义域名（如 mem-kb.com）
- 完全免费，无限流量

---

## 🎯 下一步

部署完成后：
1. 在 GitHub 仓库的 About 中添加网站链接
2. 在 README.md 中添加"在线演示"链接
3. 分享到社交媒体
