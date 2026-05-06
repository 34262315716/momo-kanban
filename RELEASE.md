# 发布到 GitHub 清单

## ✅ 已完成

- [x] 添加 LICENSE (MIT)
- [x] 更新 .gitignore
- [x] 清理备份文件
- [x] 完善 README.md
  - [x] 安装说明
  - [x] 贡献指南
  - [x] 问题反馈
  - [x] 作者信息
- [x] Git 提交历史整理

## 📋 下一步操作

### 1. 在 GitHub 创建仓库

1. 访问 https://github.com/new
2. 仓库名：`momo-kanban`
3. 描述：`陌陌的任务看板 - OpenClaw 任务管理插件`
4. 公开仓库
5. 不要初始化 README（我们已经有了）

### 2. 推送代码

```bash
cd ~/.openclaw/extensions/momo-kanban

# 添加远程仓库
git remote add origin https://github.com/dichuxuanhuan/momo-kanban.git

# 推送代码
git branch -M main
git push -u origin main
```

### 3. 创建第一个 Release

1. 访问 https://github.com/dichuxuanhuan/momo-kanban/releases/new
2. Tag: `v2.1.0`
3. 标题：`V2.1.0 - 子代理部分可见`
4. 描述：

```markdown
## 🎉 新特性

- ✨ 子代理部分可见功能
- ✨ 任务分配（assigned_to）
- ✨ 子代理自动 scope 隔离
- ✨ 权限过滤（子代理只看自己的 + 分配的）

## 📦 安装

```bash
cd ~/.openclaw/extensions
git clone https://github.com/dichuxuanhuan/momo-kanban.git
cd momo-kanban
npm install
openclaw gateway restart
```

## 📖 文档

完整文档请查看 [README.md](https://github.com/dichuxuanhuan/momo-kanban/blob/main/README.md)
```

### 4. 可选：添加 GitHub Topics

在仓库页面添加 topics：
- `openclaw`
- `openclaw-plugin`
- `task-management`
- `kanban`
- `typescript`
- `sqlite`

### 5. 可选：添加徽章到 README

在 README.md 顶部添加：

```markdown
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-green.svg)](https://openclaw.ai)
```

## 🎯 完成后

仓库地址：https://github.com/dichuxuanhuan/momo-kanban

用户可以通过以下方式安装：

```bash
cd ~/.openclaw/extensions
git clone https://github.com/dichuxuanhuan/momo-kanban.git
cd momo-kanban
npm install
openclaw gateway restart
```
