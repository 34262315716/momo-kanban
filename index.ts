/**
 * 陌陌看板插件 V2 (momo-kanban)
 * 
 * 全新架构：SQLite + 完整功能集
 * - 优先级、标签、备注、时间追踪
 * - 任务模板、归档、提醒
 * - 自动 scope 隔离（chat_id）
 * - 技能创建触发提醒
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { Type } from "@sinclair/typebox";
import { KanbanManagerV2 } from "./manager-v2";
import { migrateFromJSON } from "./migrate";
import os from "node:os";
import fs from "node:fs";

// ========================================
// 配置
// ========================================

const DEFAULT_DB_PATH = "~/.openclaw/data/kanban.db";
const DEFAULT_JSON_PATH = "~/.openclaw/data/kanban.json";
const BOARD_NAME = "陌陌工作看板";
const DEFAULT_SCOPE = "main";

interface KanbanConfig {
  dbPath: string;
  injectEnabled: boolean;
  autoMigrate: boolean;
}

const configSchema = {
  parse(value: unknown): KanbanConfig {
    const raw = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

    return {
      dbPath: (raw.dbPath as string) || DEFAULT_DB_PATH,
      injectEnabled: raw.injectEnabled !== false,
      autoMigrate: raw.autoMigrate !== false,
    };
  },

  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      dbPath: {
        type: "string",
        default: DEFAULT_DB_PATH,
        description: "SQLite 数据库文件路径",
      },
      injectEnabled: {
        type: "boolean",
        default: true,
        description: "是否将看板状态注入到上下文",
      },
      autoMigrate: {
        type: "boolean",
        default: true,
        description: "启动时自动从 JSON 迁移到 SQLite",
      },
    },
  },

  uiHints: {
    dbPath: {
      label: "数据库路径",
      placeholder: DEFAULT_DB_PATH,
    },
    injectEnabled: {
      label: "启用上下文注入",
      help: "开启后看板状态会持续显示在对话上下文中",
    },
    autoMigrate: {
      label: "自动迁移",
      help: "首次启动时自动从旧 JSON 格式迁移到 SQLite",
    },
  },
};

// ========================================
// 系统提示词
// ========================================

const SYSTEM_PROMPT_GUIDANCE = `
[KANBAN_BOARD_GUIDANCE]

## How to Use the Kanban Board

When you receive a complex task, use the kanban tools to break it down into smaller steps and execute them systematically.

### Available Tools:
- kanban_add - Add a new task with optional priority, tags, notes, dependencies, deadline
- kanban_list - View tasks (filter by scope/status/priority/tags)
- kanban_do - Start a task (checks dependencies first)
- kanban_done - Complete a task (auto-reports unlocked downstream tasks)
- kanban_update - Update task details (priority/notes/tags/deadline)
- kanban_delete - Remove a task
- kanban_archive - Archive completed tasks
- kanban_reset - Clear the board
- kanban_template_save - Save current tasks as a reusable template
- kanban_template_apply - Apply a template to create task batch
- kanban_template_list - List available templates

### Priority Levels:
- urgent 🔴 - Critical, do immediately
- high 🟡 - Important, do soon
- normal ⚪ - Regular priority (default)
- low 🔵 - Nice to have

### Scope (Auto Chat Isolation):
- Tasks are automatically scoped by chat_id
- Different Discord channels = different task boards
- Use explicit scope parameter to override

### Dependencies:
- Use blocked_by to specify task IDs that must complete first
- Blocked tasks show 🔒 and cannot be started until dependencies are done
- When a task completes, downstream tasks are automatically unlocked

### Tags:
- Add tags for categorization (#bug #feature #docs)
- Filter tasks by tags using kanban_list

### Time Tracking:
- created_at, started_at, completed_at are tracked automatically
- Use deadline parameter for time-sensitive tasks

### Key Principles:
1. When starting a complex task, FIRST define the step breakdown
2. Only ONE task can be "doing" per scope
3. Use priority to organize TODO list
4. Use tags for cross-cutting concerns
5. Use templates for recurring workflows

The board state is continuously injected at the top of context.

[End of Kanban Board Guidance]
`;

// ========================================
// 技能触发追踪器
// ========================================

const CORRECTION_KEYWORDS = [
  "不对", "错了", "应该是", "不是这样", "搞错",
  "重新", "不行", "换一种", "别这样", "不要这样",
  "没听懂", "你理解错", "说的不是", "笨",
];

const SKILL_REMINDER_TEMPLATE = `
[SKILL_CREATION_ALERT]
⚠️ SKILL CREATION TRIGGER DETECTED

Reason: {{reason}}
Details:
{{details}}

ACTION REQUIRED:
1. PAUSE current kanban task (do NOT mark it done yet)
2. Create or update a skill to document the solution/pattern you just discovered
3. After the skill is written, dismiss this reminder with kanban_dismiss_reminder
4. Then RESUME the kanban task

Decision criteria (2 of 3 must be true to save):
- Reusability: Can this workflow be directly reused next time?
- Discoverability: Will you remember this in 2 months without a record?
- Uniqueness: Is this a universal pattern, not just a one-off workaround?

[End of Skill Creation Alert]
`;

interface SkillTriggerState {
  toolCalls: Array<{ toolName: string; error?: string; timestamp: number }>;
  errorPatterns: Record<string, number>;
  userCorrectionDetected: boolean;
  activeReminder: { id: string; reason: string; details: string[]; createdAt: number } | null;
}

class SkillTriggerTracker {
  private state: SkillTriggerState;
  private logger: { info: (msg: string) => void; warn: (msg: string) => void };

  constructor(logger: { info: (msg: string) => void; warn: (msg: string) => void }) {
    this.logger = logger;
    this.state = {
      toolCalls: [],
      errorPatterns: {},
      userCorrectionDetected: false,
      activeReminder: null,
    };
  }

  resetForNewTask(): void {
    this.state.toolCalls = [];
    this.state.errorPatterns = {};
    this.state.userCorrectionDetected = false;
  }

  recordToolCall(toolName: string, error?: string): void {
    this.state.toolCalls.push({ toolName, error, timestamp: Date.now() });
    if (error) {
      const errorKey = `${toolName}:${error.slice(0, 50)}`;
      this.state.errorPatterns[errorKey] = (this.state.errorPatterns[errorKey] || 0) + 1;
    }
    this.checkTriggers();
  }

  checkUserMessage(content: string): void {
    const lower = content.toLowerCase();
    for (const keyword of CORRECTION_KEYWORDS) {
      if (lower.includes(keyword)) {
        this.state.userCorrectionDetected = true;
        this.checkTriggers();
        return;
      }
    }
  }

  private checkTriggers(): void {
    if (this.state.activeReminder) return;

    const triggers: string[] = [];
    const hasErrors = this.state.toolCalls.some((tc) => tc.error);
    if (this.state.toolCalls.length >= 5 && hasErrors) {
      triggers.push(`High complexity: ${this.state.toolCalls.length} tool calls with errors`);
    }
    for (const [pattern, count] of Object.entries(this.state.errorPatterns)) {
      if (count >= 2) {
        triggers.push(`Repeated error: "${pattern}" occurred ${count} times`);
      }
    }
    if (this.state.userCorrectionDetected) {
      triggers.push("User correction detected - possible knowledge gap");
    }

    if (triggers.length > 0) {
      this.state.activeReminder = {
        id: `reminder_${Date.now()}`,
        reason: triggers[0],
        details: triggers,
        createdAt: Date.now(),
      };
      this.logger.warn(`[momo-kanban] 技能创建触发! ${triggers.join("; ")}`);
    }
  }

  getActiveReminder(): string | null {
    if (!this.state.activeReminder) return null;
    return SKILL_REMINDER_TEMPLATE
      .replace("{{reason}}", this.state.activeReminder.reason)
      .replace("{{details}}", this.state.activeReminder.details.map((d) => `  - ${d}`).join("\n"));
  }

  dismissReminder(): string {
    if (!this.state.activeReminder) return "No active reminder to dismiss.";
    const id = this.state.activeReminder.id;
    this.state.activeReminder = null;
    this.state.userCorrectionDetected = false;
    return `Reminder ${id} dismissed. Resume your kanban tasks.`;
  }
}

// ========================================
// 插件定义
// ========================================

const momoKanbanPlugin = {
  id: "momo-kanban",
  name: "陌陌看板 V2",
  description: "任务看板 - SQLite + 完整功能集（优先级/标签/模板/提醒）",
  version: "2.0.0",
  configSchema,

  register(api: OpenClawPluginApi): void {
    const config = configSchema.parse(api.pluginConfig);
    
    // 自动迁移
    if (config.autoMigrate) {
      const jsonPath = DEFAULT_JSON_PATH.replace(/^~/, os.homedir());
      const dbPath = config.dbPath.replace(/^~/, os.homedir());
      if (fs.existsSync(jsonPath) && !fs.existsSync(dbPath)) {
        api.logger.info("[momo-kanban] 检测到旧数据，开始迁移...");
        try {
          migrateFromJSON(jsonPath, dbPath);
          api.logger.info("[momo-kanban] 迁移完成！");
        } catch (error: any) {
          api.logger.warn(`[momo-kanban] 迁移失败: ${error.message}`);
        }
      }
    }

    const manager = new KanbanManagerV2(config.dbPath, DEFAULT_SCOPE, BOARD_NAME, api.logger);
    const tracker = new SkillTriggerTracker(api.logger);

    // 上下文存储（从 hook 注入）
    let currentContext: any = null;

    api.logger.info("[momo-kanban] V2 插件加载中...");

    // ========================================
    // 工具：添加任务
    // ========================================
    api.registerTool({
      name: "kanban_add",
      label: "看板添加任务",
      description: "添加新任务到看板，支持优先级/标签/备注/依赖/截止时间/分配子代理",
      parameters: Type.Object({
        title: Type.String({ description: "任务标题" }),
        scope: Type.Optional(Type.String({ description: "任务 scope（默认自动从 chat_id 推断）" })),
        priority: Type.Optional(Type.Union([
          Type.Literal("urgent"),
          Type.Literal("high"),
          Type.Literal("normal"),
          Type.Literal("low"),
        ], { description: "优先级（默认 normal）" })),
        tags: Type.Optional(Type.Array(Type.String(), { description: "标签列表" })),
        notes: Type.Optional(Type.String({ description: "备注/详情" })),
        blocked_by: Type.Optional(Type.Array(Type.String(), { description: "依赖的任务 ID 列表" })),
        deadline: Type.Optional(Type.Number({ description: "截止时间（Unix 毫秒时间戳）" })),
        assigned_to: Type.Optional(Type.String({ description: "分配给哪个子代理（session_key）" })),
      }),
      async execute(_toolCallId, params) {
        const result = manager.addTask({
          title: params.title as string,
          scope: params.scope as string | undefined,
          priority: params.priority as any,
          tags: params.tags as string[] | undefined,
          notes: params.notes as string | undefined,
          blockedBy: params.blocked_by as string[] | undefined,
          deadline: params.deadline as number | undefined,
          assignedTo: params.assigned_to as string | undefined,
        }, currentContext);

        if (!result.success) {
          return { content: [{ type: "text" as const, text: `❌ ${result.error}` }] };
        }

        const depInfo = result.task?.blocked_by ? ` (依赖: ${result.task.blocked_by.join(", ")})` : "";
        const assignInfo = result.task?.assigned_to ? ` → @${result.task.assigned_to}` : "";
        return {
          content: [{
            type: "text" as const,
            text: `✅ 已添加: ${result.task?.title}${depInfo}${assignInfo}\n\n${manager.getInjectContent(result.task?.scope, currentContext)}`,
          }],
        };
      },
    });

    // ========================================
    // 工具：列出任务
    // ========================================
    api.registerTool({
      name: "kanban_list",
      label: "看板列表",
      description: "查看任务列表，支持按 scope/status/priority/tags 过滤",
      parameters: Type.Object({
        scope: Type.Optional(Type.String({ description: "指定 scope" })),
        show_all: Type.Optional(Type.Boolean({ description: "显示所有 scope" })),
        status: Type.Optional(Type.Union([
          Type.Literal("todo"),
          Type.Literal("doing"),
          Type.Literal("done"),
          Type.Literal("archived"),
        ])),
        priority: Type.Optional(Type.Union([
          Type.Literal("urgent"),
          Type.Literal("high"),
          Type.Literal("normal"),
          Type.Literal("low"),
        ])),
        tags: Type.Optional(Type.Array(Type.String(), { description: "按标签过滤" })),
      }),
      async execute(_toolCallId, params) {
        const tasks = manager.listTasks({
          scope: params.scope as string | undefined,
          showAll: params.show_all as boolean | undefined,
          status: params.status as any,
          priority: params.priority as any,
          tags: params.tags as string[] | undefined,
        }, currentContext);

        if (tasks.length === 0) {
          return { content: [{ type: "text" as const, text: "📋 没有任务" }] };
        }

        return {
          content: [{ type: "text" as const, text: manager.getInjectContent(params.scope as string | undefined, currentContext) }],
        };
      },
    });

    // ========================================
    // 工具：开始任务
    // ========================================
    api.registerTool({
      name: "kanban_do",
      label: "看板开始任务",
      description: "开始执行任务（标记为 doing）",
      parameters: Type.Object({
        task_id: Type.String({ description: "任务 ID" }),
      }),
      async execute(_toolCallId, params) {
        const result = manager.doTask(params.task_id as string);
        if (!result.success) {
          const msg = result.blockedInfo ? `🔒 ${result.error}\n\n${result.blockedInfo}` : `❌ ${result.error}`;
          return { content: [{ type: "text" as const, text: msg }] };
        }

        tracker.resetForNewTask();
        return {
          content: [{
            type: "text" as const,
            text: `🔵 开始执行: ${result.task?.title}\n\n${manager.getInjectContent(result.task?.scope)}`,
          }],
        };
      },
    });

    // ========================================
    // 工具：完成任务
    // ========================================
    api.registerTool({
      name: "kanban_done",
      label: "看板完成任务",
      description: "标记任务为已完成",
      parameters: Type.Object({
        task_id: Type.String({ description: "任务 ID" }),
      }),
      async execute(_toolCallId, params) {
        const result = manager.doneTask(params.task_id as string);
        if (!result.success) {
          return { content: [{ type: "text" as const, text: `❌ ${result.error}` }] };
        }

        let msg = `✅ 已完成: ${result.task?.title}`;
        if (result.unlockedTasks && result.unlockedTasks.length > 0) {
          const unlocked = result.unlockedTasks.map((t) => `  • [${t.id}] ${t.title}`).join("\n");
          msg += `\n\n🔓 已解锁:\n${unlocked}`;
        }
        msg += `\n\n${manager.getInjectContent(result.task?.scope)}`;

        return { content: [{ type: "text" as const, text: msg }] };
      },
    });

    // ========================================
    // 工具：更新任务
    // ========================================
    api.registerTool({
      name: "kanban_update",
      label: "看板更新任务",
      description: "更新任务的优先级/备注/标签/截止时间",
      parameters: Type.Object({
        task_id: Type.String({ description: "任务 ID" }),
        priority: Type.Optional(Type.Union([
          Type.Literal("urgent"),
          Type.Literal("high"),
          Type.Literal("normal"),
          Type.Literal("low"),
        ])),
        notes: Type.Optional(Type.String({ description: "备注" })),
        tags: Type.Optional(Type.Array(Type.String(), { description: "标签" })),
        deadline: Type.Optional(Type.Number({ description: "截止时间" })),
      }),
      async execute(_toolCallId, params) {
        const result = manager.updateTask(params.task_id as string, {
          priority: params.priority as any,
          notes: params.notes as string | undefined,
          tags: params.tags as string[] | undefined,
          deadline: params.deadline as number | undefined,
        });

        if (!result.success) {
          return { content: [{ type: "text" as const, text: `❌ ${result.error}` }] };
        }

        return {
          content: [{
            type: "text" as const,
            text: `✅ 已更新: ${result.task?.title}\n\n${manager.getInjectContent(result.task?.scope)}`,
          }],
        };
      },
    });

    // ========================================
    // 工具：删除任务
    // ========================================
    api.registerTool({
      name: "kanban_delete",
      label: "看板删除任务",
      description: "从看板删除任务",
      parameters: Type.Object({
        task_id: Type.String({ description: "任务 ID" }),
      }),
      async execute(_toolCallId, params) {
        const result = manager.deleteTask(params.task_id as string);
        if (!result.success) {
          return { content: [{ type: "text" as const, text: `❌ ${result.error}` }] };
        }
        return {
          content: [{ type: "text" as const, text: `🗑️ 已删除\n\n${manager.getInjectContent(undefined, currentContext)}` }],
        };
      },
    });

    // ========================================
    // 工具：归档任务
    // ========================================
    api.registerTool({
      name: "kanban_archive",
      label: "看板归档任务",
      description: "归档已完成的任务",
      parameters: Type.Object({
        task_id: Type.String({ description: "任务 ID" }),
      }),
      async execute(_toolCallId, params) {
        const result = manager.archiveTask(params.task_id as string);
        if (!result.success) {
          return { content: [{ type: "text" as const, text: `❌ ${result.error}` }] };
        }
        return {
          content: [{ type: "text" as const, text: `📦 已归档\n\n${manager.getInjectContent(undefined, currentContext)}` }],
        };
      },
    });

    // ========================================
    // 工具：重置看板
    // ========================================
    api.registerTool({
      name: "kanban_reset",
      label: "看板重置",
      description: "清空看板任务",
      parameters: Type.Object({
        scope: Type.Optional(Type.String({ description: "只清空指定 scope" })),
      }),
      async execute(_toolCallId, params) {
        const result = manager.resetBoard(params.scope as string | undefined, currentContext);
        tracker.resetForNewTask();
        const scopeInfo = params.scope ? ` (scope: ${params.scope}, 删除 ${result.removedCount} 个)` : "";
        return {
          content: [{
            type: "text" as const,
            text: `🔄 看板已重置${scopeInfo}\n\n${manager.getInjectContent(undefined, currentContext)}`,
          }],
        };
      },
    });

    // ========================================
    // 工具：保存模板
    // ========================================
    api.registerTool({
      name: "kanban_template_save",
      label: "保存任务模板",
      description: "将当前任务保存为可复用模板",
      parameters: Type.Object({
        template_id: Type.String({ description: "模板 ID" }),
        name: Type.String({ description: "模板名称" }),
        description: Type.Optional(Type.String({ description: "模板描述" })),
        task_ids: Type.Array(Type.String(), { description: "要保存的任务 ID 列表" }),
      }),
      async execute(_toolCallId, params) {
        const taskIds = params.task_ids as string[];
        const tasks = taskIds.map((id) => manager.listTasks({ showAll: true }).find((t) => t.id === id)).filter(Boolean);
        
        if (tasks.length === 0) {
          return { content: [{ type: "text" as const, text: "❌ 没有找到有效任务" }] };
        }

        const templateTasks = tasks.map((t, idx) => ({
          title: t!.title,
          priority: t!.priority,
          notes: t!.notes,
          order_index: idx,
          blocked_by_indexes: t!.blocked_by?.map((depId) => taskIds.indexOf(depId)).filter((i) => i >= 0),
        }));

        const result = manager.saveTemplate({
          id: params.template_id as string,
          name: params.name as string,
          description: params.description as string | undefined,
          tasks: templateTasks,
        });

        if (!result.success) {
          return { content: [{ type: "text" as const, text: `❌ ${result.error}` }] };
        }

        return {
          content: [{
            type: "text" as const,
            text: `✅ 模板已保存: ${result.template?.name} (${result.template?.tasks.length} 个任务)`,
          }],
        };
      },
    });

    // ========================================
    // 工具：应用模板
    // ========================================
    api.registerTool({
      name: "kanban_template_apply",
      label: "应用任务模板",
      description: "从模板批量创建任务",
      parameters: Type.Object({
        template_id: Type.String({ description: "模板 ID" }),
        scope: Type.Optional(Type.String({ description: "目标 scope" })),
      }),
      async execute(_toolCallId, params) {
        const result = manager.applyTemplate(params.template_id as string, params.scope as string | undefined, currentContext);
        if (!result.success) {
          return { content: [{ type: "text" as const, text: `❌ ${result.error}` }] };
        }

        return {
          content: [{
            type: "text" as const,
            text: `✅ 已创建 ${result.tasks?.length} 个任务\n\n${manager.getInjectContent(params.scope as string | undefined, currentContext)}`,
          }],
        };
      },
    });

    // ========================================
    // 工具：列出模板
    // ========================================
    api.registerTool({
      name: "kanban_template_list",
      label: "列出任务模板",
      description: "查看所有可用模板",
      parameters: Type.Object({}),
      async execute() {
        const templates = manager.listTemplates();
        if (templates.length === 0) {
          return { content: [{ type: "text" as const, text: "📋 没有模板" }] };
        }

        const lines = templates.map((t) => `• [${t.id}] ${t.name} (${t.tasks.length} 个任务)`);
        return { content: [{ type: "text" as const, text: `📋 可用模板:\n${lines.join("\n")}` }] };
      },
    });

    // ========================================
    // 工具：消除技能提醒
    // ========================================
    api.registerTool({
      name: "kanban_dismiss_reminder",
      label: "消除技能提醒",
      description: "写完技能后消除提醒",
      parameters: Type.Object({}),
      async execute() {
        const result = tracker.dismissReminder();
        return { content: [{ type: "text" as const, text: `✅ ${result}` }] };
      },
    });

    // ========================================
    // Hooks
    // ========================================

    // Hook: 上下文捕获
    api.registerHook("message_received", (event) => {
      currentContext = (event as any)?.context || null;
    }, { name: "momo-kanban.context-capture" });

    // Hook: 工具调用追踪
    api.registerHook("after_tool_call", (event) => {
      if (event.toolName.startsWith("kanban_")) return;
      tracker.recordToolCall(event.toolName, event.error);
    }, { name: "momo-kanban.tool-tracker" });

    // Hook: 用户纠正检测
    api.registerHook("message_received", (event) => {
      if (event.content) tracker.checkUserMessage(event.content);
    }, { name: "momo-kanban.correction-detector" });

    // Hook: 上下文注入
    if (config.injectEnabled) {
      api.registerHook("before_prompt_build", (_event, data) => {
        const context = (_event as any)?.context;
        const boardContent = manager.getInjectContent(undefined, currentContext);
        const skillReminder = tracker.getActiveReminder();

        let injectContent = `${boardContent}\n\n${SYSTEM_PROMPT_GUIDANCE}`;
        if (skillReminder) {
          injectContent += `\n\n${skillReminder}`;
        }

        data.promptEntries.unshift({
          role: "system",
          content: injectContent,
        });

        return data;
      }, { name: "momo-kanban.inject" });
    }

    api.logger.info("[momo-kanban] V2 插件加载完成！");
  },
};

export default momoKanbanPlugin;
