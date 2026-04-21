# 陌陌看板 (momo-kanban)

> 陌陌的任务看板 — 帮助分解复杂任务、逐步执行、持续追踪的 OpenClaw 插件

## 功能特性

- ✅ **任务分解** — 将复杂任务分解为小步骤
- ✅ **状态流转** — `todo → doing → done` 三状态管理
- ✅ **上下文注入** — 看板状态持续显示在对话上下文中
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

```typescript
kanban_add({ title: "步骤描述" })
```

### kanban_list
查看当前所有步骤和进度。

```typescript
kanban_list({})
```

### kanban_do
开始执行某个步骤（标记为 doing）。

```typescript
kanban_do({ task_id: "task_xxx" })
```

### kanban_done
标记步骤为已完成。

```typescript
kanban_done({ task_id: "task_xxx" })
```

### kanban_delete
从看板删除一个步骤。

```typescript
kanban_delete({ task_id: "task_xxx" })
```

### kanban_reset
清除看板上的所有任务。

```typescript
kanban_reset({})
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
- `doing` — 正在做，当前执行中
- `done` — 已完成

**重要限制**：同一时间只能有一个「doing」任务。开始新任务时，旧的 doing 任务会自动移回 todo。

## 文件结构

```
extensions/momo-kanban/
├── index.ts                  # 核心代码
├── openclaw.plugin.json      # 插件清单
├── package.json              # 依赖定义
└── .git/                    # Git 仓库
```

## 技术栈

- TypeScript
- @sinclair/typebox — 参数类型定义
- OpenClaw Plugin SDK

## 许可证

MIT
