# 陌陌看板 (momo-kanban)

> 陌陌的任务看板 — 帮助分解复杂任务、逐步执行、持续追踪的 OpenClaw 插件

## 功能特性

- ✅ **任务分解** — 将复杂任务分解为小步骤
- ✅ **状态流转** — `todo → doing → done` 三状态管理
- ✅ **会话隔离** — 通过 scope 实现多 Agent/会话独立看板
- ✅ **任务依赖** — 支持 blocked_by 定义前置任务，自动检查和解锁
- ✅ **上下文注入** — 看板状态持续显示在对话上下文中
- ✅ **技能触发提醒** — 自动检测复杂任务和错误模式，提醒创建 skill
- ✅ **自动推进** — AI 自主分解任务、自主推进，无需人工干预
- ✅ **持久化存储** — JSON 文件存储，重启后数据保留

## 工作原理

1. **开始工作时**：先用 `kanban_add` 定义步骤分解
2. **执行时**：用 `kanban_do` 开始任务，`kanban_done` 标记完成
3. **遇到问题**：根据情况调整步骤（删除并重新添加）
4. **上下文提醒**：看板状态持续注入，AI 始终看到当前进度

## 安装

插件位于 `extensions/momo-kanban/`，OpenClaw 会自动加载。

如果需要重新安装依赖：
```bash
cd extensions/momo-kanban
npm install
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
          "dataFile": "~/.openclaw/data/kanban.json",
          "injectEnabled": true,
          "maxTasks": 20
        }
      }
    }
  }
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `dataFile` | string | `~/.openclaw/data/kanban.json` | 看板数据存储路径 |
| `injectEnabled` | boolean | `true` | 是否将看板状态注入到上下文 |
| `maxTasks` | number | `20` | 最大任务数量 |

## 工具列表

### kanban_add
添加一个新步骤到看板上。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 任务/步骤的标题描述 |
| `scope` | string | ❌ | 所属 scope，用于会话/Agent 隔离，默认 `main` |
| `blocked_by` | string[] | ❌ | 前置任务 ID 列表，这些任务完成后才能开始本任务 |

```typescript
// 基础用法
kanban_add({ title: "步骤描述" })

// 子代理隔离
kanban_add({ title: "子任务", scope: "agent-1" })

// 带依赖
kanban_add({ title: "部署", blocked_by: ["task_xxx_001", "task_xxx_002"] })
```

### kanban_list
查看看板上的步骤和进度。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scope` | string | ❌ | 只查看指定 scope，默认 `main` |
| `show_all` | boolean | ❌ | 为 `true` 时查看所有 scope |

```typescript
kanban_list({})                        // 查看 main scope
kanban_list({ scope: "agent-1" })      // 查看指定 scope
kanban_list({ show_all: true })        // 查看全部
```

### kanban_do
开始执行某个步骤（标记为 doing）。会检查依赖是否已完成，被阻塞的任务无法开始。

```typescript
kanban_do({ task_id: "task_xxx" })
```

### kanban_done
标记步骤为已完成。完成后自动检测并报告解锁的下游任务。

```typescript
kanban_done({ task_id: "task_xxx" })
```

### kanban_delete
从看板删除一个步骤。

```typescript
kanban_delete({ task_id: "task_xxx" })
```

### kanban_reset
清除看板上的任务。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scope` | string | ❌ | 只清除指定 scope，不填则清除全部 |

```typescript
kanban_reset({})                    // 清除全部
kanban_reset({ scope: "agent-1" }) // 只清除指定 scope
```

### kanban_dismiss_reminder
消除当前的技能创建提醒。在写完技能文档后调用，然后继续推进看板任务。

```typescript
kanban_dismiss_reminder({})
```

## 使用示例

### 场景：开发一个网站

**1. 开始时，分解任务：**
```
用户：帮我开发一个博客网站

陌陌：好的，让我先分解任务步骤...
→ kanban_add({ title: "调研博客需求和功能" })
→ kanban_add({ title: "设计数据库结构" })
→ kanban_add({ title: "实现后端 API" })
→ kanban_add({ title: "实现前端页面" })
→ kanban_add({ title: "测试和部署" })
```

**2. 开始第一个任务：**
```
→ kanban_do({ task_id: "task_xxx_001" })
```

**3. 完成后标记：**
```
→ kanban_done({ task_id: "task_xxx_001" })
→ kanban_do({ task_id: "task_xxx_002" })  // 自动开始下一个
```

**4. 遇到新情况，调整步骤：**
```
→ kanban_delete({ task_id: "task_xxx_003" })
→ kanban_add({ title: "添加用户认证功能" })
→ kanban_add({ title: "实现权限管理" })
```

## 上下文注入效果

每次对话开始时，上下文会注入类似这样的内容：

```
[KANBAN_BOARD]
陌陌工作看板

🔵 IN PROGRESS:
   [task_xxx_002] 设计数据库结构

📋 TODO:
   [task_xxx_003] 实现后端 API
   [task_xxx_004] 实现前端页面

✅ DONE (1):
   [task_xxx_001] 调研博客需求和功能

[KANBAN_BOARD_GUIDANCE]
## How to Use the Kanban Board
...
```

## 状态规则

- `todo` — 待处理，还未开始
- `doing` — 正在做，当前执行中（同一 scope 内只能有一个）
- `done` — 已完成

**依赖规则**：有 `blocked_by` 的任务，前置任务未完成时无法 `kanban_do`，看板中显示 🔒 标记；前置全部完成后显示 ✅解锁。

**Scope 规则**：每个 scope 独立管理自己的 doing 任务，互不干扰。子代理应使用独立 scope 避免冲突。

## 文件结构

```
extensions/momo-kanban/
├── index.ts                  # 核心代码
├── types/
│   └── openclaw.d.ts        # OpenClaw SDK 类型声明
├── openclaw.plugin.json      # 插件清单
├── package.json              # 依赖定义
├── tsconfig.json             # TypeScript 配置
└── .git/                    # Git 仓库
```

## 技术栈

- TypeScript
- @sinclair/typebox — 参数类型定义
- OpenClaw Plugin SDK

## 许可证

MIT
