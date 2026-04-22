# 陌陌看板 V2 (momo-kanban)

> 陌陌的任务看板 — 帮助分解复杂任务、逐步执行、持续追踪的 OpenClaw 插件

## 🎉 V2 新特性

- ✨ **SQLite 数据库** — 从 JSON 升级到 SQLite，性能更好、查询更灵活
- ✨ **优先级系统** — 🔴 urgent / 🟡 high / ⚪ normal / 🔵 low
- ✨ **标签分类** — 用标签组织任务，支持按标签过滤
- ✨ **备注详情** — 为任务添加详细说明
- ✨ **时间追踪** — 自动记录创建/开始/完成/归档时间
- ✨ **任务模板** — 保存常用工作流程，一键复用
- ✨ **归档功能** — 完成的任务可归档，保持看板整洁
- ✨ **自动迁移** — 首次启动自动从 V1 JSON 迁移到 V2 SQLite
- ✨ **自动 scope 隔离** — 不同 Discord 频道自动隔离任务
- ✨ **子代理部分可见** — 子代理只能看到自己的任务 + 分配给自己的任务

## 核心功能

- ✅ **任务分解** — 将复杂任务分解为小步骤
- ✅ **状态流转** — `todo → doing → done → archived` 四状态管理
- ✅ **会话隔离** — 通过 scope 实现多 Agent/会话独立看板
- ✅ **任务依赖** — 支持 blocked_by 定义前置任务，自动检查和解锁
- ✅ **上下文注入** — 看板状态持续显示在对话上下文中
- ✅ **技能触发提醒** — 自动检测复杂任务和错误模式，提醒创建 skill
- ✅ **自动推进** — AI 自主分解任务、自主推进，无需人工干预
- ✅ **持久化存储** — SQLite 数据库，重启后数据保留

## 工作原理

1. **开始工作时**：先用 `kanban_add` 定义步骤分解
2. **执行时**：用 `kanban_do` 开始任务，`kanban_done` 标记完成
3. **遇到问题**：根据情况调整步骤（删除并重新添加）
4. **上下文提醒**：看板状态持续注入，AI 始终看到当前进度

## 安装

### 方式 1：从 GitHub 安装（推荐）

```bash
cd ~/.openclaw/extensions
git clone https://github.com/dichuxuanhuan/momo-kanban.git
cd momo-kanban
npm install
```

### 方式 2：手动安装

1. 下载最新 release
2. 解压到 `~/.openclaw/extensions/momo-kanban/`
3. 安装依赖：
```bash
cd ~/.openclaw/extensions/momo-kanban
npm install
```

### 重启 OpenClaw

```bash
openclaw gateway restart
```

## 配置

在 OpenClaw 配置文件中设置插件配置：

```json
{
  "plugins": {
    "entries": {
      "momo-kanban": {
        "enabled": true,
        "config": {
          "dbPath": "~/.openclaw/data/kanban.db",
          "injectEnabled": true,
          "autoMigrate": true
        }
      }
    }
  }
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `dbPath` | string | `~/.openclaw/data/kanban.db` | SQLite 数据库路径 |
| `injectEnabled` | boolean | `true` | 是否将看板状态注入到上下文 |
| `autoMigrate` | boolean | `true` | 首次启动时自动从 JSON 迁移到 SQLite |

## 工具列表

### 基础操作

#### kanban_add
添加一个新任务到看板。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 任务标题 |
| `scope` | string | ❌ | 所属 scope，默认自动从 chat_id 推断 |
| `priority` | string | ❌ | 优先级：urgent/high/normal/low，默认 normal |
| `tags` | string[] | ❌ | 标签列表，如 ["bug", "urgent"] |
| `notes` | string | ❌ | 备注/详情 |
| `blocked_by` | string[] | ❌ | 前置任务 ID 列表 |
| `deadline` | number | ❌ | 截止时间（Unix 毫秒时间戳） |
| `assigned_to` | string | ❌ | 分配给哪个子代理（session_key） |

```typescript
// 基础用法
kanban_add({ title: "实现登录功能" })

// 完整用法
kanban_add({
  title: "修复生产环境 bug",
  priority: "urgent",
  tags: ["bug", "production"],
  notes: "用户反馈登录失败，需紧急修复",
  deadline: Date.now() + 24 * 60 * 60 * 1000  // 24小时后
})

// 带依赖
kanban_add({
  title: "部署到生产",
  blocked_by: ["task_xxx_001", "task_xxx_002"]
})
```

#### kanban_list
查看任务列表。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scope` | string | ❌ | 只查看指定 scope |
| `show_all` | boolean | ❌ | 为 `true` 时查看所有 scope |
| `status` | string | ❌ | 按状态过滤：todo/doing/done/archived |
| `priority` | string | ❌ | 按优先级过滤：urgent/high/normal/low |
| `tags` | string[] | ❌ | 按标签过滤 |

```typescript
kanban_list({})                                    // 查看当前 scope
kanban_list({ show_all: true })                    // 查看全部 scope
kanban_list({ status: "archived" })                // 查看归档任务
kanban_list({ priority: "urgent" })                // 查看紧急任务
kanban_list({ tags: ["bug"] })                     // 查看带 bug 标签的任务
```

#### kanban_do
开始执行任务（标记为 doing）。会检查依赖是否已完成。

```typescript
kanban_do({ task_id: "task_xxx" })
```

#### kanban_done
标记任务为已完成。完成后自动检测并报告解锁的下游任务。

```typescript
kanban_done({ task_id: "task_xxx" })
```

#### kanban_update
更新任务的优先级/备注/标签/截止时间。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | ✅ | 任务 ID |
| `priority` | string | ❌ | 新的优先级 |
| `notes` | string | ❌ | 新的备注 |
| `tags` | string[] | ❌ | 新的标签列表 |
| `deadline` | number | ❌ | 新的截止时间 |

```typescript
kanban_update({
  task_id: "task_xxx",
  priority: "urgent",
  notes: "增加详细说明"
})
```

#### kanban_delete
从看板删除任务。

```typescript
kanban_delete({ task_id: "task_xxx" })
```

#### kanban_archive
归档已完成的任务。

```typescript
kanban_archive({ task_id: "task_xxx" })
```

#### kanban_reset
清空看板任务。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scope` | string | ❌ | 只清空指定 scope，不填则清空当前 scope |

```typescript
kanban_reset({})                    // 清空当前 scope
kanban_reset({ scope: "agent-1" })  // 清空指定 scope
```

### 模板操作

#### kanban_template_save
保存当前任务为可复用模板。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `template_id` | string | ✅ | 模板 ID |
| `name` | string | ✅ | 模板名称 |
| `description` | string | ❌ | 模板描述 |
| `task_ids` | string[] | ✅ | 要保存的任务 ID 列表 |

```typescript
kanban_template_save({
  template_id: "feature-dev",
  name: "功能开发流程",
  description: "标准功能开发：需求 → 设计 → 编码 → 测试",
  task_ids: ["task_001", "task_002", "task_003"]
})
```

#### kanban_template_apply
从模板批量创建任务。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `template_id` | string | ✅ | 模板 ID |
| `scope` | string | ❌ | 目标 scope |

```typescript
kanban_template_apply({ template_id: "feature-dev" })
```

#### kanban_template_list
列出所有可用模板。

```typescript
kanban_template_list({})
```

### 技能提醒

#### kanban_dismiss_reminder
消除技能创建提醒。在写完技能文档后调用。

```typescript
kanban_dismiss_reminder({})
```

## 使用示例

### 场景 1：开发一个网站

**1. 开始时，分解任务：**
```typescript
kanban_add({ title: "调研博客需求和功能", priority: "high" })
kanban_add({ title: "设计数据库结构", priority: "high" })
kanban_add({ title: "实现后端 API", priority: "normal" })
kanban_add({ title: "实现前端页面", priority: "normal" })
kanban_add({ title: "测试和部署", priority: "low" })
```

**2. 开始第一个任务：**
```typescript
kanban_do({ task_id: "task_xxx_001" })
```

**3. 完成后标记：**
```typescript
kanban_done({ task_id: "task_xxx_001" })
kanban_do({ task_id: "task_xxx_002" })  // 开始下一个
```

### 场景 2：使用模板

**1. 创建标准工作流：**
```typescript
kanban_add({ title: "需求分析", priority: "high", tags: ["phase-1"] })
kanban_add({ title: "设计方案", priority: "high", tags: ["phase-2"], blocked_by: ["task_001"] })
kanban_add({ title: "编码实现", priority: "normal", tags: ["phase-3"], blocked_by: ["task_002"] })
```

**2. 保存为模板：**
```typescript
kanban_template_save({
  template_id: "feature-dev",
  name: "功能开发流程",
  task_ids: ["task_001", "task_002", "task_003"]
})
```

**3. 下次直接应用：**
```typescript
kanban_template_apply({ template_id: "feature-dev" })
```

### 场景 3：查看历史任务

**查看归档的任务：**
```typescript
kanban_list({ status: "archived" })
```

**按标签搜索：**
```typescript
kanban_list({ tags: ["bug"], show_all: true })
```

**查看紧急任务：**
```typescript
kanban_list({ priority: "urgent" })
```

### 场景 4：子代理协作

**主会话分配任务：**
```typescript
// 创建任务并分配给子代理
kanban_add({
  title: "开发用户认证模块",
  assigned_to: "subagent-auth",
  priority: "high",
  notes: "子代理可以在自己的 scope 下分解这个任务"
})
```

**子代理工作：**
```typescript
// 子代理 (session_key: subagent-auth) 看到分配的任务
kanban_list({})  // 看到主会话分配的任务

// 分解子任务（自动 scope: session:subagent-auth）
kanban_add({ title: "设计数据库表" })
kanban_add({ title: "实现登录 API" })
kanban_add({ title: "实现注册 API" })
kanban_add({ title: "写单元测试" })

// 逐个完成子任务
kanban_do({ task_id: "task_xxx_001" })
kanban_done({ task_id: "task_xxx_001" })
// ...

// 所有子任务完成后，标记主任务为完成
kanban_done({ task_id: "<主任务ID>" })
```

**主会话查看进度：**
```typescript
// 主会话可以看到所有任务（包括子代理的）
kanban_list({ show_all: true })
```

## 上下文注入效果

每次对话开始时，上下文会注入类似这样的内容：

```
[KANBAN_BOARD]
陌陌工作看板 [scope: main]

🔵 IN PROGRESS:
   🟡 [task_xxx_002] 设计数据库结构 #backend

📋 TODO:
   ⚪ [task_xxx_003] 实现后端 API #backend
   ⚪ [task_xxx_004] 实现前端页面 #frontend
   🔵 [task_xxx_005] 写文档 #docs

✅ DONE (1):
   🟡 [task_xxx_001] 调研博客需求和功能 #planning

[KANBAN_BOARD_GUIDANCE]
## How to Use the Kanban Board
...
```

## 状态规则

- `todo` — 待处理，还未开始
- `doing` — 正在做，当前执行中（同一 scope 内只能有一个）
- `done` — 已完成
- `archived` — 已归档

**依赖规则**：有 `blocked_by` 的任务，前置任务未完成时无法 `kanban_do`，看板中显示 🔒 标记；前置全部完成后显示 ✅解锁。

**Scope 规则**：
- 每个 scope 独立管理自己的 doing 任务，互不干扰
- 默认自动从 `chat_id` 推断 scope（不同 Discord 频道 = 不同看板）
- 可以手动指定 scope 覆盖自动推断

## 自动 Scope 隔离

V2 新增自动 scope 隔离功能：

- **Discord 频道 A** → scope: `chat:channel_id_a`
- **Discord 频道 B** → scope: `chat:channel_id_b`
- **子代理** → scope: `session:<session_key>`
- **主会话** → scope: `main`

不同频道和子代理的任务自动隔离，互不干扰。

## 子代理部分可见

**权限规则：**
- 子代理只能看到：
  - 自己 scope 的任务
  - 分配给自己的任务（`assigned_to`）
- 主会话可以看到所有任务

**工作流程：**
1. 主会话创建任务并分配给子代理（`assigned_to: "subagent-xxx"`）
2. 子代理看到分配的任务
3. 子代理在自己的 scope 下分解子任务
4. 子代理完成后标记主任务为 done
5. 主会话看到完成状态

**优势：**
- 任务隔离，避免污染
- 子代理可以自主分解任务
- 主会话保持全局视角

## 数据迁移

从 V1（JSON）迁移到 V2（SQLite）：

**自动迁移**（推荐）：
- 启用 `autoMigrate: true`（默认开启）
- 重启 OpenClaw
- 旧数据自动备份到 `kanban.json.backup`

**手动迁移**：
```bash
cd ~/.openclaw/extensions/momo-kanban
node -r esbuild-register migrate.ts ~/.openclaw/data/kanban.json ~/.openclaw/data/kanban.db
```

## 文件结构

```
extensions/momo-kanban/
├── index.ts                  # 主插件文件
├── db.ts                     # 数据库管理
├── manager-v2.ts             # V2 管理器
├── migrate.ts                # 数据迁移工具
├── schema.sql                # 数据库结构
├── types/
│   └── openclaw.d.ts        # OpenClaw SDK 类型声明
├── openclaw.plugin.json      # 插件清单
├── package.json              # 依赖定义
├── tsconfig.json             # TypeScript 配置
└── .git/                    # Git 仓库
```

## 技术栈

- TypeScript
- SQLite (better-sqlite3)
- @sinclair/typebox — 参数类型定义
- OpenClaw Plugin SDK

## 版本历史

### V2.1.0 (2026-04-22)
- ✨ 子代理部分可见功能
- ✨ 任务分配（assigned_to）
- ✨ 子代理自动 scope 隔离
- ✨ 权限过滤（子代理只看自己的 + 分配的）

### V2.0.0 (2026-04-22)
- ✨ 全新 SQLite 架构
- ✨ 优先级、标签、备注
- ✨ 任务模板
- ✨ 时间追踪
- ✨ 归档功能
- ✨ 自动 scope 隔离
- ✨ 技能创建触发提醒
- 🔧 数据迁移工具

### V1.0.0 (2026-04-21)
- 🎉 初始版本
- 基础任务管理
- 依赖关系
- Scope 隔离

## 许可证

MIT

## 贡献

欢迎贡献！请遵循以下流程：

1. Fork 这个仓库
2. 创建你的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交你的修改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

### 开发指南

```bash
# 克隆仓库
git clone https://github.com/dichuxuanhuan/momo-kanban.git
cd momo-kanban

# 安装依赖
npm install

# 类型检查
npx tsc --noEmit

# 测试插件
openclaw gateway restart
```

## 问题反馈

遇到问题或有建议？请在 [GitHub Issues](https://github.com/dichuxuanhuan/momo-kanban/issues) 提出。

## 作者

张涤玄 ([@dichuxuanhuan](https://github.com/dichuxuanhuan))

## 致谢

- [OpenClaw](https://openclaw.ai) - 强大的 AI 助手框架
- 所有贡献者和用户
