/**
 * 陌陌看板插件 (momo-kanban)
 *
 * 帮助陌陌分解任务、逐步执行、持续追踪的看板工具
 *
 * 核心功能：
 * - 将任务分解为小步骤
 * - 通过 todo → doing → done 状态流转逐步完成任务
 * - 将看板状态持续注入上下文前部，始终可见
 * - 提供系统提示词指引 AI 如何使用看板
 *
 * 开发参考：OpenClaw 插件开发文档
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ========================================
// 类型定义
// ========================================

type TaskStatus = "todo" | "doing" | "done";

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  scope: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  blockedBy?: string[];
}

interface KanbanData {
  tasks: Task[];
  currentTaskId?: string;
  boardName: string;
  lastUpdated: string;
}

/** 默认 scope */
const DEFAULT_SCOPE = "main";

interface KanbanConfig {
  dataFile: string;
  injectEnabled: boolean;
  maxTasks: number;
}

// ========================================
// 技能触发追踪类型
// ========================================

interface ToolCallRecord {
  toolName: string;
  error?: string;
  timestamp: number;
}

interface SkillTriggerState {
  /** 当前 doing 任务的工具调用记录 */
  toolCalls: ToolCallRecord[];
  /** 错误模式计数 (errorKey -> count) */
  errorPatterns: Record<string, number>;
  /** 用户纠正检测标记 */
  userCorrectionDetected: boolean;
  /** 当前活跃的提醒（null = 无提醒） */
  activeReminder: SkillReminder | null;
  /** 已消除的提醒 ID 列表 */
  dismissedReminders: string[];
}

interface SkillReminder {
  id: string;
  triggerReason: string;
  triggerDetails: string[];
  createdAt: number;
}

// ========================================
// 常量
// ========================================

const BOARD_NAME = "陌陌工作看板";
const INJECT_PREFIX = "[KANBAN_BOARD]";
const DEFAULT_DATA_FILE = "~/.openclaw/data/kanban.json";

const SYSTEM_PROMPT_GUIDANCE = `
[KANBAN_BOARD_GUIDANCE]

## How to Use the Kanban Board

When you receive a complex task, use the kanban tools to break it down into smaller steps and execute them systematically.

### Available Tools:
- kanban_add <title> [scope] [blocked_by] - Add a new step (optional: scope for isolation, blocked_by for dependencies)
- kanban_list [show_all] - View steps and progress (show_all=true to see all scopes)
- kanban_do <task_id> - Mark a step as in-progress (checks dependencies first)
- kanban_done <task_id> - Mark a step as completed (auto-reports unlocked downstream tasks)
- kanban_delete <task_id> - Remove a step from the board
- kanban_reset [scope] - Clear the board (optional: only clear specific scope)

### Scope (Session Isolation):
- Each task belongs to a scope (default: "main")
- Subagents should use their own scope to avoid conflicts
- Use show_all=true in kanban_list to see all scopes at once

### Dependencies:
- Use blocked_by to specify task IDs that must complete first
- Blocked tasks show a 🔒 indicator and cannot be started until dependencies are done
- When a task completes, downstream tasks are automatically unlocked

### Status Rules:
- todo: Not started yet
- doing: Currently executing (one per scope)
- done: Completed

### Key Principles:
1. When starting a complex task, FIRST define the step breakdown using kanban_add
2. Only ONE task can be "doing" per scope. Starting a new task auto-moves the old one back to "todo"
3. Use blocked_by for tasks with clear ordering dependencies
4. After each significant action, update the board (mark done, add new steps discovered, etc.)
5. If a step turns out to be too complex, break it down into smaller steps immediately

The board state is continuously injected at the top of context. Always refer to it for current progress.

[End of Kanban Board Guidance]
`;

// ========================================
// 配置 Schema（使用 TypeBox）
// ========================================

const configSchema = {
  parse(value: unknown): KanbanConfig {
    const raw =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    return {
      dataFile: (raw.dataFile as string) || DEFAULT_DATA_FILE,
      injectEnabled: raw.injectEnabled !== false,
      maxTasks: Math.max(1, (raw.maxTasks as number) || 20),
    };
  },

  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      dataFile: {
        type: "string",
        default: DEFAULT_DATA_FILE,
        description: "看板数据存储文件路径",
      },
      injectEnabled: {
        type: "boolean",
        default: true,
        description: "是否将看板状态注入到上下文",
      },
      maxTasks: {
        type: "number",
        default: 20,
        description: "最大任务数量",
      },
    },
  },

  uiHints: {
    dataFile: {
      label: "数据文件路径",
      placeholder: "~/.openclaw/data/kanban.json",
    },
    injectEnabled: {
      label: "启用上下文注入",
      help: "开启后看板状态会持续显示在对话上下文中",
    },
    maxTasks: {
      label: "最大任务数",
      help: "看板最多容纳的任务数量",
    },
  },
};

// ========================================
// 看板管理器
// ========================================

class KanbanManager {
  private dataFile: string;
  private maxTasks: number;
  private data: KanbanData;

  constructor(dataFile: string, maxTasks: number) {
    this.dataFile = dataFile.replace(/^~/, os.homedir());
    this.maxTasks = maxTasks;
    this.data = this.load();
  }

  private load(): KanbanData {
    try {
      if (fs.existsSync(this.dataFile)) {
        const content = fs.readFileSync(this.dataFile, "utf-8");
        const parsed = JSON.parse(content);
        // 验证数据结构
        if (parsed && Array.isArray(parsed.tasks)) {
          return parsed as KanbanData;
        }
      }
    } catch (error) {
      console.error("[momo-kanban] 加载数据失败:", error);
    }
    return this.createEmptyBoard();
  }

  private save(): void {
    try {
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.data.lastUpdated = new Date().toISOString();
      fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error("[momo-kanban] 保存数据失败:", error);
    }
  }

  private createEmptyBoard(): KanbanData {
    return {
      tasks: [],
      boardName: BOARD_NAME,
      lastUpdated: new Date().toISOString(),
    };
  }

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  addTask(title: string, scope: string = DEFAULT_SCOPE, blockedBy?: string[]): { success: boolean; task?: Task; error?: string } {
    const scopeTasks = this.data.tasks.filter((t) => t.scope === scope);
    if (scopeTasks.length >= this.maxTasks) {
      return {
        success: false,
        error: `该 scope(${scope}) 任务数量已达上限（${this.maxTasks}个）`,
      };
    }

    // 验证 blockedBy 的任务是否存在
    if (blockedBy && blockedBy.length > 0) {
      for (const depId of blockedBy) {
        const depTask = this.data.tasks.find((t) => t.id === depId);
        if (!depTask) {
          return { success: false, error: `依赖任务不存在: ${depId}` };
        }
      }
    }

    const task: Task = {
      id: this.generateId(),
      title: title.trim(),
      status: "todo",
      scope,
      createdAt: new Date().toISOString(),
      ...(blockedBy && blockedBy.length > 0 ? { blockedBy } : {}),
    };

    this.data.tasks.push(task);
    this.save();
    return { success: true, task };
  }

  listTasks(scope?: string): KanbanData {
    if (!scope) {
      // 返回全部
      return { ...this.data };
    }
    return {
      ...this.data,
      tasks: this.data.tasks.filter((t) => t.scope === scope),
    };
  }

  doTask(taskId: string): { success: boolean; task?: Task; error?: string; blockedInfo?: string } {
    const task = this.data.tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `找不到任务: ${taskId}` };
    }

    // 检查依赖是否完成
    if (task.blockedBy && task.blockedBy.length > 0) {
      const unfinished = task.blockedBy.filter((depId) => {
        const dep = this.data.tasks.find((t) => t.id === depId);
        return dep && dep.status !== "done";
      });
      if (unfinished.length > 0) {
        const blockerNames = unfinished.map((id) => {
          const dep = this.data.tasks.find((t) => t.id === id);
          return dep ? `[${dep.id}] ${dep.title}` : id;
        });
        return {
          success: false,
          error: `任务被依赖阻塞`,
          blockedInfo: `需要先完成:\n${blockerNames.map((n) => `  • ${n}`).join("\n")}`,
        };
      }
    }

    // 将同 scope 当前 doing 的任务移回 todo
    const currentDoing = this.data.tasks.find(
      (t) => t.status === "doing" && t.scope === task.scope && t.id !== taskId
    );
    if (currentDoing) {
      currentDoing.status = "todo";
      delete currentDoing.startedAt;
    }

    task.status = "doing";
    task.startedAt = new Date().toISOString();
    this.data.currentTaskId = taskId;
    this.save();
    return { success: true, task };
  }

  doneTask(taskId: string): { success: boolean; task?: Task; error?: string; unlockedTasks?: Task[] } {
    const task = this.data.tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `找不到任务: ${taskId}` };
    }

    task.status = "done";
    task.completedAt = new Date().toISOString();

    if (this.data.currentTaskId === taskId) {
      this.data.currentTaskId = undefined;
    }

    // 检查是否解锁了下游任务
    const unlockedTasks: Task[] = [];
    for (const t of this.data.tasks) {
      if (t.status !== "todo" || !t.blockedBy || !t.blockedBy.includes(taskId)) continue;
      // 检查该任务的所有依赖是否都完成了
      const allDepsComplete = t.blockedBy.every((depId) => {
        const dep = this.data.tasks.find((d) => d.id === depId);
        return dep && dep.status === "done";
      });
      if (allDepsComplete) {
        unlockedTasks.push(t);
      }
    }

    this.save();
    return { success: true, task, unlockedTasks };
  }

  deleteTask(taskId: string): { success: boolean; error?: string } {
    const index = this.data.tasks.findIndex((t) => t.id === taskId);
    if (index === -1) {
      return { success: false, error: `找不到任务: ${taskId}` };
    }

    const task = this.data.tasks[index];
    if (task.status === "doing") {
      this.data.currentTaskId = undefined;
    }

    this.data.tasks.splice(index, 1);
    this.save();
    return { success: true };
  }

  resetBoard(scope?: string): { success: boolean; removedCount: number } {
    if (!scope) {
      // 重置全部
      const count = this.data.tasks.length;
      this.data = this.createEmptyBoard();
      this.save();
      return { success: true, removedCount: count };
    }
    // 只重置指定 scope
    const before = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter((t) => t.scope !== scope);
    const removedCount = before - this.data.tasks.length;
    if (this.data.currentTaskId) {
      const current = this.data.tasks.find((t) => t.id === this.data.currentTaskId);
      if (!current) this.data.currentTaskId = undefined;
    }
    this.save();
    return { success: true, removedCount };
  }

  getInjectContent(scope?: string): string {
    const tasks = scope
      ? this.data.tasks.filter((t) => t.scope === scope)
      : this.data.tasks;

    if (tasks.length === 0) {
      return `${INJECT_PREFIX}\n${BOARD_NAME} - No active tasks\n`;
    }

    const lines: string[] = [`${INJECT_PREFIX}`];
    lines.push(scope ? `${BOARD_NAME} [scope: ${scope}]` : BOARD_NAME);
    lines.push("");

    // 按 scope 分组显示
    const scopes = [...new Set(tasks.map((t) => t.scope))];
    const multiScope = scopes.length > 1;

    for (const s of scopes) {
      const scopeTasks = tasks.filter((t) => t.scope === s);
      if (multiScope) {
        lines.push(`📁 Scope: ${s}`);
        lines.push("");
      }

      const todoTasks = scopeTasks.filter((t) => t.status === "todo");
      const doingTasks = scopeTasks.filter((t) => t.status === "doing");
      const doneTasks = scopeTasks.filter((t) => t.status === "done");

      if (doingTasks.length > 0) {
        lines.push("🔵 IN PROGRESS:");
        for (const task of doingTasks) {
          lines.push(`   [${task.id}] ${task.title}`);
        }
        lines.push("");
      }

      if (todoTasks.length > 0) {
        lines.push("📋 TODO:");
        for (const task of todoTasks) {
          const depInfo = this.getDepStatusString(task);
          lines.push(`   [${task.id}] ${task.title}${depInfo}`);
        }
        lines.push("");
      }

      if (doneTasks.length > 0) {
        lines.push(`✅ DONE (${doneTasks.length}):`);
        for (const task of doneTasks) {
          lines.push(`   [${task.id}] ${task.title}`);
        }
      }

      if (multiScope) lines.push("");
    }

    return lines.join("\n");
  }

  /** 获取任务的依赖状态字符串 */
  private getDepStatusString(task: Task): string {
    if (!task.blockedBy || task.blockedBy.length === 0) return "";
    const unfinished = task.blockedBy.filter((depId) => {
      const dep = this.data.tasks.find((t) => t.id === depId);
      return dep && dep.status !== "done";
    });
    if (unfinished.length === 0) return " ✅解锁";
    return ` 🔒阻塞(等待 ${unfinished.length} 个前置任务)`;
  }

  getSystemPromptGuidance(): string {
    return SYSTEM_PROMPT_GUIDANCE;
  }
}

// ========================================
// 技能创建触发追踪器
// ========================================

/** 用户纠正关键词 */
const CORRECTION_KEYWORDS = [
  "不对", "错了", "应该是", "不是这样", "搞错",
  "重新", "不行", "换一种", "别这样", "不要这样",
  "没听懂", "你理解错", "说的不是",
];

/** 技能创建提醒模板 */
const SKILL_REMINDER_TEMPLATE = `
[SKILL_CREATION_ALERT]
⚠️ SKILL CREATION TRIGGER DETECTED

Reason: {{reason}}
Details:
{{details}}

ACTION REQUIRED:
1. PAUSE current kanban task (do NOT mark it done yet)
2. Create or update a skill to document the solution/pattern you just discovered
   - Use the skill-creator skill or manually create in ~/.openclaw/skills/
3. After the skill is written, dismiss this reminder with kanban_dismiss_reminder
4. Then RESUME the kanban task

Decision criteria (2 of 3 must be true to save):
- Reusability: Can this workflow be directly reused next time?
- Discoverability: Will you remember this in 2 months without a record?
- Uniqueness: Is this a universal pattern, not just a one-off workaround?

[End of Skill Creation Alert]
`;

class SkillTriggerTracker {
  private state: SkillTriggerState;
  private logger: { info: (msg: string) => void; warn: (msg: string) => void };

  /** 触发阈值 */
  private static readonly TOOL_CALL_THRESHOLD = 5;
  private static readonly ERROR_REPEAT_THRESHOLD = 2;

  constructor(logger: { info: (msg: string) => void; warn: (msg: string) => void }) {
    this.logger = logger;
    this.state = this.createFreshState();
  }

  private createFreshState(): SkillTriggerState {
    return {
      toolCalls: [],
      errorPatterns: {},
      userCorrectionDetected: false,
      activeReminder: null,
      dismissedReminders: [],
    };
  }

  /** 当新任务开始时重置追踪状态 */
  resetForNewTask(): void {
    const dismissed = this.state.dismissedReminders;
    this.state = this.createFreshState();
    this.state.dismissedReminders = dismissed;
  }

  /** 记录工具调用 */
  recordToolCall(toolName: string, error?: string): void {
    this.state.toolCalls.push({
      toolName,
      error,
      timestamp: Date.now(),
    });

    if (error) {
      // 提取错误模式 key（工具名 + 错误类型）
      const errorKey = `${toolName}:${this.extractErrorType(error)}`;
      this.state.errorPatterns[errorKey] = (this.state.errorPatterns[errorKey] || 0) + 1;
    }

    this.checkTriggers();
  }

  /** 检测用户纠正 */
  checkUserMessage(content: string): void {
    const lowerContent = content.toLowerCase();
    for (const keyword of CORRECTION_KEYWORDS) {
      if (lowerContent.includes(keyword)) {
        this.state.userCorrectionDetected = true;
        this.logger.info(`[momo-kanban] 检测到用户纠正关键词: "${keyword}"`);
        this.checkTriggers();
        return;
      }
    }
  }

  /** 检查是否触发了技能创建条件 */
  private checkTriggers(): void {
    // 已经有活跃提醒就不重复触发
    if (this.state.activeReminder) return;

    const triggers: string[] = [];

    // 条件1: 任务复杂度高（5+ 工具调用）且有错误
    const hasErrors = this.state.toolCalls.some((tc) => tc.error);
    if (this.state.toolCalls.length >= SkillTriggerTracker.TOOL_CALL_THRESHOLD && hasErrors) {
      triggers.push(
        `High complexity: ${this.state.toolCalls.length} tool calls with errors encountered`
      );
    }

    // 条件4: 同类错误出现 2 次以上
    for (const [pattern, count] of Object.entries(this.state.errorPatterns)) {
      if (count >= SkillTriggerTracker.ERROR_REPEAT_THRESHOLD) {
        triggers.push(
          `Repeated error pattern: "${pattern}" occurred ${count} times`
        );
      }
    }

    // 条件3: 被用户纠正
    if (this.state.userCorrectionDetected) {
      triggers.push("User correction detected - possible knowledge gap");
    }

    if (triggers.length > 0) {
      const reminderId = `reminder_${Date.now()}`;
      this.state.activeReminder = {
        id: reminderId,
        triggerReason: triggers[0],
        triggerDetails: triggers,
        createdAt: Date.now(),
      };
      this.logger.warn(
        `[momo-kanban] 技能创建触发! 原因: ${triggers.join("; ")}`
      );
    }
  }

  /** 提取错误类型（简化错误信息为模式 key） */
  private extractErrorType(error: string): string {
    // 取错误信息的前 50 个字符作为模式
    return error.slice(0, 50).replace(/[\n\r]/g, " ").trim();
  }

  /** 获取当前活跃提醒（用于注入上下文） */
  getActiveReminder(): string | null {
    if (!this.state.activeReminder) return null;

    return SKILL_REMINDER_TEMPLATE
      .replace("{{reason}}", this.state.activeReminder.triggerReason)
      .replace(
        "{{details}}",
        this.state.activeReminder.triggerDetails
          .map((d) => `  - ${d}`)
          .join("\n")
      );
  }

  /** 消除当前提醒 */
  dismissReminder(): string {
    if (!this.state.activeReminder) {
      return "No active reminder to dismiss.";
    }
    const id = this.state.activeReminder.id;
    this.state.dismissedReminders.push(id);
    this.state.activeReminder = null;
    // 消除后重置纠正标记，避免立即重新触发
    this.state.userCorrectionDetected = false;
    return `Reminder ${id} dismissed. Resume your kanban tasks.`;
  }

  /** 获取追踪状态摘要（调试用） */
  getStatusSummary(): string {
    const lines: string[] = [];
    lines.push(`Tool calls: ${this.state.toolCalls.length}`);
    lines.push(`Errors: ${this.state.toolCalls.filter((tc) => tc.error).length}`);
    lines.push(`Error patterns: ${JSON.stringify(this.state.errorPatterns)}`);
    lines.push(`User correction: ${this.state.userCorrectionDetected}`);
    lines.push(`Active reminder: ${this.state.activeReminder ? "YES" : "no"}`);
    return lines.join("\n");
  }
}

// ========================================
// 插件定义
// ========================================

const momoKanbanPlugin = {
  id: "momo-kanban",
  name: "陌陌看板",
  description:
    "陌陌的任务看板，帮助分解任务、逐步执行、持续追踪",
  version: "1.0.0",
  configSchema,

  register(api: OpenClawPluginApi): void {
    const config = configSchema.parse(api.pluginConfig);
    const kanban = new KanbanManager(config.dataFile, config.maxTasks);
    const tracker = new SkillTriggerTracker(api.logger);

    api.logger.info("[momo-kanban] 插件加载中...");

    // ========================================
    // 注册工具：添加任务
    // ========================================
    api.registerTool({
      name: "kanban_add",
      label: "看板添加任务",
      description:
        "将一个大任务分解为小步骤，添加到看板上。可选 scope 用于会话隔离，blocked_by 用于任务依赖。",
      parameters: Type.Object({
        title: Type.String({
          description: "任务/步骤的标题描述",
        }),
        scope: Type.Optional(Type.String({
          description: "任务所属 scope，用于会话/Agent 隔离，默认 main",
        })),
        blocked_by: Type.Optional(Type.Array(Type.String(), {
          description: "前置任务 ID 列表，这些任务完成后才能开始本任务",
        })),
      }),
      async execute(_toolCallId, params) {
        const title = params?.title;
        if (!title || typeof title !== "string") {
          return {
            content: [
              {
                type: "text" as const,
                text: "错误：请提供任务标题",
              },
            ],
          };
        }

        const scope = (params?.scope as string) || DEFAULT_SCOPE;
        const blockedBy = params?.blocked_by as string[] | undefined;
        const result = kanban.addTask(title, scope, blockedBy);
        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `添加失败: ${result.error}`,
              },
            ],
          };
        }

        const depInfo = blockedBy && blockedBy.length > 0
          ? ` (依赖: ${blockedBy.join(", ")})`
          : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ 已添加步骤: ${result.task?.title}${depInfo}\n\n${kanban.getInjectContent(scope)}`,
            },
          ],
        };
      },
    });

    // ========================================
    // 注册工具：列出任务
    // ========================================
    api.registerTool({
      name: "kanban_list",
      label: "看板列表",
      description: "查看当前看板上的任务及其状态。show_all=true 查看所有 scope。",
      parameters: Type.Object({
        scope: Type.Optional(Type.String({
          description: "只查看指定 scope 的任务，默认 main",
        })),
        show_all: Type.Optional(Type.Boolean({
          description: "是否查看所有 scope 的任务",
        })),
      }),
      async execute(_toolCallId, params) {
        const showAll = params?.show_all === true;
        const scope = showAll ? undefined : ((params?.scope as string) || DEFAULT_SCOPE);
        const board = kanban.listTasks(scope);
        if (board.tasks.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: showAll ? "📋 看板上目前没有任务" : `📋 scope "${scope}" 下没有任务`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: kanban.getInjectContent(scope),
            },
          ],
        };
      },
    });

    // ========================================
    // 注册工具：开始执行任务
    // ========================================
    api.registerTool({
      name: "kanban_do",
      label: "看板开始任务",
      description: "开始执行某个任务（标记为doing）。参数 task_id 是任务的ID。",
      parameters: Type.Object({
        task_id: Type.String({
          description: "任务的ID",
        }),
      }),
      async execute(_toolCallId, params) {
        const taskId = params?.task_id;
        if (!taskId || typeof taskId !== "string") {
          return {
            content: [
              {
                type: "text" as const,
                text: "错误：请提供任务ID",
              },
            ],
          };
        }

        const result = kanban.doTask(taskId);
        if (!result.success) {
          const msg = result.blockedInfo
            ? `🔒 任务被依赖阻塞\n\n${result.blockedInfo}`
            : `操作失败: ${result.error}`;
          return {
            content: [
              {
                type: "text" as const,
                text: msg,
              },
            ],
          };
        }

        // 新任务开始，重置追踪器
        tracker.resetForNewTask();

        return {
          content: [
            {
              type: "text" as const,
              text: `🔵 开始执行: ${result.task?.title}\n\n${kanban.getInjectContent(result.task?.scope)}`,
            },
          ],
        };
      },
    });

    // ========================================
    // 注册工具：完成任务
    // ========================================
    api.registerTool({
      name: "kanban_done",
      label: "看板完成任务",
      description: "标记一个任务为已完成（done）。参数 task_id 是任务的ID。",
      parameters: Type.Object({
        task_id: Type.String({
          description: "任务的ID",
        }),
      }),
      async execute(_toolCallId, params) {
        const taskId = params?.task_id;
        if (!taskId || typeof taskId !== "string") {
          return {
            content: [
              {
                type: "text" as const,
                text: "错误：请提供任务ID",
              },
            ],
          };
        }

        const result = kanban.doneTask(taskId);
        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `操作失败: ${result.error}`,
              },
            ],
          };
        }

        let msg = `✅ 已完成: ${result.task?.title}`;
        if (result.unlockedTasks && result.unlockedTasks.length > 0) {
          const unlocked = result.unlockedTasks.map((t) => `  • [${t.id}] ${t.title}`).join("\n");
          msg += `\n\n🔓 以下任务已解锁：\n${unlocked}`;
        }
        msg += `\n\n${kanban.getInjectContent(result.task?.scope)}`;

        return {
          content: [
            {
              type: "text" as const,
              text: msg,
            },
          ],
        };
      },
    });

    // ========================================
    // 注册工具：删除任务
    // ========================================
    api.registerTool({
      name: "kanban_delete",
      label: "看板删除任务",
      description: "从看板上删除一个任务。参数 task_id 是任务的ID。",
      parameters: Type.Object({
        task_id: Type.String({
          description: "任务的ID",
        }),
      }),
      async execute(_toolCallId, params) {
        const taskId = params?.task_id;
        if (!taskId || typeof taskId !== "string") {
          return {
            content: [
              {
                type: "text" as const,
                text: "错误：请提供任务ID",
              },
            ],
          };
        }

        const result = kanban.deleteTask(taskId);
        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `删除失败: ${result.error}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `🗑️ 已删除任务\n\n${kanban.getInjectContent(DEFAULT_SCOPE)}`,
            },
          ],
        };
      },
    });

    // ========================================
    // 注册工具：重置看板
    // ========================================
    api.registerTool({
      name: "kanban_reset",
      label: "看板重置",
      description: "清除看板上的任务。可选 scope 只清除指定 scope。",
      parameters: Type.Object({
        scope: Type.Optional(Type.String({
          description: "只清除指定 scope 的任务，不填则清除全部",
        })),
      }),
      async execute(_toolCallId, params) {
        const scope = params?.scope as string | undefined;
        const result = kanban.resetBoard(scope);
        tracker.resetForNewTask();
        const scopeInfo = scope ? ` (scope: ${scope}, 删除 ${result.removedCount} 个)` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `🔄 看板已重置${scopeInfo}\n\n${kanban.getInjectContent()}`,
            },
          ],
        };
      },
    });

    // ========================================
    // kanban_dismiss_reminder - 消除技能创建提醒
    // ========================================
    api.registerTool({
      name: "kanban_dismiss_reminder",
      label: "消除提醒",
      description: "消除当前的技能创建提醒。在写完技能文档后调用此工具，然后继续推进看板任务。",
      parameters: Type.Object({}),
      async execute(_toolCallId) {
        const result = tracker.dismissReminder();
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ ${result}`,
            },
          ],
        };
      },
    });

    // ========================================
    // 注册 hooks
    // ========================================

    // Hook 1: 工具调用后——追踪工具调用次数和错误
    api.registerHook(
      "after_tool_call",
      (event) => {
        // 不追踪看板自己的工具调用
        if (event.toolName.startsWith("kanban_")) return;

        tracker.recordToolCall(event.toolName, event.error);
      },
      { name: "momo-kanban.tool-tracker", description: "追踪工具调用用于技能触发检测" }
    );

    // Hook 2: 收到消息——检测用户纠正
    api.registerHook(
      "message_received",
      (event) => {
        if (event.content) {
          tracker.checkUserMessage(event.content);
        }
      },
      { name: "momo-kanban.correction-detector", description: "检测用户纠正用于技能触发" }
    );

    // Hook 3: 提示词构建前——注入看板状态 + 技能创建提醒
    if (config.injectEnabled) {
      api.registerHook(
        "before_prompt_build",
        (_event, data) => {
          const boardContent = kanban.getInjectContent();
          const systemGuidance = kanban.getSystemPromptGuidance();
          const skillReminder = tracker.getActiveReminder();

          // 拼接注入内容
          let injectContent = `${boardContent}\n\n${systemGuidance}`;
          if (skillReminder) {
            injectContent += `\n\n${skillReminder}`;
          }

          data.promptEntries.unshift({
            role: "system",
            content: injectContent,
          });

          return data;
        },
        { name: "momo-kanban.inject", description: "注入看板状态和技能提醒到上下文" }
      );
      api.logger.info("[momo-kanban] 上下文注入已启用");
    }

    api.logger.info("[momo-kanban] 插件加载完成！");
  },
};

export default momoKanbanPlugin;
